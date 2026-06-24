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

      // ─── 2. Calcular custo MOD (#182) ─────────────────────────────────────
      const logs = await tx.productionLog.findMany({
        where: { productionOrderId: id },
        select: { workCenter: true, hoursWorked: true },
      });

      let laborCost = 0;
      const laborBreakdown: { workCenter: string; hours: number; costPerHour: number; cost: number }[] = [];

      // Agregar horas por workCenter
      const hoursByWc = new Map<string, number>();
      for (const log of logs) {
        if (log.hoursWorked && log.workCenter) {
          const wc = log.workCenter;
          hoursByWc.set(wc, (hoursByWc.get(wc) ?? 0) + Number(log.hoursWorked));
        }
      }

      // Buscar costPerHour de cada WorkCenter usado
      if (hoursByWc.size > 0) {
        const wcCodes = Array.from(hoursByWc.keys());
        const workCenters = await tx.workCenter.findMany({
          where: { companyId, code: { in: wcCodes } },
          select: { code: true, costPerHour: true },
        });
        const wcCostMap = new Map(workCenters.map((wc: any) => [wc.code, Number(wc.costPerHour)]));

        for (const [wcCode, hours] of hoursByWc.entries()) {
          const cph = wcCostMap.get(wcCode) ?? 0;
          const cost = hours * cph;
          laborCost += cost;
          laborBreakdown.push({ workCenter: wcCode, hours, costPerHour: cph, cost });
        }
      }

      // ─── 2b. Registrar custo da OP ────────────────────────────────────────
      const totalCost = materialCost + laborCost;
      const costPerUnit = finalQty > 0 ? totalCost / finalQty : 0;

      await tx.productionCost.create({
        data: {
          productionOrderId: id,
          materialCost,
          laborCost,
          totalCost,
          costPerUnit,
          breakdown: { material: breakdown, labor: laborBreakdown } as object,
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

      // ─── 4. Inspeção final ou entrada direta (#185) ──────────────────────
      const requiresInspection = order.product.requiresFinalInspection === true;

      if (requiresInspection) {
        // Produto requer inspeção: OP fica em PENDING_INSPECTION, sem entrada no estoque
        const updated = await tx.productionOrder.update({
          where: { id },
          data: {
            status: 'PENDING_INSPECTION' as ProductionOrderStatus,
            producedQty: finalQty,
          },
          include: ORDER_INCLUDE,
        });

        // Criar registro de inspeção
        await tx.inspection.create({
          data: {
            companyId,
            type: 'FINAL',
            status: 'PENDING',
            productionOrderId: id,
            notes: `Inspeção final automática — ${finalQty} un produzidas`,
          },
        });

        await tx.auditLog.create({
          data: {
            userId,
            companyId,
            entity: 'ProductionOrder',
            action: 'PENDING_INSPECTION',
            payload: { id, plannedQty, producedQty: finalQty, totalCost, costPerUnit },
          },
        });

        this.logger.log(`OP ${id} aguardando inspeção final — ${finalQty}/${plannedQty}`);
        return { ...updated, _meta: null }; // Sem evento de produção completa até aprovação
      }

      // ─── 4b. Entrada direta no estoque (sem inspeção) ─────────────────────
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

    // Quantidade boa = qty total - refugo (#184)
    const scrapQuantity = dto.scrapQuantity ?? 0;
    const goodQuantity = dto.qty - scrapQuantity;

    if (goodQuantity < 0) {
      throw new BadRequestException('Refugo não pode ser maior que a quantidade total apontada');
    }

    // Valida que qty boa não excede o saldo pendente (plannedQty - producedQty)
    const alreadyProduced = Number(order.producedQty);
    const planned = Number(order.plannedQty);
    if (alreadyProduced + goodQuantity > planned) {
      throw new BadRequestException(
        `Quantidade boa apontada excede o saldo pendente. ` +
          `Planejado: ${planned}, já produzido: ${alreadyProduced}, boas: ${goodQuantity}`,
      );
    }

    // Calcula horas trabalhadas (#184)
    let hoursWorked: number | null = null;
    const startTime = dto.startTime ? new Date(dto.startTime) : null;
    const endTime = dto.endTime ? new Date(dto.endTime) : null;
    if (startTime && endTime) {
      const diffMs = endTime.getTime() - startTime.getTime();
      if (diffMs < 0) {
        throw new BadRequestException('endTime deve ser posterior a startTime');
      }
      hoursWorked = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
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
        scrapQuantity,
        scrapReason: scrapQuantity > 0 ? (dto.scrapReason ?? null) : null,
        startTime,
        endTime,
        hoursWorked,
        userId: userId ?? null,
        notes: dto.notes ?? null,
      },
      include: {
        user: { select: { id: true, name: true } },
        routingStep: { select: { id: true, stepOrder: true, name: true, workCenter: true } },
      },
    });

    // Acumula apenas quantidade boa na OP (não refugo)
    if (goodQuantity > 0) {
      await this.prisma.productionOrder.update({
        where: { id },
        data: { producedQty: { increment: goodQuantity } },
      });
    }

    this.logger.log(
      `Apontamento: OP ${id} +${goodQuantity} boas, ${scrapQuantity} refugo ` +
        `(total: ${alreadyProduced + goodQuantity}/${planned})` +
        (hoursWorked ? ` | ${hoursWorked}h` : ''),
    );
    return log;
  }

  // ─── Métricas de refugo (#184) ────────────────────────────────────────────

  async getScrapMetrics(
    companyId: string,
    opts: { from?: string; to?: string; workCenterId?: string },
  ) {
    const where: any = {
      productionOrder: { companyId },
      scrapQuantity: { gt: 0 },
    };
    if (opts.from || opts.to) {
      where.loggedAt = {};
      if (opts.from) where.loggedAt.gte = new Date(opts.from);
      if (opts.to) where.loggedAt.lte = new Date(opts.to);
    }
    if (opts.workCenterId) {
      where.workCenter = opts.workCenterId;
    }

    const logs = await this.prisma.productionLog.findMany({
      where,
      select: {
        qty: true,
        scrapQuantity: true,
        scrapReason: true,
        workCenter: true,
        productionOrderId: true,
        loggedAt: true,
      },
    });

    let totalQty = 0;
    let totalScrap = 0;
    const byWorkCenter = new Map<string, { qty: number; scrap: number }>();
    const byReason = new Map<string, number>();

    for (const log of logs) {
      const qty = Number(log.qty);
      const scrap = Number(log.scrapQuantity);
      totalQty += qty;
      totalScrap += scrap;

      const wc = log.workCenter ?? 'SEM_WC';
      const wcEntry = byWorkCenter.get(wc) ?? { qty: 0, scrap: 0 };
      wcEntry.qty += qty;
      wcEntry.scrap += scrap;
      byWorkCenter.set(wc, wcEntry);

      const reason = log.scrapReason ?? 'Não especificado';
      byReason.set(reason, (byReason.get(reason) ?? 0) + scrap);
    }

    return {
      totalQty,
      totalScrap,
      scrapPct: totalQty > 0 ? Math.round((totalScrap / totalQty) * 10000) / 100 : 0,
      entries: logs.length,
      byWorkCenter: Array.from(byWorkCenter.entries()).map(([wc, data]) => ({
        workCenter: wc,
        totalQty: data.qty,
        totalScrap: data.scrap,
        scrapPct: data.qty > 0 ? Math.round((data.scrap / data.qty) * 10000) / 100 : 0,
      })),
      byReason: Array.from(byReason.entries())
        .map(([reason, scrap]) => ({ reason, scrap }))
        .sort((a, b) => b.scrap - a.scrap),
    };
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

  // ─── Aprovar inspeção final (#185) ────────────────────────────────────────

  async approveInspection(id: string, companyId: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findFirst({
        where: { id, companyId },
        include: { product: true },
      });

      if (!order) throw new NotFoundException(`OP ${id} não encontrada`);
      if (order.status !== ('PENDING_INSPECTION' as ProductionOrderStatus)) {
        throw new BadRequestException(`OP não está aguardando inspeção. Status: ${order.status}`);
      }

      const finalQty = Number(order.producedQty);

      // Entrada no estoque PA
      const paBalance = await tx.stockBalance.findUnique({
        where: { warehouseId_productId: { warehouseId: order.warehouseId, productId: order.productId } },
      });

      if (paBalance) {
        await tx.stockBalance.update({
          where: { warehouseId_productId: { warehouseId: order.warehouseId, productId: order.productId } },
          data: { available: { increment: finalQty } },
        });
      } else {
        await tx.stockBalance.create({
          data: { companyId, warehouseId: order.warehouseId, productId: order.productId, available: finalQty, reserved: 0 },
        });
      }

      await tx.stockMovement.create({
        data: {
          companyId, warehouseId: order.warehouseId, productId: order.productId,
          type: 'ENTRY', quantity: finalQty,
          reason: 'Entrada de Produto Acabado (pós-inspeção)',
          reference: `OP:${id}`, userId,
        },
      });

      // Atualizar inspeção
      await tx.inspection.updateMany({
        where: { productionOrderId: id, status: 'PENDING' },
        data: { status: 'PASSED', finishedAt: new Date(), inspectedById: userId ?? null },
      });

      const updated = await tx.productionOrder.update({
        where: { id },
        data: { status: ProductionOrderStatus.DONE, completedAt: new Date() },
        include: ORDER_INCLUDE,
      });

      await tx.auditLog.create({
        data: { userId, companyId, entity: 'ProductionOrder', action: 'INSPECTION_APPROVED', payload: { id, producedQty: finalQty } },
      });

      this.logger.log(`OP ${id} inspeção aprovada — ${finalQty} un entram no estoque`);

      // Emitir evento de produção completa
      this.eventEmitter.emit(
        PRODUCTION_COMPLETED_EVENT,
        new ProductionCompletedEvent(companyId, id, order.productId, order.warehouseId, finalQty, userId),
      );

      return updated;
    });
  }

  // ─── Rejeitar inspeção final (#185) ───────────────────────────────────────

  async rejectInspection(id: string, companyId: string, reason: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findFirst({ where: { id, companyId } });

      if (!order) throw new NotFoundException(`OP ${id} não encontrada`);
      if (order.status !== ('PENDING_INSPECTION' as ProductionOrderStatus)) {
        throw new BadRequestException(`OP não está aguardando inspeção. Status: ${order.status}`);
      }

      // Atualizar inspeção para FAILED
      await tx.inspection.updateMany({
        where: { productionOrderId: id, status: 'PENDING' },
        data: { status: 'FAILED', finishedAt: new Date(), inspectedById: userId ?? null, notes: reason },
      });

      // Criar NCR (Non-Conformance Report)
      await tx.nonConformance.create({
        data: {
          companyId,
          productionOrderId: id,
          productId: order.productId,
          description: reason,
          severity: 'MAJOR',
          status: 'OPEN',
          reportedById: userId ?? null,
        },
      });

      // OP fica CANCELLED (bloqueada)
      const updated = await tx.productionOrder.update({
        where: { id },
        data: { status: ProductionOrderStatus.CANCELLED },
        include: ORDER_INCLUDE,
      });

      await tx.auditLog.create({
        data: { userId, companyId, entity: 'ProductionOrder', action: 'INSPECTION_REJECTED', payload: { id, reason } },
      });

      this.logger.log(`OP ${id} inspeção rejeitada — NCR criado: ${reason}`);
      return updated;
    });
  }
}
