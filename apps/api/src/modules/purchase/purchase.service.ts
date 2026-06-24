import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PurchaseOrderStatus, PurchaseRequestStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { computeAvgCost } from '../stock/avg-cost';
import { GOODS_RECEIVED_EVENT, GoodsReceivedEvent } from '../stock/events/goods-received.event';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto';

const APPROVER_ROLES = ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER'];

@Injectable()
export class PurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Pedido de Compra ────────────────────────────────────────────────────

  async createPO(dto: CreatePurchaseOrderDto, userId?: string) {
    const po = await this.prisma.purchaseOrder.create({
      data: {
        companyId: dto.companyId,
        supplierId: dto.supplierId,
        expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : undefined,
        notes: dto.notes,
        createdById: userId,
        status: PurchaseOrderStatus.DRAFT,
        items: {
          create: dto.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitCost: item.unitCost,
            unit: (item.unit as any) ?? 'UN',
          })),
        },
      },
      include: { items: { include: { product: true } }, supplier: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId: dto.companyId,
        entity: 'PurchaseOrder',
        action: 'CREATE',
        payload: { purchaseOrderId: po.id, supplierId: dto.supplierId, itemCount: dto.items.length },
      },
    });

    return po;
  }

  async updatePO(id: string, dto: UpdatePurchaseOrderDto, companyId: string, userId?: string) {
    const po = await this.prisma.purchaseOrder.findFirst({ where: { id, companyId } });

    if (!po) throw new NotFoundException(`Pedido de compra ${id} não encontrado`);
    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException('Apenas pedidos em rascunho podem ser editados');
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        supplierId: dto.supplierId,
        expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : undefined,
        notes: dto.notes,
        ...(dto.items && {
          items: {
            deleteMany: {},
            create: dto.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitCost: item.unitCost,
              unit: (item.unit as any) ?? 'UN',
            })),
          },
        }),
      },
      include: { items: { include: { product: true } }, supplier: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: 'PurchaseOrder',
        action: 'UPDATE',
        payload: { purchaseOrderId: id },
      },
    });

    return updated;
  }

  async findAll(companyId: string) {
    return this.prisma.purchaseOrder.findMany({
      where: { companyId },
      include: {
        supplier: true,
        items: { include: { product: true } },
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, companyId },
      include: {
        supplier: true,
        items: { include: { product: true } },
        receipts: { include: { items: { include: { product: true } }, warehouse: true } },
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });

    if (!po) throw new NotFoundException(`Pedido de compra ${id} não encontrado`);
    return po;
  }

  // ─── Aprovação (S05.03) ──────────────────────────────────────────────────

  async approvePO(id: string, companyId: string, userId: string, userRole: string) {
    if (!APPROVER_ROLES.includes(userRole)) {
      throw new ForbiddenException('Apenas Diretores e Gerentes podem aprovar pedidos de compra');
    }

    const po = await this.prisma.purchaseOrder.findFirst({ where: { id, companyId } });
    if (!po) throw new NotFoundException(`Pedido de compra ${id} não encontrado`);
    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException(
        `Pedido não pode ser aprovado pois está com status ${po.status}`,
      );
    }
    if (po.createdById === userId) {
      throw new ForbiddenException(
        'O criador do pedido de compra não pode ser o aprovador (segregação de funções)',
      );
    }

    const itemCount = await this.prisma.pOItem.count({ where: { purchaseOrderId: id } });
    if (itemCount === 0) {
      throw new BadRequestException('Pedido sem itens não pode ser aprovado');
    }

    const approved = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.APPROVED,
        approvedById: userId,
        approvedAt: new Date(),
      },
      include: { supplier: true, items: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: 'PurchaseOrder',
        action: 'APPROVE',
        payload: { purchaseOrderId: id },
      },
    });

    return approved;
  }

  async cancelPO(id: string, companyId: string, userId?: string) {
    const po = await this.prisma.purchaseOrder.findFirst({ where: { id, companyId } });
    if (!po) throw new NotFoundException(`Pedido de compra ${id} não encontrado`);
    if (po.status === PurchaseOrderStatus.RECEIVED) {
      throw new BadRequestException('Pedido já recebido não pode ser cancelado');
    }
    if (po.status === PurchaseOrderStatus.CANCELLED) {
      throw new BadRequestException('Pedido já está cancelado');
    }

    const cancelled = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.CANCELLED },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: 'PurchaseOrder',
        action: 'CANCEL',
        payload: { purchaseOrderId: id },
      },
    });

    return cancelled;
  }

  // ─── Recebimento (S05.04 + S05.05 + S06) ────────────────────────────────

  async createReceipt(dto: CreateGoodsReceiptDto, userId?: string) {
    const receipt = await this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id: dto.purchaseOrderId },
        include: { items: true },
      });

      if (!po) throw new NotFoundException(`Pedido de compra ${dto.purchaseOrderId} não encontrado`);

      // PO deve estar APPROVED ou PARTIALLY_RECEIVED para receber
      const RECEIVABLE_STATUSES = ['APPROVED', 'PARTIALLY_RECEIVED'] as const;
      if (!RECEIVABLE_STATUSES.includes(po.status as any)) {
        throw new BadRequestException(
          `Recebimento não permitido. Pedido está com status "${po.status}". Apenas pedidos APROVADOS ou PARCIALMENTE RECEBIDOS podem ser recebidos.`,
        );
      }

      const companyId = po.companyId;

      // S17: verificar se o armazém tem WMS ativado
      const wh = await tx.warehouse.findUnique({
        where: { id: dto.warehouseId },
        select: { wmsEnabled: true },
      });
      const wmsEnabled = wh?.wmsEnabled ?? false;

      // Validar itens e divergências (S05.05)
      const grItemsData: {
        poItemId: string;
        productId: string;
        qtyOrdered: number;
        qtyReceived: number;
        unitCost: number;
        divergenceReason: string | undefined;
      }[] = [];

      for (const grItem of dto.items) {
        const poItem = po.items.find((i) => i.id === grItem.poItemId);
        if (!poItem) {
          throw new NotFoundException(`Item de PO ${grItem.poItemId} não encontrado neste pedido`);
        }

        const alreadyReceived = Number(poItem.receivedQuantity ?? 0);
        const pendingQty = Number(poItem.quantity) - alreadyReceived;

        if (grItem.qtyReceived > pendingQty) {
          throw new BadRequestException(
            `Item ${poItem.productId}: quantidade recebida (${grItem.qtyReceived}) excede o pendente (${pendingQty}).`,
          );
        }

        const hasDivergence = grItem.qtyReceived !== pendingQty;
        if (hasDivergence && !grItem.divergenceReason?.trim()) {
          throw new BadRequestException(
            `Item ${poItem.productId}: quantidade divergente (pendente: ${pendingQty}, recebido: ${grItem.qtyReceived}) exige motivo obrigatório.`,
          );
        }

        grItemsData.push({
          poItemId: poItem.id,
          productId: poItem.productId,
          qtyOrdered: Number(poItem.quantity),
          qtyReceived: grItem.qtyReceived,
          unitCost: Number(poItem.unitCost),
          divergenceReason: hasDivergence ? grItem.divergenceReason : undefined,
        });
      }

      // Criar GoodsReceipt
      const receipt = await tx.goodsReceipt.create({
        data: {
          companyId,
          purchaseOrderId: dto.purchaseOrderId,
          warehouseId: dto.warehouseId,
          receivedById: userId,
          notes: dto.notes,
          items: {
            create: grItemsData.map((item) => ({
              poItemId: item.poItemId,
              productId: item.productId,
              qtyOrdered: item.qtyOrdered,
              qtyReceived: item.qtyReceived,
              divergenceReason: item.divergenceReason,
            })),
          },
        },
        include: { items: { include: { product: true } }, warehouse: true },
      });

      // S06.02 + S06.03 + S06.04: movimentação e custo médio na mesma transação
      for (const item of grItemsData) {
        if (item.qtyReceived <= 0) continue;

        // ── Saldo no depósito ──────────────────────────────────────────────
        let balance = await tx.stockBalance.findUnique({
          where: { warehouseId_productId: { warehouseId: dto.warehouseId, productId: item.productId } },
        });

        if (!balance) {
          balance = await tx.stockBalance.create({
            data: {
              companyId,
              warehouseId: dto.warehouseId,
              productId: item.productId,
              available: 0,
              reserved: 0,
            },
          });
        }

        // ── S06.03: custo médio ponderado ──────────────────────────────────
        // Calcula sobre saldo global do produto (todos os depósitos) ANTES do incremento
        const { _sum } = await tx.stockBalance.aggregate({
          where: { productId: item.productId, companyId },
          _sum: { available: true },
        });
        const prevTotalQty = Number(_sum.available ?? 0);

        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { avgCost: true, costPrice: true },
        });
        const prevAvgCost = Number(product?.avgCost ?? product?.costPrice ?? 0);

        const newAvgCost = computeAvgCost(prevTotalQty, prevAvgCost, item.qtyReceived, item.unitCost);

        // ── Atualizar saldo (S06.02) ───────────────────────────────────────
        // WMS: itens ficam em pendingPutaway até confirmação de endereço
        await tx.stockBalance.update({
          where: { warehouseId_productId: { warehouseId: dto.warehouseId, productId: item.productId } },
          data: wmsEnabled
            ? { pendingPutaway: { increment: item.qtyReceived } }
            : { available: { increment: item.qtyReceived } },
        });

        // ── Persistir novo custo médio no produto (S06.03) ─────────────────
        await tx.product.update({
          where: { id: item.productId },
          data: { avgCost: newAvgCost },
        });

        // ── S06.05: SupplierPriceHistory ───────────────────────────────────
        await tx.supplierPriceHistory.create({
          data: {
            companyId,
            supplierId: po.supplierId,
            productId: item.productId,
            unitCost: item.unitCost,
            goodsReceiptId: receipt.id,
          },
        });

        // ── Registro de movimento (apenas para armazéns sem WMS) ─────────
        // Com WMS, o StockMovement ENTRY é criado no putaway
        if (!wmsEnabled) {
          await tx.stockMovement.create({
            data: {
              companyId,
              warehouseId: dto.warehouseId,
              productId: item.productId,
              type: 'ENTRY',
              quantity: item.qtyReceived,
              reason: `Recebimento PO #${dto.purchaseOrderId}`,
              reference: `GR:${receipt.id}`,
              userId,
            },
          });
        }
      }

      // Atualizar receivedQuantity em cada POItem
      for (const item of grItemsData) {
        await tx.pOItem.update({
          where: { id: item.poItemId },
          data: { receivedQuantity: { increment: item.qtyReceived } },
        });
      }

      // Verificar se todos os itens foram totalmente recebidos
      const updatedItems = await tx.pOItem.findMany({
        where: { purchaseOrderId: dto.purchaseOrderId },
      });
      const allFullyReceived = updatedItems.every(
        (i) => Number(i.receivedQuantity) >= Number(i.quantity),
      );

      // Marcar PO como RECEIVED ou PARTIALLY_RECEIVED
      const PO_PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED' as PurchaseOrderStatus;
      await tx.purchaseOrder.update({
        where: { id: dto.purchaseOrderId },
        data: {
          status: allFullyReceived
            ? PurchaseOrderStatus.RECEIVED
            : PO_PARTIALLY_RECEIVED,
        },
      });

      // Auditoria
      await tx.auditLog.create({
        data: {
          userId,
          companyId,
          entity: 'GoodsReceipt',
          action: 'CREATE',
          payload: {
            receiptId: receipt.id,
            purchaseOrderId: dto.purchaseOrderId,
            warehouseId: dto.warehouseId,
            itemCount: grItemsData.length,
          },
        },
      });

      return receipt;
    });

    // S06.01: emitir evento APÓS commit da transação (pós-commit, não atômico)
    this.eventEmitter.emit(
      GOODS_RECEIVED_EVENT,
      new GoodsReceivedEvent(
        receipt.companyId,
        userId,
        receipt.purchaseOrderId,
        receipt.id,
        receipt.warehouseId,
        (receipt.items as any[]).map((i) => ({
          productId: i.productId,
          qtyReceived: Number(i.qtyReceived),
          unitCost: Number(i.poItem?.unitCost ?? 0),
        })),
      ),
    );

    return receipt;
  }

  // ─── #190: Receiving Status ───────────────────────────────────────────────

  async getReceivingStatus(id: string, companyId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, companyId },
      include: { items: { include: { product: { select: { id: true, name: true, sku: true } } } } },
    });

    if (!po) throw new NotFoundException(`Pedido de compra ${id} não encontrado`);

    const items = po.items.map((item) => ({
      poItemId: item.id,
      product: item.product,
      orderedQty: Number(item.quantity),
      receivedQty: Number(item.receivedQuantity),
      pendingQty: Math.max(0, Number(item.quantity) - Number(item.receivedQuantity)),
      fullyReceived: Number(item.receivedQuantity) >= Number(item.quantity),
    }));

    return {
      purchaseOrderId: po.id,
      status: po.status,
      items,
      allFullyReceived: items.every((i) => i.fullyReceived),
    };
  }

  // ─── S05.07: PurchaseRequest CRUD ────────────────────────────────────────

  async createRequest(dto: CreatePurchaseRequestDto, userId?: string) {
    return this.prisma.purchaseRequest.create({
      data: {
        companyId: dto.companyId,
        productId: dto.productId,
        quantity: dto.quantity,
        neededBy: dto.neededBy ? new Date(dto.neededBy) : undefined,
        justification: dto.justification,
        requestedById: userId,
        status: PurchaseRequestStatus.OPEN,
      },
      include: { product: { select: { id: true, name: true, sku: true } }, requestedBy: { select: { id: true, name: true } } },
    });
  }

  async findRequests(companyId: string, status?: PurchaseRequestStatus) {
    return this.prisma.purchaseRequest.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true } },
        requestedBy: { select: { id: true, name: true } },
        convertedTo: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cancelRequest(id: string, companyId: string) {
    const req = await this.prisma.purchaseRequest.findFirst({ where: { id, companyId } });
    if (!req) throw new NotFoundException(`Solicitação ${id} não encontrada`);
    if (req.status === PurchaseRequestStatus.CONVERTED) {
      throw new BadRequestException('Solicitação já convertida em PO não pode ser cancelada');
    }
    return this.prisma.purchaseRequest.update({
      where: { id },
      data: { status: PurchaseRequestStatus.CANCELLED },
    });
  }

  async convertRequestToPO(id: string, companyId: string, supplierId: string, unitCost: number, userId?: string) {
    const req = await this.prisma.purchaseRequest.findFirst({ where: { id, companyId }, include: { product: true } });
    if (!req) throw new NotFoundException(`Solicitação ${id} não encontrada`);
    if (req.status !== PurchaseRequestStatus.OPEN && req.status !== PurchaseRequestStatus.APPROVED) {
      throw new BadRequestException(`Solicitação com status ${req.status} não pode ser convertida em PO`);
    }

    const po = await this.prisma.purchaseOrder.create({
      data: {
        companyId,
        supplierId,
        notes: req.justification ?? undefined,
        expectedAt: req.neededBy ?? undefined,
        createdById: userId,
        status: PurchaseOrderStatus.DRAFT,
        items: {
          create: [{ productId: req.productId, quantity: Number(req.quantity), unitCost, unit: req.unit }],
        },
      },
      include: { items: true, supplier: true },
    });

    await this.prisma.purchaseRequest.update({
      where: { id },
      data: { status: PurchaseRequestStatus.CONVERTED, convertedToId: po.id },
    });

    return po;
  }

  // ─── S06.05: SupplierPriceHistory ────────────────────────────────────────

  async findSupplierPriceHistory(companyId: string, supplierId?: string, productId?: string) {
    return this.prisma.supplierPriceHistory.findMany({
      where: {
        companyId,
        ...(supplierId ? { supplierId } : {}),
        ...(productId ? { productId } : {}),
      },
      include: {
        supplier: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, sku: true } },
      },
      orderBy: { recordedAt: 'desc' },
      take: 100,
    });
  }

  async findReceipts(companyId: string, purchaseOrderId?: string) {
    const where: any = { companyId };
    if (purchaseOrderId) where.purchaseOrderId = purchaseOrderId;

    return this.prisma.goodsReceipt.findMany({
      where,
      include: {
        purchaseOrder: { include: { supplier: true } },
        warehouse: true,
        items: { include: { product: true } },
        receivedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
