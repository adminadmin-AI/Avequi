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

  async create(dto: CreateRoutingStepDto, user?: any) {
    // 1. Check stepOrder uniqueness per product
    const existing = await this.prisma.routingStep.findUnique({
      where: { productId_stepOrder: { productId: dto.productId, stepOrder: dto.stepOrder } },
    });
    if (existing) {
      throw new ConflictException('Etapa com essa ordem já existe para o produto');
    }

    // 2. Verify product exists and belongs to companyId
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, companyId: dto.companyId },
    });
    if (!product) {
      throw new NotFoundException(`Produto ${dto.productId} não encontrado`);
    }

    // 3. Create RoutingStep
    const step = await this.prisma.routingStep.create({ data: dto });

    // 4. AuditLog
    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId: dto.companyId,
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

  async update(id: string, dto: UpdateRoutingStepDto, user?: any) {
    const existing = await this.prisma.routingStep.findFirst({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`RoutingStep ${id} não encontrado`);
    }

    const companyId = dto.companyId || existing.companyId;

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

    const step = await this.prisma.routingStep.update({
      where: { id },
      data: dto,
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
