import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoutingStepDto } from './dto/create-routing-step.dto';
import { UpdateRoutingStepDto } from './dto/update-routing-step.dto';

@Injectable()
export class RoutingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * #815 — Resolve o centro de trabalho DENTRO da empresa do usuário e devolve
   * os dois campos já sincronizados.
   *
   * `workCenterId` é a referência oficial; `workCenter` (texto) é mantido em
   * espelho com `WorkCenter.code` porque três consumidores legados ainda leem
   * por texto (capacity, costing e as respostas de production). A remoção do
   * texto fica para issue posterior.
   *
   * Os quatro casos do contrato, sem ambiguidade e nesta ordem de precedência:
   *
   *  1. `workCenterId` presente e não-nulo → é a fonte da verdade. Resolve na
   *     empresa e SOBRESCREVE o texto com o `code`. Se o cliente também mandou
   *     `workCenter` com valor conflitante, ele é descartado — a FK vence.
   *  2. `workCenterId` presente e `null`   → limpeza explícita: zera os DOIS
   *     campos, mesmo que `workCenter` venha preenchido no mesmo payload.
   *  3. `workCenterId` ausente, `workCenter` com texto → caminho legado: tenta
   *     casar o texto com um centro da empresa e, casando, já preenche a FK.
   *  4. `workCenterId` ausente, `workCenter` `null`    → limpeza pelo caminho
   *     legado: zera os dois.
   *
   * Em nenhum caminho a FK e o texto terminam divergentes.
   *
   * A busca é escopada por companyId: centro de outra empresa nunca resolve —
   * dá NotFound, sem revelar que o registro existe em outro tenant.
   */
  private async resolverCentro(
    temChaveId: boolean,
    workCenterId: string | null | undefined,
    workCenterTexto: string | null | undefined,
    companyId: string,
  ): Promise<{ workCenterId: string | null; workCenter: string | null }> {
    // Caso 1 e 2 — a FK tem precedência sobre o texto sempre que a chave
    // `workCenterId` estiver presente no payload.
    if (temChaveId) {
      if (!workCenterId) {
        // Caso 2 — limpeza explícita
        return { workCenterId: null, workCenter: null };
      }
      const wc = await this.prisma.workCenter.findFirst({
        where: { id: workCenterId, companyId },
        select: { id: true, code: true },
      });
      if (!wc) {
        throw new NotFoundException(
          `Centro de trabalho ${workCenterId} não encontrado nesta empresa`,
        );
      }
      // Caso 1 — FK manda; o texto vira espelho do code.
      return { workCenterId: wc.id, workCenter: wc.code };
    }

    // Caso 3 — só texto. Se casar com um centro cadastrado da empresa,
    // aproveitamos e já preenchemos a FK. Se não casar, mantemos o texto como
    // está — não inventamos vínculo e não bloqueamos o cadastro, preservando o
    // comportamento anterior.
    if (workCenterTexto) {
      const wc = await this.prisma.workCenter.findFirst({
        where: { companyId, code: workCenterTexto },
        select: { id: true, code: true },
      });
      return wc
        ? { workCenterId: wc.id, workCenter: wc.code }
        : { workCenterId: null, workCenter: workCenterTexto };
    }

    // Caso 4 — sem centro nenhum
    return { workCenterId: null, workCenter: null };
  }

  async create(dto: CreateRoutingStepDto, user: { id?: string; companyId: string }) {
    // companyId SEMPRE vem do JWT do usuário autenticado (nunca do body)
    const companyId = user.companyId;

    // 1. Check stepOrder uniqueness per product
    const existing = await this.prisma.routingStep.findUnique({
      where: { productId_stepOrder: { productId: dto.productId, stepOrder: dto.stepOrder } },
    });
    if (existing) {
      throw new ConflictException('Etapa com essa ordem já existe para o produto');
    }

    // 2. Verify product exists and belongs to companyId
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, companyId },
    });
    if (!product) {
      throw new NotFoundException(`Produto ${dto.productId} não encontrado`);
    }

    // 3. #815 — resolve o centro de trabalho na empresa do usuário e sincroniza
    //    FK + texto legado
    const centro = await this.resolverCentro(
      'workCenterId' in dto,
      dto.workCenterId,
      dto.workCenter,
      companyId,
    );

    // 4. Create RoutingStep
    const step = await this.prisma.routingStep.create({
      data: { ...dto, ...centro, companyId },
    });

    // 4. AuditLog
    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId,
        entity: 'RoutingStep',
        action: 'CREATE',
        payload: { stepId: step.id, productId: dto.productId, stepOrder: dto.stepOrder },
      },
    });

    return step;
  }

  async findByProduct(productId: string, companyId: string) {
    return this.prisma.routingStep.findMany({
      where: { productId, companyId },
      orderBy: { stepOrder: 'asc' },
    });
  }

  async update(id: string, dto: UpdateRoutingStepDto, user: { id?: string; companyId: string }) {
    // Busca escopada pela empresa do usuário — impede editar etapa de outro tenant
    const existing = await this.prisma.routingStep.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!existing) {
      throw new NotFoundException(`RoutingStep ${id} não encontrado`);
    }

    // companyId é imutável: registro nunca muda de empresa via update
    const companyId = existing.companyId;

    // If stepOrder changes, check uniqueness
    const newStepOrder = dto.stepOrder ?? existing.stepOrder;
    const newProductId = dto.productId ?? existing.productId;
    if (dto.stepOrder && dto.stepOrder !== existing.stepOrder) {
      const duplicate = await this.prisma.routingStep.findUnique({
        where: { productId_stepOrder: { productId: newProductId, stepOrder: newStepOrder } },
      });
      if (duplicate) {
        throw new ConflictException('Etapa com essa ordem já existe para o produto');
      }
    }

    // Defesa em profundidade: descarta qualquer companyId injetado no payload
    const { companyId: _ignored, ...data } = dto as any;

    // #815 — só recalcula o centro quando o payload mencionar um dos dois
    // campos. Update que não fala de centro de trabalho não deve mexer nele.
    //
    // Importante: quando a chave `workCenterId` vem no payload, ela decide
    // sozinha — inclusive com valor null (limpeza explícita). NÃO caímos para o
    // texto que já estava gravado, senão um pedido de remoção seria desfeito
    // pela reresolução do texto antigo.
    if ('workCenterId' in dto || 'workCenter' in dto) {
      const centro = await this.resolverCentro(
        'workCenterId' in dto,
        dto.workCenterId,
        dto.workCenter,
        companyId,
      );
      data.workCenterId = centro.workCenterId;
      data.workCenter = centro.workCenter;
    }

    const step = await this.prisma.routingStep.update({
      where: { id },
      data,
    });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId,
        entity: 'RoutingStep',
        action: 'UPDATE',
        payload: { stepId: id, ...dto },
      },
    });

    return step;
  }

  async remove(id: string, companyId: string, user?: any) {
    const existing = await this.prisma.routingStep.findFirst({ where: { id, companyId } });
    if (!existing) {
      throw new NotFoundException(`RoutingStep ${id} não encontrado`);
    }

    // #815 — nenhuma exclusão pode desassociar alocação de BOM em silêncio.
    // O banco já protege via ON DELETE RESTRICT; aqui damos a mensagem útil
    // antes de o Prisma lançar erro de constraint.
    const alocados = await this.prisma.bomItem.count({ where: { routingStepId: id } });
    if (alocados > 0) {
      throw new BadRequestException(
        `Etapa '${existing.name}' não pode ser excluída: ${alocados} item(ns) de BOM ` +
          `estão alocados a ela. Realoque os componentes para outra operação antes de excluir.`,
      );
    }

    await this.prisma.routingStep.delete({ where: { id } });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId,
        entity: 'RoutingStep',
        action: 'DELETE',
        payload: { stepId: id, productId: existing.productId, stepOrder: existing.stepOrder },
      },
    });

    return { deleted: true };
  }
}
