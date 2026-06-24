import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProductionOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductionOrderDto } from './dto/create-production-order.dto';
import { CreateProductionLogDto } from './dto/create-log.dto';
import {
  PRODUCTION_COMPLETED_EVENT,
  ProductionCompletedEvent,
} from './events/production-completed.event';

const ORDER_INCLUDE = {
  product: { select: { id: true, sku: true, name: true, unit: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  items: {
    include: {
      component: { select: { id: true, sku: true, name: true, unit: true } },
    },
  },
  createdBy: { select: { id: true, name: true } },
  mrpSuggestion: { select: { id: true, netQty: true, grossQty: true } },
  cost: true,
};

interface CostBreakdownItem {
  componentId: string;
  sku: string;
  qty: number;
  unitCost: number;
  totalCost: number;
}

@Injectable()
export class ProductionService {
  private readonly logger = new Logger(ProductionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── S13.01: Criar Ordem de Produção ─────────────────────────────────────

  async create(dto: CreateProductionOrderDto, userId?: string) {
    // Valida produto
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, companyId: dto.companyId },
    });
    if (!product) throw new NotFoundException(`Produto ${dto.productId} não encontrado`);

    // Valida armazém
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.warehouseId, companyId: dto.companyId },
    });
    if (!warehouse) throw new NotFoundException(`Armazém ${dto.warehouseId} não encontrado`);

    // Carrega BOM ativo para gerar itens da OP
    const bom = await this.prisma.bomVersion.findFirst({
      where: { productId: dto.productId, companyId: dto.companyId, isActive: true },
      include: { items: { include: { component: true } } },
    });

    const bomItems = (bom?.items ?? []).map((item) => ({
      componentId: item.componentId,
      plannedQty: Number(item.quantity) * dto.plannedQty * (1 + Number(item.scrapPct) / 100),
      unit: item.unit,
    }));

    const order = await this.prisma.productionOrder.create({
      data: {
        companyId: dto.companyId,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        plannedQty: dto.plannedQty,
        mrpSuggestionId: dto.mrpSuggestionId ?? null,
        scheduledStart: dto.scheduledStart ? new Date(dto.scheduledStart) : null,
        scheduledEnd: dto.scheduledEnd ? new Date(dto.scheduledEnd) : null,
        notes: dto.notes ?? null,
        createdById: userId ?? null,
        items: { create: bomItems },
      },
      include: ORDER_INCLUDE,
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId: dto.companyId,
        entity: 'ProductionOrder',
        action: 'CREATE',
        payload: { id: order.id, productId: dto.productId, plannedQty: dto.plannedQty },
      },
    });

    this.logger.log(`OP ${order.id} criada — ${product.sku} × ${dto.plannedQty}`);
    return order;
  }

  // ─── S13.02: Listar OPs ───────────────────────────────────────────────────

  async findAll(companyId: string, status?: ProductionOrderStatus) {
    return this.prisma.productionOrder.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      include: {
        product: { select: { id: true, sku: true, name: true, unit: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  // ─── S13.03: Detalhe ──────────────────────────────────────────────────────

  async findOne(id: string, companyId: string) {
    const order = await this.prisma.productionOrder.findFirst({
      where: { id, companyId },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new NotFoundException(`Ordem de produção ${id} não encontrada`);
    return order;
  }

  // ─── S13.04: Liberar (DRAFT → RELEASED) — reserva componentes ────────────

  async release(id: string, companyId: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findFirst({
        where: { id, companyId },
        include: { items: true },
      });

      if (!order) throw new NotFoundException(`Ordem de produção ${id} não encontrada`);
      if (order.status !== ProductionOrderStatus.DRAFT) {
        throw new BadRequestException(`OP não pode ser liberada. Status atual: ${order.status}`);
      }
      if (order.items.length === 0) {
        throw new BadRequestException('OP sem componentes no BOM não pode ser liberada');
      }

      // Reserva estoque de cada componente
      for (const item of order.items) {
        const balance = await tx.stockBalance.findUnique({
          where: { warehouseId_productId: { warehouseId: order.warehouseId, productId: item.componentId } },
        });

        const available = Number(balance?.available ?? 0);
        const qty = Number(item.plannedQty);

        if (available < qty) {
          throw new BadRequestException(
            `Estoque insuficiente para componente ${item.componentId}. ` +
              `Disponível: ${available}, necessário: ${qty}`,
          );
        }

        await tx.stockBalance.update({
          where: { warehouseId_productId: { warehouseId: order.warehouseId, productId: item.componentId } },
          data: { available: { decrement: qty }, reserved: { increment: qty } },
        });
      }

      const updated = await tx.productionOrder.update({
        where: { id },
        data: { status: ProductionOrderStatus.RELEASED },
        include: ORDER_INCLUDE,
      });

      await tx.auditLog.create({
        data: {
          userId,
          companyId,
          entity: 'ProductionOrder',
          action: 'RELEASE',
          payload: { id, componentsReserved: order.items.length },
        },
      });

      this.logger.log(`OP ${id} liberada — ${order.items.length} componentes reservados`);
      return updated;
    });
  }

  // ─── S13.05: Iniciar produção (RELEASED → IN_PROGRESS) ───────────────────

  async start(id: string, companyId: string, userId?: string) {
    const order = await this.prisma.productionOrder.findFirst({ where: { id, companyId } });
    if (!order) throw new NotFoundException(`Ordem de produção ${id} não encontrada`);
    if (order.status !== ProductionOrderStatus.RELEASED) {
      throw new BadRequestException(`OP não pode ser iniciada. Status atual: ${order.status}`);
    }

    const updated = await this.prisma.productionOrder.update({
      where: { id },
      data: { status: ProductionOrderStatus.IN_PROGRESS, startedAt: new Date() },
      include: ORDER_INCLUDE,
    });

    await this.prisma.auditLog.create({
      data: { userId, companyId, entity: 'ProductionOrder', action: 'START', payload: { id } },
    });

    this.logger.log(`OP ${id} iniciada`);
    return updated;
  }

  // ─── S13.06 / S16: Concluir (IN_PROGRESS → DONE) ─────────────────────────
  //   • Consumo proporcional de componentes (suporte a encerramento parcial)
  //   • Estorno automático do excedente reservado
  //   • Cálculo de custo material por componente (avgCost)
  //   • Atualização do avgCost do produto acabado (CMPC)

  async complete(id: string, companyId: string, producedQty?: number, userId?: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findFirst({
        where: { id, companyId },
        include: {
          items: { include: { component: true } },
          product: true,
        },
      });

      if (!order) throw new NotFoundException(`Ordem de produção ${id} não encontrada`);
      if (order.status !== ProductionOrderStatus.IN_PROGRESS) {
        throw new BadRequestException(`OP não pode ser concluída. Status atual: ${order.status}`);
      }

      const finalQty = producedQty ?? Number(order.plannedQty);
      const plannedQty = Number(order.plannedQty);

      if (finalQty <= 0) {
        throw new BadRequestException('Quantidade produzida deve ser maior que zero');
      }
      if (finalQty > plannedQty) {
        throw new BadRequestException(
          `Quantidade produzida (${finalQty}) não pode exceder a planejada (${plannedQty})`,
        );
      }

      // Proporção de consumo: 1.0 = pleno, < 1.0 = encerramento parcial
      const ratio = plannedQty > 0 ? finalQty / plannedQty : 1;

      // ─── 1. Processar cada componente ─────────────────────────────────────
      const breakdown: CostBreakdownItem[] = [];
      let materialCost = 0;

      for (const item of order.items) {
        const plannedItemQty = Number(item.plannedQty);
        const actualConsumed = plannedItemQty * ratio;
        const excessReserved = plannedItemQty - actualConsumed;

        // Debita reserva e devolve excedente ao disponível
        await tx.stockBalance.update({
          where: { warehouseId_productId: { warehouseId: order.warehouseId, productId: item.componentId } },
          data: {
            reserved: { decrement: plannedItemQty },
            ...(excessReserved > 0 ? { available: { increment: excessReserved } } : {}),
          },
        });

        // Movimento de saída do consumo real
        await tx.stockMovement.create({
          data: {
            companyId,
            warehouseId: order.warehouseId,
            productId: item.componentId,
            type: 'EXIT',
            quantity: actualConsumed,
            reason: 'Consumo em Ordem de Produção',
            reference: `OP:${id}`,
            userId,
          },
        });

        // Atualiza consumedQty no item da OP
        await tx.productionOrderItem.update({
          where: { id: item.id },
          data: { consumedQty: actualConsumed },
        });

        // Custo do componente: qty × avgCost do cadastro
        const unitCost = Number(item.component.avgCost ?? 0);
        const itemCost = actualConsumed * unitCost;
        materialCost += itemCost;

        breakdown.push({
          componentId: item.componentId,
          sku: item.component.sku,
          qty: actualConsumed,
          unitCost,
          totalCost: itemCost,
        });
      }

      // ─── 2. Registrar custo da OP ─────────────────────────────────────────
      const totalCost = materialCost; // laborCost = 0 (custo/hora no roteiro não implementado ainda)
      const costPerUnit = finalQty > 0 ? totalCost / finalQty : 0;

      await tx.productionCost.create({
        data: {
          productionOrderId: id,
          materialCost,
          laborCost: 0,
          totalCost,
          costPerUnit,
          breakdown: breakdown as object[],
        },
      });

      // ─── 3. Atualizar avgCost do produto acabado (CMPC) ───────────────────
      const paBalance = await tx.stockBalance.findUnique({
        where: { warehouseId_productId: { warehouseId: order.warehouseId, productId: order.productId } },
      });

      const existingStock = Number(paBalance?.available ?? 0);
      const oldAvgCost = Number(order.product.avgCost ?? 0);

      if (costPerUnit > 0) {
        const newAvgCost =
          existingStock + finalQty > 0
            ? (existingStock * oldAvgCost + finalQty * costPerUnit) / (existingStock + finalQty)
            : costPerUnit;

        await tx.product.update({
          where: { id: order.productId },
          data: { avgCost: newAvgCost },
        });
      }

      // ─── 4. Dar entrada no produto acabado ────────────────────────────────
      if (paBalance) {
        await tx.stockBalance.update({
          where: { warehouseId_productId: { warehouseId: order.warehouseId, productId: order.productId } },
          data: { available: { increment: finalQty } },
        });
      } else {
        await tx.stockBalance.create({
          data: {
            companyId,
            warehouseId: order.warehouseId,
            productId: order.productId,
            available: finalQty,
            reserved: 0,
          },
        });
      }

      await tx.stockMovement.create({
        data: {
          companyId,
          warehouseId: order.warehouseId,
          productId: order.productId,
          type: 'ENTRY',
          quantity: finalQty,
          reason: 'Entrada de Produto Acabado',
          reference: `OP:${id}`,
          userId,
        },
      });

      // ─── 5. Fechar a OP ───────────────────────────────────────────────────
      const updated = await tx.productionOrder.update({
        where: { id },
        data: {
          status: ProductionOrderStatus.DONE,
          producedQty: finalQty,
          completedAt: new Date(),
        },
        include: ORDER_INCLUDE,
      });

      await tx.auditLog.create({
        data: {
          userId,
          companyId,
          entity: 'ProductionOrder',
          action: 'COMPLETE',
          payload: { id, plannedQty, producedQty: finalQty, totalCost, costPerUnit },
        },
      });

      this.logger.log(
        `OP ${id} encerrada — produzido: ${finalQty}/${plannedQty} × ${order.product.sku}` +
          ` | custo: R$ ${totalCost.toFixed(2)} (R$ ${costPerUnit.toFixed(4)}/un)`,
      );
      return { ...updated, _meta: { finalQty, warehouseId: order.warehouseId, productId: order.productId } };
    });

    // Emite evento após commit da transação
    if (result._meta) {
      this.eventEmitter.emit(
        PRODUCTION_COMPLETED_EVENT,
        new ProductionCompletedEvent(
          companyId,
          id,
          result._meta.productId,
          result._meta.warehouseId,
          result._meta.finalQty,
          userId,
        ),
      );
    }

    return result;
  }

  // ─── S13.07: Cancelar (DRAFT|RELEASED|IN_PROGRESS → CANCELLED) ───────────

  async cancel(id: string, companyId: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findFirst({
        where: { id, companyId },
        include: { items: true },
      });

      if (!order) throw new NotFoundException(`Ordem de produção ${id} não encontrada`);

      const cancellableStatuses: ProductionOrderStatus[] = [
        ProductionOrderStatus.DRAFT,
        ProductionOrderStatus.RELEASED,
        ProductionOrderStatus.IN_PROGRESS,
      ];

      if (!cancellableStatuses.includes(order.status)) {
        throw new BadRequestException(
          `OP não pode ser cancelada. Status atual: ${order.status}`,
        );
      }

      // Se RELEASED ou IN_PROGRESS: estorna reserva dos componentes
      if (
        order.status === ProductionOrderStatus.RELEASED ||
        order.status === ProductionOrderStatus.IN_PROGRESS
      ) {
        for (const item of order.items) {
          await tx.stockBalance.update({
            where: { warehouseId_productId: { warehouseId: order.warehouseId, productId: item.componentId } },
            data: {
              reserved: { decrement: Number(item.plannedQty) },
              available: { increment: Number(item.plannedQty) },
            },
          });
        }
      }

      const updated = await tx.productionOrder.update({
        where: { id },
        data: { status: ProductionOrderStatus.CANCELLED },
        include: ORDER_INCLUDE,
      });

      await tx.auditLog.create({
        data: {
          userId,
          companyId,
          entity: 'ProductionOrder',
          action: 'CANCEL',
          payload: { id, previousStatus: order.status },
        },
      });

      this.logger.log(`OP ${id} cancelada (era: ${order.status})`);
      return updated;
    });
  }

  // ─── S14.01: Registrar apontamento ───────────────────────────────────────

  async addLog(id: string, companyId: string, dto: CreateProductionLogDto, userId?: string) {
    const order = await this.prisma.productionOrder.findFirst({
      where: { id, companyId },
      include: { items: true },
    });

    if (!order) throw new NotFoundException(`Ordem de produção ${id} não encontrada`);

    if (order.status !== ProductionOrderStatus.IN_PROGRESS) {
      throw new BadRequestException(
        `Apontamento só é permitido em OPs IN_PROGRESS. Status atual: ${order.status}`,
      );
    }

    // Valida que qty não excede o saldo pendente (plannedQty - producedQty)
    const alreadyProduced = Number(order.producedQty);
    const planned = Number(order.plannedQty);
    if (alreadyProduced + dto.qty > planned) {
      throw new BadRequestException(
        `Quantidade apontada excede o saldo pendente. ` +
          `Planejado: ${planned}, já produzido: ${alreadyProduced}, solicitado: ${dto.qty}`,
      );
    }

    // Busca stepOrder da etapa, se informada
    let stepOrder: number | null = null;
    if (dto.routingStepId) {
      const step = await this.prisma.routingStep.findFirst({ where: { id: dto.routingStepId } });
      stepOrder = step?.stepOrder ?? null;
    }

    const log = await this.prisma.productionLog.create({
      data: {
        productionOrderId: id,
        routingStepId: dto.routingStepId ?? null,
        stepOrder,
        workCenter: dto.workCenter ?? null,
        qty: dto.qty,
        userId: userId ?? null,
        notes: dto.notes ?? null,
      },
      include: {
        user: { select: { id: true, name: true } },
        routingStep: { select: { id: true, stepOrder: true, name: true, workCenter: true } },
      },
    });

    // Acumula producedQty na OP
    await this.prisma.productionOrder.update({
      where: { id },
      data: { producedQty: { increment: dto.qty } },
    });

    this.logger.log(`Apontamento: OP ${id} +${dto.qty} (total: ${alreadyProduced + dto.qty}/${planned})`);
    return log;
  }

  // ─── S14.02: Listar apontamentos da OP ───────────────────────────────────

  async getLogs(id: string, companyId: string) {
    const order = await this.prisma.productionOrder.findFirst({ where: { id, companyId } });
    if (!order) throw new NotFoundException(`Ordem de produção ${id} não encontrada`);

    return this.prisma.productionLog.findMany({
      where: { productionOrderId: id },
      include: {
        user: { select: { id: true, name: true } },
        routingStep: { select: { id: true, stepOrder: true, name: true, workCenter: true } },
      },
      orderBy: { loggedAt: 'asc' },
    });
  }

  // ─── S14.03: Progresso da OP ──────────────────────────────────────────────

  async getProgress(id: string, companyId: string) {
    const order = await this.prisma.productionOrder.findFirst({
      where: { id, companyId },
      include: {
        items: { include: { component: { select: { id: true, sku: true, name: true, unit: true } } } },
        logs: {
          include: { routingStep: { select: { id: true, stepOrder: true, name: true } } },
          orderBy: { loggedAt: 'asc' },
        },
        product: { select: { id: true, sku: true, name: true, unit: true } },
      },
    });

    if (!order) throw new NotFoundException(`Ordem de produção ${id} não encontrada`);

    const plannedQty = Number(order.plannedQty);
    const producedQty = Number(order.producedQty);
    const pctComplete = plannedQty > 0 ? Math.min(100, (producedQty / plannedQty) * 100) : 0;

    // Agrega qty por etapa do roteiro
    const byStep = new Map<string, { stepOrder: number; stepName: string; totalQty: number; entries: number }>();
    for (const log of order.logs) {
      const key = log.routingStepId ?? '__no_step__';
      if (!byStep.has(key)) {
        byStep.set(key, {
          stepOrder: log.stepOrder ?? 0,
          stepName: log.routingStep?.name ?? 'Sem etapa',
          totalQty: 0,
          entries: 0,
        });
      }
      const entry = byStep.get(key)!;
      entry.totalQty += Number(log.qty);
      entry.entries += 1;
    }

    return {
      id: order.id,
      product: order.product,
      status: order.status,
      plannedQty,
      producedQty,
      pctComplete: Math.round(pctComplete * 10) / 10,
      totalLogs: order.logs.length,
      byStep: Array.from(byStep.values()).sort((a, b) => a.stepOrder - b.stepOrder),
      components: order.items.map((item) => ({
        component: item.component,
        plannedQty: Number(item.plannedQty),
        consumedQty: Number(item.consumedQty),
        pctConsumed:
          Number(item.plannedQty) > 0
            ? Math.round((Number(item.consumedQty) / Number(item.plannedQty)) * 1000) / 10
            : 0,
      })),
    };
  }

  // ─── S16.01: Custo da OP ──────────────────────────────────────────────────

  async getCost(id: string, companyId: string) {
    const order = await this.prisma.productionOrder.findFirst({
      where: { id, companyId },
      select: { id: true, status: true, plannedQty: true, producedQty: true, completedAt: true },
    });

    if (!order) throw new NotFoundException(`Ordem de produção ${id} não encontrada`);

    const cost = await this.prisma.productionCost.findUnique({
      where: { productionOrderId: id },
    });

    if (!cost) {
      throw new NotFoundException(
        `Custo da OP ${id} ainda não calculado. O custo é registrado ao encerrar a OP (status DONE).`,
      );
    }

    return {
      orderId: id,
      status: order.status,
      plannedQty: Number(order.plannedQty),
      producedQty: Number(order.producedQty),
      completedAt: order.completedAt,
      materialCost: Number(cost.materialCost),
      laborCost: Number(cost.laborCost),
      totalCost: Number(cost.totalCost),
      costPerUnit: Number(cost.costPerUnit),
      breakdown: cost.breakdown,
    };
  }
}
