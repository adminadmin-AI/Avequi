import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InboundNfeStatus, PurchaseOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GOODS_RECEIVED_EVENT, GoodsReceivedEvent } from '../stock/events/goods-received.event';
import { MatchNfeDto } from './dto/match-nfe.dto';
import { UploadNfeDto } from './dto/upload-nfe.dto';
import { parseNfeXml } from './nfe-xml.parser';

@Injectable()
export class InboundNfeService {
  private readonly logger = new Logger(InboundNfeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Upload e parse de XML ─────────────────────────────────────────────────

  async upload(companyId: string, dto: UploadNfeDto, userId?: string) {
    const parsed = parseNfeXml(dto.xmlContent);

    if (!parsed.chaveNfe) {
      throw new BadRequestException('XML inválido: chave NF-e não encontrada');
    }

    // Verificar duplicata
    const existing = await this.prisma.inboundNfe.findUnique({
      where: { chaveNfe: parsed.chaveNfe },
    });
    if (existing) {
      throw new BadRequestException(
        `NF-e ${parsed.chaveNfe} já importada (id: ${existing.id})`,
      );
    }

    // Auto-match: busca PO aprovada com CNPJ do fornecedor
    const matchedPo = await this.prisma.purchaseOrder.findFirst({
      where: {
        companyId,
        status: PurchaseOrderStatus.APPROVED,
        supplier: { cnpj: parsed.supplierCnpj },
      },
      orderBy: { createdAt: 'desc' },
    });

    const status: InboundNfeStatus = matchedPo
      ? InboundNfeStatus.MATCHED
      : InboundNfeStatus.PENDING;

    const nfe = await this.prisma.inboundNfe.create({
      data: {
        companyId,
        chaveNfe: parsed.chaveNfe,
        nfeNumber: parsed.nfeNumber || null,
        series: parsed.series || null,
        supplierCnpj: parsed.supplierCnpj,
        supplierName: parsed.supplierName,
        issueDate: parsed.issueDate ? new Date(parsed.issueDate) : null,
        totalValue: parsed.totalValue || null,
        status,
        purchaseOrderId: matchedPo?.id ?? null,
        xmlContent: dto.xmlContent,
        parsedItems: parsed.items as any,
        importedById: userId ?? null,
      },
      include: {
        purchaseOrder: { include: { supplier: true } },
      },
    });

    return { ...nfe, parsed };
  }

  // ─── Listagem ──────────────────────────────────────────────────────────────

  async list(companyId: string, opts: { status?: InboundNfeStatus } = {}) {
    return this.prisma.inboundNfe.findMany({
      where: {
        companyId,
        ...(opts.status ? { status: opts.status } : {}),
      },
      include: {
        purchaseOrder: { include: { supplier: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Detalhe ───────────────────────────────────────────────────────────────

  async getById(id: string, companyId: string) {
    const nfe = await this.prisma.inboundNfe.findFirst({
      where: { id, companyId },
      include: {
        purchaseOrder: { include: { supplier: true, items: { include: { product: true } } } },
        goodsReceipt: true,
        importedBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!nfe) throw new NotFoundException(`NF-e ${id} não encontrada`);
    return nfe;
  }

  // ─── Vincular a PO manualmente ─────────────────────────────────────────────

  async matchToPo(id: string, companyId: string, dto: MatchNfeDto) {
    const nfe = await this.prisma.inboundNfe.findFirst({
      where: { id, companyId },
    });
    if (!nfe) throw new NotFoundException(`NF-e ${id} não encontrada`);

    if (nfe.status === InboundNfeStatus.IMPORTED) {
      throw new BadRequestException('NF-e já importada, não pode ser vinculada novamente');
    }
    if (nfe.status === InboundNfeStatus.REJECTED) {
      throw new BadRequestException('NF-e rejeitada, não pode ser vinculada');
    }

    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: dto.purchaseOrderId, companyId },
    });
    if (!po) {
      throw new NotFoundException(
        `Pedido de compra ${dto.purchaseOrderId} não encontrado`,
      );
    }

    return this.prisma.inboundNfe.update({
      where: { id },
      data: {
        purchaseOrderId: dto.purchaseOrderId,
        status: InboundNfeStatus.MATCHED,
      },
      include: { purchaseOrder: { include: { supplier: true } } },
    });
  }

  // ─── Rejeitar ──────────────────────────────────────────────────────────────

  async reject(id: string, companyId: string, reason: string) {
    const nfe = await this.prisma.inboundNfe.findFirst({
      where: { id, companyId },
    });
    if (!nfe) throw new NotFoundException(`NF-e ${id} não encontrada`);

    if (nfe.status === InboundNfeStatus.IMPORTED) {
      throw new BadRequestException('NF-e já importada, não pode ser rejeitada');
    }

    return this.prisma.inboundNfe.update({
      where: { id },
      data: {
        status: InboundNfeStatus.REJECTED,
        rejectReason: reason,
      },
    });
  }

  // ─── Importar como GR + atualizar estoque e financeiro ─────────────────────
  // Cria GoodsReceipt, atualiza StockBalance/StockMovement e emite evento
  // para que finance.listener crie conta a pagar automaticamente.

  async importAsGr(id: string, companyId: string, userId?: string) {
    const nfe = await this.prisma.inboundNfe.findFirst({
      where: { id, companyId },
      include: {
        purchaseOrder: {
          include: {
            items: { include: { product: true } },
          },
        },
      },
    });

    if (!nfe) throw new NotFoundException(`NF-e ${id} não encontrada`);

    if (nfe.status !== InboundNfeStatus.MATCHED) {
      throw new BadRequestException(
        `NF-e deve estar com status MATCHED para importar. Status atual: ${nfe.status}`,
      );
    }

    const po = nfe.purchaseOrder!;
    const parsedItems = nfe.parsedItems as Array<{
      ncm: string;
      description: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
      cfop: string;
      ean: string;
    }>;

    // Montar GRItems — match por NCM, fallback por posição
    const grItems = parsedItems.map((nfeItem, idx) => {
      const poItem =
        po.items.find((pi) => pi.product.ncm && pi.product.ncm === nfeItem.ncm) ??
        po.items[idx];

      if (!poItem) return null;

      return {
        poItemId: poItem.id,
        productId: poItem.productId,
        qtyOrdered: poItem.quantity,
        qtyReceived: nfeItem.quantity,
        unitCost: Number(poItem.unitCost),
      };
    }).filter((item): item is NonNullable<typeof item> => item !== null);

    if (grItems.length === 0) {
      throw new BadRequestException(
        'Nenhum item da NF-e pôde ser vinculado a itens do PO',
      );
    }

    // Determinar warehouse
    const existingGr = await this.prisma.goodsReceipt.findFirst({
      where: { purchaseOrderId: po.id, companyId },
      select: { warehouseId: true },
    });
    const warehouseId =
      existingGr?.warehouseId ??
      (await this.prisma.warehouse.findFirst({
        where: { companyId, isActive: true },
        select: { id: true },
      }).then((w) => w?.id));

    if (!warehouseId) {
      throw new BadRequestException('Nenhum armazém encontrado para a empresa');
    }

    // Verificar WMS
    const wh = await this.prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { wmsEnabled: true },
    });
    const wmsEnabled = wh?.wmsEnabled ?? false;

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Criar GoodsReceipt + GRItems
      const gr = await tx.goodsReceipt.create({
        data: {
          companyId,
          purchaseOrderId: po.id,
          warehouseId,
          receivedById: userId ?? null,
          notes: `Importado via NF-e ${nfe.chaveNfe}`,
          items: {
            create: grItems.map((item) => ({
              poItemId: item.poItemId,
              productId: item.productId,
              qtyOrdered: item.qtyOrdered,
              qtyReceived: item.qtyReceived,
            })),
          },
        },
        include: { items: true },
      });

      // 2. Atualizar estoque para cada item
      for (const item of grItems) {
        if (item.qtyReceived <= 0) continue;

        // Garantir que StockBalance existe
        const existing = await tx.stockBalance.findUnique({
          where: { warehouseId_productId: { warehouseId, productId: item.productId } },
        });
        if (!existing) {
          await tx.stockBalance.create({
            data: { companyId, warehouseId, productId: item.productId, available: 0, reserved: 0 },
          });
        }

        // Atualizar saldo
        await tx.stockBalance.update({
          where: { warehouseId_productId: { warehouseId, productId: item.productId } },
          data: wmsEnabled
            ? { pendingPutaway: { increment: item.qtyReceived } }
            : { available: { increment: item.qtyReceived } },
        });

        // StockMovement ENTRY (apenas sem WMS — com WMS, criado no putaway)
        if (!wmsEnabled) {
          await tx.stockMovement.create({
            data: {
              companyId,
              warehouseId,
              productId: item.productId,
              type: 'ENTRY',
              quantity: item.qtyReceived,
              reason: `NF-e entrada ${nfe.chaveNfe} — PO #${po.id}`,
              reference: `GR:${gr.id}`,
              userId,
            },
          });
        }
      }

      // 3. Marcar NF-e como importada
      const updatedNfe = await tx.inboundNfe.update({
        where: { id },
        data: {
          status: InboundNfeStatus.IMPORTED,
          goodsReceiptId: gr.id,
          importedById: userId ?? null,
          importedAt: new Date(),
        },
      });

      return { goodsReceipt: gr, inboundNfe: updatedNfe };
    });

    // 4. Emitir evento GOODS_RECEIVED → finance.listener cria CP, wms.listener cria ReceivingOrder
    this.eventEmitter.emit(
      GOODS_RECEIVED_EVENT,
      new GoodsReceivedEvent(
        companyId,
        userId,
        po.id,
        result.goodsReceipt.id,
        warehouseId,
        grItems.map((item) => ({
          productId: item.productId,
          qtyReceived: item.qtyReceived,
          unitCost: item.unitCost,
        })),
      ),
    );

    this.logger.log(
      `NF-e ${nfe.chaveNfe} importada como GR ${result.goodsReceipt.id} — estoque e financeiro atualizados`,
    );

    return result;
  }

  // ─── Estatísticas ──────────────────────────────────────────────────────────

  async getStats(companyId: string) {
    const all = await this.prisma.inboundNfe.findMany({
      where: { companyId },
      select: { status: true },
    });

    const total = all.length;
    const pending = all.filter((n) => n.status === InboundNfeStatus.PENDING).length;
    const matched = all.filter((n) => n.status === InboundNfeStatus.MATCHED).length;
    const imported = all.filter((n) => n.status === InboundNfeStatus.IMPORTED).length;
    const rejected = all.filter((n) => n.status === InboundNfeStatus.REJECTED).length;

    const autoMatchRate =
      total > 0 ? Math.round(((matched + imported) / total) * 100) : 0;

    return { total, pending, matched, imported, rejected, autoMatchRate };
  }
}
