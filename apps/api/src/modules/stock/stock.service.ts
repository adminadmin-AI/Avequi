import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MovementType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateMovementDto } from './dto/create-movement.dto';

const OUTBOUND_TYPES: MovementType[] = [MovementType.EXIT, MovementType.TRANSFER_OUT];

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  async getBalances(companyId: string, warehouseId?: string, productId?: string) {
    const where: any = { companyId };
    if (warehouseId) where.warehouseId = warehouseId;
    if (productId) where.productId = productId;

    return this.prisma.stockBalance.findMany({
      where,
      include: {
        product: true,
        warehouse: true,
      },
      orderBy: [
        { warehouse: { code: 'asc' } },
        { product: { sku: 'asc' } },
      ],
    });
  }

  async getBalance(warehouseId: string, productId: string, companyId: string) {
    return this.prisma.stockBalance.findUnique({
      where: { warehouseId_productId: { warehouseId, productId } },
      include: {
        product: true,
        warehouse: true,
      },
    });
  }

  async move(dto: CreateMovementDto & { companyId: string }, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      // Find or create balance
      let balance = await tx.stockBalance.findUnique({
        where: { warehouseId_productId: { warehouseId: dto.warehouseId, productId: dto.productId } },
      });

      if (!balance) {
        balance = await tx.stockBalance.create({
          data: {
            companyId: dto.companyId,
            warehouseId: dto.warehouseId,
            productId: dto.productId,
            available: 0,
            reserved: 0,
          },
        });
      }

      // SELECT FOR UPDATE — row-level lock to prevent race conditions (#219)
      const [locked] = await tx.$queryRawUnsafe<{ available: any }[]>(
        `SELECT "available" FROM "gdr_stock_balances" WHERE "warehouseId" = $1 AND "productId" = $2 FOR UPDATE`,
        dto.warehouseId,
        dto.productId,
      );

      // Check sufficient stock for outbound (using locked row value)
      if (OUTBOUND_TYPES.includes(dto.type)) {
        const available = Number(locked?.available ?? balance.available);
        if (available < dto.quantity) {
          throw new BadRequestException(
            `Saldo insuficiente. Disponível: ${available}, solicitado: ${dto.quantity}`,
          );
        }
      }

      // Calculate delta
      const isOutbound = OUTBOUND_TYPES.includes(dto.type);
      const delta = isOutbound ? -dto.quantity : dto.quantity;

      // Update balance
      await tx.stockBalance.update({
        where: { warehouseId_productId: { warehouseId: dto.warehouseId, productId: dto.productId } },
        data: { available: { increment: delta } },
      });

      // Create movement (append-only)
      const movement = await tx.stockMovement.create({
        data: {
          companyId: dto.companyId,
          warehouseId: dto.warehouseId,
          productId: dto.productId,
          type: dto.type,
          quantity: dto.quantity,
          reason: dto.reason,
          reference: dto.reference,
          userId,
        },
      });

      // AuditLog
      await tx.auditLog.create({
        data: {
          userId,
          companyId: dto.companyId,
          entity: 'StockMovement',
          action: 'CREATE',
          payload: { movementId: movement.id, type: dto.type, quantity: dto.quantity },
        },
      });

      return movement;
    });
  }

  async reverse(movementId: string, reason: string, userId: string | undefined, companyId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Find original movement scoped to companyId
      const original = await tx.stockMovement.findFirst({
        where: { id: movementId, companyId },
      });

      if (!original) {
        throw new NotFoundException(`Movimento ${movementId} não encontrado`);
      }

      if (original.type === MovementType.REVERSAL) {
        throw new BadRequestException('Não é possível estornar um estorno');
      }

      if (original.reversedById) {
        throw new ConflictException('Este movimento já foi estornado');
      }

      // Calculate reverse delta (opposite of original)
      const isOutbound = OUTBOUND_TYPES.includes(original.type);
      // Reversal undoes original: if original was outbound (negative), reversal adds back (positive)
      const reverseDelta = isOutbound ? Number(original.quantity) : -Number(original.quantity);

      // If removing stock (negative delta), check balance with row lock
      if (reverseDelta < 0) {
        const [locked] = await tx.$queryRawUnsafe<{ available: any }[]>(
          `SELECT "available" FROM "gdr_stock_balances" WHERE "warehouseId" = $1 AND "productId" = $2 FOR UPDATE`,
          original.warehouseId,
          original.productId,
        );
        const available = locked ? Number(locked.available) : 0;
        const removeQty = Math.abs(reverseDelta);
        if (available < removeQty) {
          throw new BadRequestException(
            `Saldo insuficiente para estorno. Disponível: ${available}, solicitado: ${removeQty}`,
          );
        }
      }

      // Create REVERSAL movement
      const reversal = await tx.stockMovement.create({
        data: {
          companyId: original.companyId,
          warehouseId: original.warehouseId,
          productId: original.productId,
          type: MovementType.REVERSAL,
          quantity: original.quantity,
          reason,
          reference: `REVERSAL:${original.id}`,
          userId,
        },
      });

      // Update balance
      await tx.stockBalance.update({
        where: { warehouseId_productId: { warehouseId: original.warehouseId, productId: original.productId } },
        data: { available: { increment: reverseDelta } },
      });

      // Mark original as reversed (the ONE allowed update)
      await tx.stockMovement.update({
        where: { id: original.id },
        data: { reversedById: reversal.id },
      });

      // AuditLog
      await tx.auditLog.create({
        data: {
          userId,
          companyId: original.companyId,
          entity: 'StockMovement',
          action: 'REVERSAL',
          payload: { originalId: original.id, reversalId: reversal.id, reason },
        },
      });

      return reversal;
    });
  }

  async getMovements(companyId: string, warehouseId?: string, productId?: string) {
    const where: any = { companyId };
    if (warehouseId) where.warehouseId = warehouseId;
    if (productId) where.productId = productId;

    return this.prisma.stockMovement.findMany({
      where,
      take: 100,
      include: {
        product: true,
        warehouse: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
