import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBomDto } from './dto/create-bom.dto';

@Injectable()
export class BomService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBomDto, user: { id?: string; companyId: string }) {
    // companyId SEMPRE vem do JWT do usuário autenticado (nunca do body)
    const companyId = user.companyId;

    // 1. Verify all componentIds exist in DB and belong to same companyId
    const componentIds = dto.items.map((i) => i.componentId);
    const components = await this.prisma.product.findMany({
      where: { id: { in: componentIds }, companyId },
    });

    if (components.length !== componentIds.length) {
      const foundIds = components.map((c) => c.id);
      const missing = componentIds.filter((id) => !foundIds.includes(id));
      throw new NotFoundException(
        `Componentes não encontrados ou não pertencem à empresa: ${missing.join(', ')}`,
      );
    }

    // 1b. #815 — valida as operações alocadas (routingStepId).
    // Três regras: existir, ser da MESMA empresa e ser do MESMO produto da BOM.
    // Alocar componente a operação de outro produto produziria uma OC fantasma
    // no despacho por setor (#817), então é rejeitado aqui.
    const stepIds = Array.from(
      new Set(dto.items.map((i) => i.routingStepId).filter((s): s is string => !!s)),
    );
    if (stepIds.length > 0) {
      const steps = await this.prisma.routingStep.findMany({
        where: { id: { in: stepIds }, companyId },
        select: { id: true, productId: true, name: true },
      });

      const encontrados = new Map(steps.map((s) => [s.id, s]));
      const ausentes = stepIds.filter((id) => !encontrados.has(id));
      if (ausentes.length > 0) {
        // Cobre tanto "não existe" quanto "é de outra empresa" — a busca é
        // escopada por companyId, então não revelamos dado de outro tenant.
        throw new NotFoundException(
          `Operação(ões) de roteiro não encontrada(s) nesta empresa: ${ausentes.join(', ')}`,
        );
      }

      const deOutroProduto = steps.filter((s) => s.productId !== dto.productId);
      if (deOutroProduto.length > 0) {
        throw new BadRequestException(
          `Operação(ões) de roteiro pertencem a outro produto e não podem receber ` +
            `componentes desta BOM: ${deOutroProduto.map((s) => `${s.id} (${s.name})`).join(', ')}`,
        );
      }
    }

    // 2. Get current max version for productId
    const maxVersion = await this.prisma.bomVersion.findFirst({
      where: { productId: dto.productId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = maxVersion ? maxVersion.version + 1 : 1;

    // 3. Create BomVersion with isActive: false
    const bomVersion = await this.prisma.bomVersion.create({
      data: {
        companyId,
        productId: dto.productId,
        version: nextVersion,
        isActive: false,
        notes: dto.notes,
        items: {
          create: dto.items.map((item) => ({
            componentId: item.componentId,
            quantity: item.quantity,
            scrapPct: item.scrapPct ?? 0,
            // #815 — null quando não alocado: compatível com BOM já existente
            routingStepId: item.routingStepId ?? null,
          })),
        },
      },
      include: {
        items: {
          include: { component: { select: { id: true, sku: true, name: true } } },
        },
      },
    });

    // 4. Write AuditLog
    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId,
        entity: 'BomVersion',
        action: 'CREATE',
        payload: { bomVersionId: bomVersion.id, version: nextVersion, productId: dto.productId },
      },
    });

    return bomVersion;
  }

  async activate(id: string, companyId: string, user?: any) {
    // 1. Find BomVersion by id scoped to companyId
    const bomVersion = await this.prisma.bomVersion.findFirst({
      where: { id, companyId },
    });
    if (!bomVersion) {
      throw new NotFoundException(`BomVersion ${id} não encontrada`);
    }

    // 2. Transaction: deactivate all, activate this one
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.bomVersion.updateMany({
        where: { productId: bomVersion.productId },
        data: { isActive: false },
      });
      return tx.bomVersion.update({
        where: { id },
        data: { isActive: true },
        include: {
          items: {
            include: { component: { select: { id: true, sku: true, name: true } } },
          },
        },
      });
    });

    // 3. Write AuditLog
    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId,
        entity: 'BomVersion',
        action: 'ACTIVATE',
        payload: { bomVersionId: id, version: bomVersion.version, productId: bomVersion.productId },
      },
    });

    return updated;
  }

  async findByProduct(productId: string, companyId: string) {
    return this.prisma.bomVersion.findMany({
      where: { productId, companyId },
      orderBy: { version: 'desc' },
      include: {
        items: {
          include: { component: { select: { id: true, sku: true, name: true } } },
        },
      },
    });
  }

  async findActive(productId: string, companyId: string) {
    const bom = await this.prisma.bomVersion.findFirst({
      where: { productId, companyId, isActive: true },
      include: {
        items: {
          include: { component: { select: { id: true, sku: true, name: true } } },
        },
      },
    });
    if (!bom) {
      throw new NotFoundException(`Nenhuma BOM ativa encontrada para o produto ${productId}`);
    }
    return bom;
  }

  async findOne(id: string, companyId: string) {
    const bom = await this.prisma.bomVersion.findFirst({
      where: { id, companyId },
      include: {
        items: {
          include: { component: { select: { id: true, sku: true, name: true, unit: true } } },
        },
      },
    });
    if (!bom) {
      throw new NotFoundException(`BomVersion ${id} não encontrada`);
    }
    return bom;
  }
}
