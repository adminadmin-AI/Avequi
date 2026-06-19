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
