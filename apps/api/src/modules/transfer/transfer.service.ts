import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SerialStatus, TransferStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { DispatchTransferDto } from './dto/dispatch-transfer.dto';
import { TRANSFER_DISPATCHED_EVENT, TransferDispatchedEvent } from './events/transfer-dispatched.event';

@Injectable()
export class TransferService {
  private readonly logger = new Logger(TransferService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── S10.01: Criar transferência em DRAFT ────────────────────────────────

  async create(dto: CreateTransferDto, companyId: string, userId?: string) {
    // companyId SEMPRE vem do JWT do usuário autenticado (nunca do body)
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('Origem e destino não podem ser o mesmo depósito');
    }

    const transfer = await this.prisma.storeTransfer.create({
      data: {
        companyId,
        fromWarehouseId: dto.fromWarehouseId,
        toWarehouseId: dto.toWarehouseId,
        notes: dto.notes,
        requestedById: userId,
        status: TransferStatus.DRAFT,
        items: {
          create: dto.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unit: (item.unit as any) ?? 'UN',
          })),
        },
      },
      include: { items: { include: { product: true } }, fromWarehouse: true, toWarehouse: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: 'StoreTransfer',
        action: 'CREATE',
        payload: { storeTransferId: transfer.id, itemCount: dto.items.length },
      },
    });

    return transfer;
  }

  // ─── S10.02: Despachar — saída da fábrica, entrada em trânsito ───────────

  async dispatch(
    id: string,
    companyId: string,
    userId?: string,
    dto?: DispatchTransferDto,
  ): Promise<void> {
    const transfer = await this.prisma.storeTransfer.findFirst({
      where: { id, companyId },
      include: { items: { include: { product: true } } },
    });

    if (!transfer) throw new NotFoundException(`Transferência ${id} não encontrada`);
    if (transfer.status !== TransferStatus.DRAFT) {
      throw new BadRequestException(
        `Transferência não pode ser despachada. Status atual: ${transfer.status}`,
      );
    }

    // Override opcional de chassis por produto (#628): quando ausente, FIFO
    const serialOverride = new Map<string, string[]>(
      (dto?.serials ?? []).map((s) => [s.productId, s.serialIds]),
    );

    // Verificar saldo disponível na origem para todos os itens
    for (const item of transfer.items) {
      const balance = await this.prisma.stockBalance.findUnique({
        where: {
          warehouseId_productId: {
            warehouseId: transfer.fromWarehouseId,
            productId: item.productId,
          },
        },
      });

      const available = Number(balance?.available ?? 0);
      if (available < Number(item.quantity)) {
        throw new BadRequestException(
          `Saldo insuficiente para ${item.product.name}: disponível=${available}, solicitado=${item.quantity}`,
        );
      }
    }

    // Transação atômica: sai da origem, entra em trânsito no destino
    await this.prisma.$transaction(async (tx) => {
      for (const item of transfer.items) {
        const qty = Number(item.quantity);

        // Decrementar available na origem
        await tx.stockBalance.upsert({
          where: {
            warehouseId_productId: {
              warehouseId: transfer.fromWarehouseId,
              productId: item.productId,
            },
          },
          update: { available: { decrement: qty } },
          create: {
            companyId,
            warehouseId: transfer.fromWarehouseId,
            productId: item.productId,
            available: 0,
            reserved: 0,
            inTransit: 0,
          },
        });

        // Incrementar inTransit no destino
        await tx.stockBalance.upsert({
          where: {
            warehouseId_productId: {
              warehouseId: transfer.toWarehouseId,
              productId: item.productId,
            },
          },
          update: { inTransit: { increment: qty } },
          create: {
            companyId,
            warehouseId: transfer.toWarehouseId,
            productId: item.productId,
            available: 0,
            reserved: 0,
            inTransit: qty,
          },
        });

        // Movimento de saída na origem
        await tx.stockMovement.create({
          data: {
            companyId,
            warehouseId: transfer.fromWarehouseId,
            productId: item.productId,
            type: 'TRANSFER_OUT',
            quantity: qty,
            reason: `Transferência para ${transfer.toWarehouseId}`,
            reference: id,
            userId,
          },
        });

        // ─── #628: mover os chassis (SerialNumber) de produtos rastreáveis ────
        // FIFO por padrão, ou lista explícita (override) informada no dispatch.
        // O serial vai para IN_TRANSIT já no depósito de destino (espelha o
        // inTransit do StockBalance) e fica vinculado à transferência.
        if (item.product.tracksSerial) {
          if (!Number.isInteger(qty) || qty <= 0) {
            throw new BadRequestException(
              `Item rastreável ${item.product.name} exige quantidade inteira e positiva (recebido: ${qty})`,
            );
          }

          const override = serialOverride.get(item.productId);
          let serialIds: string[];

          if (override && override.length > 0) {
            if (override.length !== qty) {
              throw new BadRequestException(
                `Chassis informados (${override.length}) diferem da quantidade (${qty}) para ${item.product.name}`,
              );
            }
            const picked = await tx.serialNumber.findMany({
              where: { id: { in: override }, companyId, productId: item.productId },
            });
            if (picked.length !== qty) {
              throw new BadRequestException(
                `Um ou mais chassis informados não foram encontrados para ${item.product.name}`,
              );
            }
            for (const sn of picked) {
              if (sn.warehouseId !== transfer.fromWarehouseId) {
                throw new BadRequestException(
                  `Chassi ${sn.serial} não está no depósito de origem da transferência`,
                );
              }
              if (sn.status !== SerialStatus.IN_STOCK) {
                throw new BadRequestException(
                  `Chassi ${sn.serial} não está disponível (status atual: ${sn.status})`,
                );
              }
            }
            serialIds = picked.map((sn) => sn.id);
          } else {
            const picked = await tx.serialNumber.findMany({
              where: {
                companyId,
                productId: item.productId,
                warehouseId: transfer.fromWarehouseId,
                status: SerialStatus.IN_STOCK,
              },
              take: qty,
              orderBy: { createdAt: 'asc' }, // FIFO
            });
            if (picked.length < qty) {
              throw new BadRequestException(
                `Chassis insuficientes para ${item.product.name}: disponíveis=${picked.length}, necessários=${qty}`,
              );
            }
            serialIds = picked.map((sn) => sn.id);
          }

          // Guarda de concorrência: só move quem ainda está IN_STOCK. Se outra
          // transação levou o chassi (venda/despacho) entre o findMany e aqui,
          // a contagem não bate e a transação inteira reverte — evita lost-update
          // (dois despachos reivindicando o mesmo chassi).
          const moved = await tx.serialNumber.updateMany({
            where: { id: { in: serialIds }, status: SerialStatus.IN_STOCK },
            data: {
              warehouseId: transfer.toWarehouseId,
              status: SerialStatus.IN_TRANSIT,
              storeTransferId: id,
            },
          });
          if (moved.count !== qty) {
            throw new BadRequestException(
              `Chassi(s) de ${item.product.name} deixaram de estar disponíveis durante o despacho — tente novamente`,
            );
          }
        }
      }

      await tx.storeTransfer.update({
        where: { id },
        data: {
          status: TransferStatus.DISPATCHED,
          dispatchedById: userId,
          dispatchedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          companyId,
          entity: 'StoreTransfer',
          action: 'DISPATCH',
          payload: { storeTransferId: id },
        },
      });
    });

    // Evento para emissão da NF-e de transferência (fora da transação)
    const eventItems = transfer.items.map((item) => ({
      productId: item.productId,
      quantity: Number(item.quantity),
      unitCost: Number(item.product.avgCost ?? item.product.costPrice ?? 0),
      sku: item.product.sku,
      name: item.product.name,
      ncm: item.product.ncm ?? '00000000',
      unit: String(item.unit),
    }));

    this.eventEmitter.emit(
      TRANSFER_DISPATCHED_EVENT,
      new TransferDispatchedEvent(companyId, userId, id, transfer.fromWarehouseId, transfer.toWarehouseId, eventItems),
    );

    this.logger.log(`Transferência ${id} despachada — ${transfer.items.length} itens`);
  }

  // ─── S10.03: Confirmar recebimento — trânsito → disponível ───────────────

  async receive(id: string, companyId: string, userId?: string): Promise<void> {
    const transfer = await this.prisma.storeTransfer.findFirst({
      where: { id, companyId },
      include: { items: true },
    });

    if (!transfer) throw new NotFoundException(`Transferência ${id} não encontrada`);
    if (transfer.status !== TransferStatus.DISPATCHED) {
      throw new BadRequestException(
        `Transferência não pode ser recebida. Status atual: ${transfer.status}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of transfer.items) {
        const qty = Number(item.quantity);

        // Sai de inTransit e entra em available no destino
        await tx.stockBalance.update({
          where: {
            warehouseId_productId: {
              warehouseId: transfer.toWarehouseId,
              productId: item.productId,
            },
          },
          data: {
            inTransit: { decrement: qty },
            available: { increment: qty },
          },
        });

        // Movimento de entrada no destino
        await tx.stockMovement.create({
          data: {
            companyId,
            warehouseId: transfer.toWarehouseId,
            productId: item.productId,
            type: 'TRANSFER_IN',
            quantity: qty,
            reason: `Recebimento de transferência de ${transfer.fromWarehouseId}`,
            reference: id,
            userId,
          },
        });
      }

      // #628: chassis em trânsito desta transferência passam a IN_STOCK no
      // destino (o warehouseId já foi setado no dispatch) e desvinculam-se.
      await tx.serialNumber.updateMany({
        where: { storeTransferId: id, status: SerialStatus.IN_TRANSIT },
        data: { status: SerialStatus.IN_STOCK, storeTransferId: null },
      });

      await tx.storeTransfer.update({
        where: { id },
        data: {
          status: TransferStatus.RECEIVED,
          receivedById: userId,
          receivedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          companyId,
          entity: 'StoreTransfer',
          action: 'RECEIVE',
          payload: { storeTransferId: id },
        },
      });
    });

    this.logger.log(`Transferência ${id} recebida`);
  }

  // ─── S10.04: Cancelar — reverte estoque se DISPATCHED ────────────────────

  async cancel(id: string, companyId: string, userId?: string): Promise<void> {
    const transfer = await this.prisma.storeTransfer.findFirst({
      where: { id, companyId },
      include: { items: true },
    });

    if (!transfer) throw new NotFoundException(`Transferência ${id} não encontrada`);

    if (transfer.status === TransferStatus.RECEIVED) {
      throw new BadRequestException('Transferência já recebida não pode ser cancelada');
    }
    if (transfer.status === TransferStatus.CANCELLED) {
      throw new BadRequestException('Transferência já está cancelada');
    }

    await this.prisma.$transaction(async (tx) => {
      // Se DISPATCHED, reverter movimentação de estoque
      if (transfer.status === TransferStatus.DISPATCHED) {
        for (const item of transfer.items) {
          const qty = Number(item.quantity);

          // Devolver à origem
          await tx.stockBalance.update({
            where: {
              warehouseId_productId: {
                warehouseId: transfer.fromWarehouseId,
                productId: item.productId,
              },
            },
            data: { available: { increment: qty } },
          });

          // Retirar do inTransit no destino
          await tx.stockBalance.update({
            where: {
              warehouseId_productId: {
                warehouseId: transfer.toWarehouseId,
                productId: item.productId,
              },
            },
            data: { inTransit: { decrement: qty } },
          });

          // Movimento de estorno na origem
          await tx.stockMovement.create({
            data: {
              companyId,
              warehouseId: transfer.fromWarehouseId,
              productId: item.productId,
              type: 'REVERSAL',
              quantity: qty,
              reason: `Cancelamento da transferência ${id}`,
              reference: id,
              userId,
            },
          });
        }

        // #628: devolver os chassis em trânsito para IN_STOCK na origem.
        await tx.serialNumber.updateMany({
          where: { storeTransferId: id, status: SerialStatus.IN_TRANSIT },
          data: {
            warehouseId: transfer.fromWarehouseId,
            status: SerialStatus.IN_STOCK,
            storeTransferId: null,
          },
        });
      }

      await tx.storeTransfer.update({
        where: { id },
        data: { status: TransferStatus.CANCELLED, cancelledAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          userId,
          companyId,
          entity: 'StoreTransfer',
          action: 'CANCEL',
          payload: { storeTransferId: id, previousStatus: transfer.status },
        },
      });
    });

    this.logger.log(`Transferência ${id} cancelada`);
  }

  // ─── Consultas ────────────────────────────────────────────────────────────

  async findAll(companyId: string) {
    return this.prisma.storeTransfer.findMany({
      where: { companyId },
      include: {
        fromWarehouse: true,
        toWarehouse: true,
        items: { include: { product: true } },
        fiscalDocument: { select: { id: true, chave: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const transfer = await this.prisma.storeTransfer.findFirst({
      where: { id, companyId },
      include: {
        fromWarehouse: true,
        toWarehouse: true,
        items: { include: { product: true } },
        fiscalDocument: true,
        requestedBy: { select: { id: true, name: true } },
        dispatchedBy: { select: { id: true, name: true } },
        receivedBy: { select: { id: true, name: true } },
      },
    });
    if (!transfer) throw new NotFoundException(`Transferência ${id} não encontrada`);
    return transfer;
  }
}
