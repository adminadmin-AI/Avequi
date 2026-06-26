import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BatchEventType, BatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdjustBatchDto } from './dto/adjust-batch.dto';
import { ConsumeBatchDto } from './dto/consume-batch.dto';
import { CreateBatchDto } from './dto/create-batch.dto';

@Injectable()
export class BatchService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Private helper ───────────────────────────────────────────────────────

  private async addEvent(
    tx: Prisma.TransactionClient,
    batchId: string,
    type: BatchEventType,
    quantity: Prisma.Decimal | number,
    qtyBefore: Prisma.Decimal | number,
    qtyAfter: Prisma.Decimal | number,
    extra?: {
      productionOrderId?: string;
      warehouseFromId?: string;
      warehouseTo?: string;
      reference?: string;
      notes?: string;
      userId?: string;
    },
  ) {
    return tx.batchEvent.create({
      data: {
        batchId,
        type,
        quantity: new Prisma.Decimal(quantity.toString()),
        qtyBefore: new Prisma.Decimal(qtyBefore.toString()),
        qtyAfter: new Prisma.Decimal(qtyAfter.toString()),
        ...(extra ?? {}),
      },
    });
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  async create(companyId: string, dto: CreateBatchDto, userId?: string) {
    const existing = await this.prisma.batch.findUnique({
      where: {
        companyId_batchNumber_productId: {
          companyId,
          batchNumber: dto.batchNumber,
          productId: dto.productId,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        `Lote ${dto.batchNumber} já existe para este produto nesta empresa`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const qty = new Prisma.Decimal(dto.initialQty.toString());
      const batch = await tx.batch.create({
        data: {
          companyId,
          batchNumber: dto.batchNumber,
          productId: dto.productId,
          supplierId: dto.supplierId,
          goodsReceiptId: dto.goodsReceiptId,
          initialQty: qty,
          currentQty: qty,
          unit: dto.unit as any,
          manufacturingDate: dto.manufacturingDate
            ? new Date(dto.manufacturingDate)
            : undefined,
          expirationDate: dto.expirationDate
            ? new Date(dto.expirationDate)
            : undefined,
          warehouseId: dto.warehouseId,
          notes: dto.notes,
        },
      });

      await this.addEvent(tx, batch.id, BatchEventType.RECEIPT, qty, 0, qty, {
        userId,
        reference: dto.goodsReceiptId,
        notes: dto.notes,
      });

      return batch;
    });
  }

  // ─── List ─────────────────────────────────────────────────────────────────

  async list(
    companyId: string,
    opts: {
      status?: BatchStatus;
      productId?: string;
      supplierId?: string;
      expiringBeforeDays?: number;
    } = {},
  ) {
    const where: Prisma.BatchWhereInput = { companyId };
    if (opts.status) where.status = opts.status;
    if (opts.productId) where.productId = opts.productId;
    if (opts.supplierId) where.supplierId = opts.supplierId;
    if (opts.expiringBeforeDays !== undefined) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + opts.expiringBeforeDays);
      where.expirationDate = { lte: cutoff };
    }

    return this.prisma.batch.findMany({
      where,
      include: {
        product: { select: { id: true, sku: true, name: true } },
        supplier: { select: { id: true, name: true } },
        warehouse: { select: { id: true, code: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── GetById ──────────────────────────────────────────────────────────────

  async getById(id: string, companyId: string) {
    const batch = await this.prisma.batch.findFirst({
      where: { id, companyId },
      include: {
        product: { select: { id: true, sku: true, name: true } },
        supplier: { select: { id: true, name: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        events: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!batch) throw new NotFoundException(`Lote ${id} não encontrado`);
    return batch;
  }

  // ─── Consume ──────────────────────────────────────────────────────────────

  async consume(
    id: string,
    companyId: string,
    dto: ConsumeBatchDto,
    userId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.batch.findFirst({ where: { id, companyId } });
      if (!batch) throw new NotFoundException(`Lote ${id} não encontrado`);
      if (batch.status !== BatchStatus.ACTIVE) {
        throw new BadRequestException(
          `Lote ${batch.batchNumber} não está ACTIVE (status: ${batch.status})`,
        );
      }

      const qty = new Prisma.Decimal(dto.quantity.toString());
      if (qty.greaterThan(batch.currentQty)) {
        throw new BadRequestException(
          `Quantidade insuficiente: disponível ${batch.currentQty}, solicitado ${qty}`,
        );
      }

      const qtyBefore = batch.currentQty;
      const qtyAfter = batch.currentQty.minus(qty);
      const newStatus =
        qtyAfter.equals(0) ? BatchStatus.CONSUMED : BatchStatus.ACTIVE;

      const updated = await tx.batch.update({
        where: { id },
        data: { currentQty: qtyAfter, status: newStatus },
      });

      await this.addEvent(
        tx,
        id,
        BatchEventType.CONSUMPTION,
        qty,
        qtyBefore,
        qtyAfter,
        {
          productionOrderId: dto.productionOrderId,
          notes: dto.notes,
          userId,
        },
      );

      // #225: Sync batch consumption with StockMovement to prevent divergence
      await tx.stockMovement.create({
        data: {
          companyId,
          warehouseId: batch.warehouseId,
          productId: batch.productId,
          type: 'EXIT',
          quantity: qty,
          reason: `Consumo de lote ${batch.batchNumber}${dto.productionOrderId ? ` — OP=${dto.productionOrderId}` : ''}`,
          userId,
        },
      });

      await tx.stockBalance.updateMany({
        where: { warehouseId: batch.warehouseId, productId: batch.productId },
        data: { available: { decrement: Number(qty) } },
      });

      return updated;
    });
  }

  // ─── Quarantine ───────────────────────────────────────────────────────────

  async quarantine(
    id: string,
    companyId: string,
    reason: string,
    userId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.batch.findFirst({ where: { id, companyId } });
      if (!batch) throw new NotFoundException(`Lote ${id} não encontrado`);
      if (batch.status !== BatchStatus.ACTIVE) {
        throw new BadRequestException(
          `Apenas lotes ACTIVE podem ir para quarentena (status: ${batch.status})`,
        );
      }

      const updated = await tx.batch.update({
        where: { id },
        data: { status: BatchStatus.QUARANTINE },
      });

      await this.addEvent(
        tx,
        id,
        BatchEventType.QUARANTINE,
        0,
        batch.currentQty,
        batch.currentQty,
        { notes: reason, userId },
      );

      return updated;
    });
  }

  // ─── Release ──────────────────────────────────────────────────────────────

  async release(id: string, companyId: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.batch.findFirst({ where: { id, companyId } });
      if (!batch) throw new NotFoundException(`Lote ${id} não encontrado`);
      if (batch.status !== BatchStatus.QUARANTINE) {
        throw new BadRequestException(
          `Apenas lotes em QUARANTINE podem ser liberados (status: ${batch.status})`,
        );
      }

      const updated = await tx.batch.update({
        where: { id },
        data: { status: BatchStatus.ACTIVE },
      });

      await this.addEvent(
        tx,
        id,
        BatchEventType.RELEASE,
        0,
        batch.currentQty,
        batch.currentQty,
        { userId },
      );

      return updated;
    });
  }

  // ─── Scrap ────────────────────────────────────────────────────────────────

  async scrap(
    id: string,
    companyId: string,
    reason: string,
    userId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.batch.findFirst({ where: { id, companyId } });
      if (!batch) throw new NotFoundException(`Lote ${id} não encontrado`);

      const qtyBefore = batch.currentQty;

      const updated = await tx.batch.update({
        where: { id },
        data: { status: BatchStatus.SCRAPPED, currentQty: 0 },
      });

      await this.addEvent(
        tx,
        id,
        BatchEventType.SCRAP,
        qtyBefore,
        qtyBefore,
        0,
        { notes: reason, userId },
      );

      // #225: Sync batch scrap with StockMovement to prevent divergence
      if (Number(qtyBefore) > 0) {
        await tx.stockMovement.create({
          data: {
            companyId,
            warehouseId: batch.warehouseId,
            productId: batch.productId,
            type: 'EXIT',
            quantity: qtyBefore,
            reason: `Refugo de lote ${batch.batchNumber} — ${reason}`,
            userId,
          },
        });

        await tx.stockBalance.updateMany({
          where: { warehouseId: batch.warehouseId, productId: batch.productId },
          data: { available: { decrement: Number(qtyBefore) } },
        });
      }

      return updated;
    });
  }

  // ─── Adjust ───────────────────────────────────────────────────────────────

  async adjust(
    id: string,
    companyId: string,
    dto: AdjustBatchDto,
    userId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.batch.findFirst({ where: { id, companyId } });
      if (!batch) throw new NotFoundException(`Lote ${id} não encontrado`);

      const newQty = new Prisma.Decimal(dto.quantity.toString());
      const qtyBefore = batch.currentQty;
      const delta = newQty.minus(qtyBefore).abs();

      const updated = await tx.batch.update({
        where: { id },
        data: { currentQty: newQty },
      });

      await this.addEvent(
        tx,
        id,
        BatchEventType.ADJUSTMENT,
        delta,
        qtyBefore,
        newQty,
        { notes: dto.notes, userId },
      );

      // #225: Sync batch adjustment with StockMovement
      if (!delta.equals(0)) {
        const isIncrease = newQty.greaterThan(qtyBefore);
        await tx.stockMovement.create({
          data: {
            companyId,
            warehouseId: batch.warehouseId,
            productId: batch.productId,
            type: isIncrease ? 'ENTRY' : 'EXIT',
            quantity: delta,
            reason: `Ajuste de lote ${batch.batchNumber}${dto.notes ? ` — ${dto.notes}` : ''}`,
            userId,
          },
        });

        await tx.stockBalance.updateMany({
          where: { warehouseId: batch.warehouseId, productId: batch.productId },
          data: {
            available: isIncrease
              ? { increment: Number(delta) }
              : { decrement: Number(delta) },
          },
        });
      }

      return updated;
    });
  }

  // ─── CheckExpired ─────────────────────────────────────────────────────────

  async checkExpired(companyId: string): Promise<number> {
    const now = new Date();
    const expiredBatches = await this.prisma.batch.findMany({
      where: {
        companyId,
        status: BatchStatus.ACTIVE,
        expirationDate: { lt: now },
      },
    });

    if (expiredBatches.length === 0) return 0;

    await this.prisma.$transaction(async (tx) => {
      for (const batch of expiredBatches) {
        await tx.batch.update({
          where: { id: batch.id },
          data: { status: BatchStatus.EXPIRED },
        });
        await this.addEvent(
          tx,
          batch.id,
          BatchEventType.EXPIRY,
          0,
          batch.currentQty,
          batch.currentQty,
          { notes: 'Auto-expirado por data de validade' },
        );
      }
    });

    return expiredBatches.length;
  }

  // ─── GetTraceability ──────────────────────────────────────────────────────

  async getTraceability(batchId: string, companyId: string) {
    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, companyId },
      include: {
        events: {
          include: {
            productionOrder: { select: { id: true, status: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        product: { select: { id: true, sku: true, name: true } },
        supplier: { select: { id: true, name: true } },
        goodsReceipt: { select: { id: true, createdAt: true } },
        warehouse: { select: { id: true, code: true, name: true } },
      },
    });
    if (!batch) throw new NotFoundException(`Lote ${batchId} não encontrado`);

    const productionOrderIds = [
      ...new Set(
        batch.events
          .filter((e) => e.productionOrderId)
          .map((e) => e.productionOrderId as string),
      ),
    ];

    return {
      batch,
      goodsReceiptId: batch.goodsReceiptId,
      productionOrderIds,
      events: batch.events,
    };
  }

  // ─── GetStats ─────────────────────────────────────────────────────────────

  async getStats(companyId: string) {
    const now = new Date();
    const in30Days = new Date();
    in30Days.setDate(in30Days.getDate() + 30);

    const [grouped, expiringIn30Days, activeBatches] = await Promise.all([
      this.prisma.batch.groupBy({
        by: ['status'],
        where: { companyId },
        _count: { _all: true },
      }),
      this.prisma.batch.count({
        where: {
          companyId,
          status: BatchStatus.ACTIVE,
          expirationDate: { gte: now, lte: in30Days },
        },
      }),
      this.prisma.batch.findMany({
        where: { companyId, status: BatchStatus.ACTIVE },
        include: {
          product: { select: { avgCost: true } },
        },
      }),
    ]);

    const counts: Record<string, number> = {
      ACTIVE: 0,
      QUARANTINE: 0,
      CONSUMED: 0,
      EXPIRED: 0,
      SCRAPPED: 0,
    };
    let total = 0;
    for (const g of grouped) {
      counts[g.status] = g._count._all;
      total += g._count._all;
    }

    let totalValue = new Prisma.Decimal(0);
    for (const b of activeBatches) {
      const avgCost = b.product.avgCost ?? new Prisma.Decimal(0);
      totalValue = totalValue.plus(b.currentQty.times(avgCost));
    }

    return {
      total,
      active: counts.ACTIVE,
      quarantine: counts.QUARANTINE,
      consumed: counts.CONSUMED,
      expired: counts.EXPIRED,
      scrapped: counts.SCRAPPED,
      expiringIn30Days,
      totalValue,
    };
  }
}
