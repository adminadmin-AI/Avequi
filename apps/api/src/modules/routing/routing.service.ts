import {
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

    // 3. Create RoutingStep
    const step = await this.prisma.routingStep.create({
      data: { ...dto, companyId },
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
