import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GoodsReceivedEvent } from '../stock/events/goods-received.event';
import { SaleInvoicedEvent } from '../sales/events/sale-invoiced.event';
import { CreateLocationDto } from './dto/create-location.dto';
import { ConfirmPutawayDto } from './dto/confirm-putaway.dto';
import { ConfirmPickTaskDto } from './dto/confirm-pick-task.dto';
import { CreateInventoryCountDto } from './dto/create-inventory-count.dto';
import { RecordCountDto } from './dto/record-count.dto';

@Injectable()
export class WmsService {
  private readonly logger = new Logger(WmsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── S17.01: Criar endereço físico ────────────────────────────────────────

  async createLocation(dto: CreateLocationDto) {
    return this.prisma.location.create({
      data: {
        companyId: dto.companyId,
        warehouseId: dto.warehouseId,
        code: dto.code,
        description: dto.description ?? null,
        type: dto.type ?? 'STORAGE',
      },
    });
  }

  // ─── S17.02: Listar endereços ─────────────────────────────────────────────

  async findLocations(companyId: string, warehouseId?: string) {
    return this.prisma.location.findMany({
      where: { companyId, ...(warehouseId ? { warehouseId } : {}), isActive: true },
      orderBy: [{ warehouseId: 'asc' }, { code: 'asc' }],
    });
  }

  // ─── S17.03: Listar Receiving Orders ─────────────────────────────────────

  async findReceivingOrders(companyId: string, status?: string) {
    return this.prisma.receivingOrder.findMany({
      where: { companyId, ...(status ? { status: status as any } : {}) },
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        goodsReceipt: { select: { id: true, createdAt: true } },
        _count: { select: { tasks: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── S17.04: Detalhe da Receiving Order ──────────────────────────────────

  async findReceivingOrder(id: string, companyId: string) {
    const order = await this.prisma.receivingOrder.findFirst({
      where: { id, companyId },
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        goodsReceipt: { select: { id: true, notes: true, createdAt: true } },
        tasks: {
          include: {
            product: { select: { id: true, sku: true, name: true, unit: true } },
            location: { select: { id: true, code: true, type: true } },
            confirmedBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!order) throw new NotFoundException(`Receiving Order ${id} não encontrada`);
    return order;
  }

  // ─── S17.05: Relatório de recebimento ─────────────────────────────────────

  async getReceivingReport(id: string, companyId: string) {
    const order = await this.findReceivingOrder(id, companyId);

    const totalTasks = order.tasks.length;
    const confirmedTasks = order.tasks.filter((t) => t.status === 'CONFIRMED').length;
    const pendingTasks = totalTasks - confirmedTasks;

    return {
      id: order.id,
      status: order.status,
      warehouse: order.warehouse,
      goodsReceiptId: order.goodsReceiptId,
      totalTasks,
      confirmedTasks,
      pendingTasks,
      pctComplete: totalTasks > 0 ? Math.round((confirmedTasks / totalTasks) * 100) : 0,
      tasks: order.tasks.map((t) => ({
        id: t.id,
        product: t.product,
        qty: Number(t.qty),
        status: t.status,
        location: t.location,
        confirmedBy: t.confirmedBy,
        confirmedAt: t.confirmedAt,
      })),
    };
  }

  // ─── S17.06: Confirmar putaway ────────────────────────────────────────────

  async confirmPutaway(
    orderId: string,
    taskId: string,
    companyId: string,
    dto: ConfirmPutawayDto,
    userId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.putawayTask.findFirst({
        where: { id: taskId, receivingOrderId: orderId, companyId },
        include: { receivingOrder: true },
      });

      if (!task) throw new NotFoundException(`Tarefa de putaway ${taskId} não encontrada`);
      if (task.status === 'CONFIRMED') {
        throw new BadRequestException('Tarefa já confirmada');
      }

      // Valida location
      const location = await tx.location.findFirst({
        where: { id: dto.locationId, companyId, isActive: true },
      });
      if (!location) throw new NotFoundException(`Endereço ${dto.locationId} não encontrado`);

      const warehouseId = task.receivingOrder.warehouseId;
      if (location.warehouseId !== warehouseId) {
        throw new BadRequestException('Endereço pertence a outro armazém');
      }

      const qty = Number(task.qty);

      // Atualiza saldo: pendingPutaway → available
      const balance = await tx.stockBalance.findUnique({
        where: { warehouseId_productId: { warehouseId, productId: task.productId } },
      });

      if (!balance) {
        throw new BadRequestException(`Saldo de ${task.productId} não encontrado no armazém`);
      }

      await tx.stockBalance.update({
        where: { warehouseId_productId: { warehouseId, productId: task.productId } },
        data: {
          pendingPutaway: { decrement: qty },
          available: { increment: qty },
        },
      });

      // Movimento de entrada (físico confirmado)
      await tx.stockMovement.create({
        data: {
          companyId,
          warehouseId,
          productId: task.productId,
          type: 'ENTRY',
          quantity: qty,
          reason: `Putaway confirmado — endereço ${location.code}`,
          reference: `RO:${orderId}`,
          userId,
        },
      });

      // Confirma tarefa
      const updatedTask = await tx.putawayTask.update({
        where: { id: taskId },
        data: {
          status: 'CONFIRMED',
          locationId: dto.locationId,
          confirmedById: userId ?? null,
          confirmedAt: new Date(),
        },
        include: {
          product: { select: { id: true, sku: true, name: true, unit: true } },
          location: { select: { id: true, code: true, type: true } },
        },
      });

      // Verifica se todas as tasks da RO estão confirmadas
      const pendingCount = await tx.putawayTask.count({
        where: { receivingOrderId: orderId, status: 'PENDING' },
      });

      if (pendingCount === 0) {
        await tx.receivingOrder.update({
          where: { id: orderId },
          data: { status: 'DONE' },
        });
        this.logger.log(`Receiving Order ${orderId} concluída — todas as tarefas confirmadas`);
      } else {
        await tx.receivingOrder.update({
          where: { id: orderId },
          data: { status: 'IN_PROGRESS' },
        });
      }

      await tx.auditLog.create({
        data: {
          userId,
          companyId,
          entity: 'PutawayTask',
          action: 'CONFIRM',
          payload: { taskId, orderId, locationId: dto.locationId, qty },
        },
      });

      this.logger.log(`Putaway: ${task.productId} × ${qty} → ${location.code}`);
      return updatedTask;
    });
  }

  // ─── S18.01: Criar PickingOrder (chamado pelo listener SaleInvoiced) ────────

  async createPickingOrder(event: SaleInvoicedEvent) {
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: event.warehouseId },
      select: { wmsEnabled: true },
    });

    if (!warehouse?.wmsEnabled) return; // WMS desativado para este armazém

    const order = await this.prisma.pickingOrder.create({
      data: {
        companyId: event.companyId,
        salesOrderId: event.salesOrderId,
        warehouseId: event.warehouseId,
        tasks: {
          create: event.items
            .filter((i) => i.quantity > 0)
            .map((i) => ({
              companyId: event.companyId,
              productId: i.productId,
              qty: i.quantity,
            })),
        },
      },
    });

    this.logger.log(
      `PickingOrder ${order.id} criada para SO ${event.salesOrderId} — ${event.items.length} tasks`,
    );
  }

  // ─── S18.02: Listar PickingOrders ────────────────────────────────────────

  async findPickingOrders(companyId: string, status?: string) {
    return this.prisma.pickingOrder.findMany({
      where: { companyId, ...(status ? { status: status as any } : {}) },
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        salesOrder: { select: { id: true, status: true, createdAt: true } },
        _count: { select: { tasks: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── S18.03: Detalhe da PickingOrder ─────────────────────────────────────

  async findPickingOrder(id: string, companyId: string) {
    const order = await this.prisma.pickingOrder.findFirst({
      where: { id, companyId },
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        salesOrder: { select: { id: true, status: true, notes: true, createdAt: true } },
        tasks: {
          include: {
            product: { select: { id: true, sku: true, name: true, unit: true } },
            location: { select: { id: true, code: true, type: true } },
            confirmedBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!order) throw new NotFoundException(`Picking Order ${id} não encontrada`);
    return order;
  }

  // ─── S18.04: Relatório de picking ────────────────────────────────────────

  async getPickingReport(id: string, companyId: string) {
    const order = await this.findPickingOrder(id, companyId);

    const totalTasks = order.tasks.length;
    const confirmedTasks = order.tasks.filter((t) => t.status === 'CONFIRMED').length;
    const pendingTasks = totalTasks - confirmedTasks;

    return {
      id: order.id,
      status: order.status,
      warehouse: order.warehouse,
      salesOrderId: order.salesOrderId,
      totalTasks,
      confirmedTasks,
      pendingTasks,
      pctComplete: totalTasks > 0 ? Math.round((confirmedTasks / totalTasks) * 100) : 0,
      tasks: order.tasks.map((t) => ({
        id: t.id,
        product: t.product,
        qty: Number(t.qty),
        status: t.status,
        location: t.location,
        notes: t.notes,
        confirmedBy: t.confirmedBy,
        confirmedAt: t.confirmedAt,
      })),
    };
  }

  // ─── S18.05: Confirmar pick task ──────────────────────────────────────────

  async confirmPickTask(
    orderId: string,
    taskId: string,
    companyId: string,
    dto: ConfirmPickTaskDto,
    userId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.pickTask.findFirst({
        where: { id: taskId, pickingOrderId: orderId, companyId },
      });

      if (!task) throw new NotFoundException(`Tarefa de picking ${taskId} não encontrada`);
      if (task.status === 'CONFIRMED') {
        throw new BadRequestException('Tarefa já confirmada');
      }

      // Valida location (opcional — operador pode registrar de onde pegou)
      if (dto.locationId) {
        const pickingOrder = await tx.pickingOrder.findUnique({
          where: { id: orderId },
          select: { warehouseId: true },
        });
        const location = await tx.location.findFirst({
          where: { id: dto.locationId, companyId, isActive: true },
        });
        if (!location) throw new NotFoundException(`Endereço ${dto.locationId} não encontrado`);
        if (location.warehouseId !== pickingOrder!.warehouseId) {
          throw new BadRequestException('Endereço pertence a outro armazém');
        }
      }

      const updatedTask = await tx.pickTask.update({
        where: { id: taskId },
        data: {
          status: 'CONFIRMED',
          locationId: dto.locationId ?? null,
          notes: dto.notes ?? null,
          confirmedById: userId ?? null,
          confirmedAt: new Date(),
        },
        include: {
          product: { select: { id: true, sku: true, name: true, unit: true } },
          location: { select: { id: true, code: true, type: true } },
        },
      });

      // Verifica se todas as tasks foram confirmadas
      const pendingCount = await tx.pickTask.count({
        where: { pickingOrderId: orderId, status: 'PENDING' },
      });

      if (pendingCount === 0) {
        await tx.pickingOrder.update({
          where: { id: orderId },
          data: { status: 'DONE' },
        });
        this.logger.log(`Picking Order ${orderId} concluída — todas as tarefas confirmadas`);
      } else {
        await tx.pickingOrder.update({
          where: { id: orderId },
          data: { status: 'IN_PROGRESS' },
        });
      }

      await tx.auditLog.create({
        data: {
          userId,
          companyId,
          entity: 'PickTask',
          action: 'CONFIRM',
          payload: {
            taskId,
            orderId,
            locationId: dto.locationId ?? null,
            qty: Number(task.qty),
          },
        },
      });

      this.logger.log(
        `PickTask: ${task.productId} × ${Number(task.qty)} confirmado por ${userId ?? 'sistema'}`,
      );
      return updatedTask;
    });
  }

  // ─── S19.01: Criar InventoryCount ────────────────────────────────────────

  async createInventoryCount(dto: CreateInventoryCountDto, companyId: string, userId?: string) {
    // Valida warehouse
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.warehouseId, companyId },
    });
    if (!warehouse) throw new NotFoundException(`Armazém ${dto.warehouseId} não encontrado`);

    // Busca saldos para popular os itens
    const balances = await this.prisma.stockBalance.findMany({
      where: {
        warehouseId: dto.warehouseId,
        ...(dto.productIds?.length ? { productId: { in: dto.productIds } } : {}),
        available: { gt: 0 },
      },
      select: { productId: true, available: true },
    });

    if (balances.length === 0) {
      throw new BadRequestException('Nenhum produto com saldo disponível encontrado para contagem');
    }

    const count = await this.prisma.inventoryCount.create({
      data: {
        companyId,
        warehouseId: dto.warehouseId,
        type: dto.type as any,
        notes: dto.notes ?? null,
        createdById: userId ?? null,
        status: 'IN_PROGRESS',
        items: {
          create: balances.map((b) => ({
            companyId,
            productId: b.productId,
            systemQty: b.available,
          })),
        },
      },
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        _count: { select: { items: true } },
      },
    });

    this.logger.log(
      `InventoryCount ${count.id} criada — ${balances.length} produtos a contar (${dto.type})`,
    );
    return count;
  }

  // ─── S19.02: Listar InventoryCounts ──────────────────────────────────────

  async findInventoryCounts(companyId: string, status?: string) {
    return this.prisma.inventoryCount.findMany({
      where: { companyId, ...(status ? { status: status as any } : {}) },
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── S19.03: Detalhe da InventoryCount ───────────────────────────────────

  async findInventoryCount(id: string, companyId: string) {
    const count = await this.prisma.inventoryCount.findFirst({
      where: { id, companyId },
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        reconciledBy: { select: { id: true, name: true } },
        items: {
          include: {
            product: { select: { id: true, sku: true, name: true, unit: true } },
            countedBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!count) throw new NotFoundException(`Contagem ${id} não encontrada`);
    return count;
  }

  // ─── S19.04: Registrar contagem física de um item ────────────────────────

  async recordCount(
    countId: string,
    itemId: string,
    companyId: string,
    dto: RecordCountDto,
    userId?: string,
  ) {
    const item = await this.prisma.inventoryCountItem.findFirst({
      where: { id: itemId, inventoryCountId: countId, companyId },
      include: { inventoryCount: { select: { status: true } } },
    });

    if (!item) throw new NotFoundException(`Item ${itemId} não encontrado na contagem ${countId}`);
    if (item.inventoryCount.status === 'RECONCILED') {
      throw new BadRequestException('Contagem já reconciliada — não é possível alterar itens');
    }

    const systemQty = Number(item.systemQty);
    const countedQty = dto.countedQty;
    const variance = countedQty - systemQty;

    const updated = await this.prisma.inventoryCountItem.update({
      where: { id: itemId },
      data: {
        countedQty,
        variance,
        status: 'COUNTED',
        countedById: userId ?? null,
        countedAt: new Date(),
      },
      include: {
        product: { select: { id: true, sku: true, name: true, unit: true } },
      },
    });

    this.logger.log(
      `Contagem: ${item.productId} — sistema ${systemQty} | contado ${countedQty} | variação ${variance}`,
    );
    return updated;
  }

  // ─── S19.05: Relatório de contagem (com variâncias) ──────────────────────

  async getInventoryReport(id: string, companyId: string) {
    const count = await this.findInventoryCount(id, companyId);

    const totalItems = count.items.length;
    const countedItems = count.items.filter((i) => i.status === 'COUNTED').length;
    const pendingItems = totalItems - countedItems;
    const itemsWithVariance = count.items.filter(
      (i) => i.variance !== null && Number(i.variance) !== 0,
    ).length;

    return {
      id: count.id,
      type: count.type,
      status: count.status,
      warehouse: count.warehouse,
      totalItems,
      countedItems,
      pendingItems,
      itemsWithVariance,
      pctComplete: totalItems > 0 ? Math.round((countedItems / totalItems) * 100) : 0,
      reconciledAt: count.reconciledAt,
      items: count.items.map((i) => ({
        id: i.id,
        product: i.product,
        systemQty: Number(i.systemQty),
        countedQty: i.countedQty !== null ? Number(i.countedQty) : null,
        variance: i.variance !== null ? Number(i.variance) : null,
        status: i.status,
        countedBy: i.countedBy,
        countedAt: i.countedAt,
      })),
    };
  }

  // ─── S19.06: Reconciliar contagem — ajusta StockBalance ──────────────────

  async reconcile(id: string, companyId: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.inventoryCount.findFirst({
        where: { id, companyId },
        include: {
          items: {
            include: { product: { select: { id: true, sku: true } } },
          },
        },
      });

      if (!count) throw new NotFoundException(`Contagem ${id} não encontrada`);
      if (count.status === 'RECONCILED') {
        throw new BadRequestException('Contagem já reconciliada');
      }

      const pendingItems = count.items.filter((i) => i.status === 'PENDING');
      if (pendingItems.length > 0) {
        throw new BadRequestException(
          `${pendingItems.length} item(ns) ainda não contado(s) — conclua a contagem antes de reconciliar`,
        );
      }

      const adjustments: Array<{ productId: string; sku: string; variance: number }> = [];

      for (const item of count.items) {
        const variance = Number(item.variance ?? 0);
        if (variance === 0) continue;

        const warehouseId = count.warehouseId;

        // Ajusta StockBalance
        await tx.stockBalance.upsert({
          where: { warehouseId_productId: { warehouseId, productId: item.productId } },
          create: {
            companyId,
            warehouseId,
            productId: item.productId,
            available: Math.max(0, Number(item.countedQty ?? 0)),
          },
          update: {
            available: { increment: variance },
          },
        });

        // Cria StockMovement de ajuste
        await tx.stockMovement.create({
          data: {
            companyId,
            warehouseId,
            productId: item.productId,
            type: variance > 0 ? 'ENTRY' : 'EXIT',
            quantity: Math.abs(variance),
            reason: `Ajuste de inventário — Contagem ${id}`,
            reference: `INV:${id}`,
            userId,
          },
        });

        adjustments.push({ productId: item.productId, sku: item.product.sku, variance });
      }

      // Marca contagem como RECONCILED
      const reconciled = await tx.inventoryCount.update({
        where: { id },
        data: {
          status: 'RECONCILED',
          reconciledById: userId ?? null,
          reconciledAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          companyId,
          entity: 'InventoryCount',
          action: 'RECONCILE',
          payload: { countId: id, adjustments },
        },
      });

      this.logger.log(
        `InventoryCount ${id} reconciliada — ${adjustments.length} ajuste(s) aplicado(s)`,
      );
      return { ...reconciled, adjustments };
    });
  }

  // ─── S17.07: Criar ReceivingOrder (chamado pelo listener) ─────────────────

  async createReceivingOrder(event: GoodsReceivedEvent) {
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: event.warehouseId },
      select: { wmsEnabled: true },
    });

    if (!warehouse?.wmsEnabled) return; // WMS desativado para este armazém

    const order = await this.prisma.receivingOrder.create({
      data: {
        companyId: event.companyId,
        goodsReceiptId: event.goodsReceiptId,
        warehouseId: event.warehouseId,
        tasks: {
          create: event.items
            .filter((i) => i.qtyReceived > 0)
            .map((i) => ({
              companyId: event.companyId,
              productId: i.productId,
              qty: i.qtyReceived,
            })),
        },
      },
    });

    this.logger.log(
      `ReceivingOrder ${order.id} criada para GR ${event.goodsReceiptId} — ${event.items.length} tasks`,
    );
  }
}
