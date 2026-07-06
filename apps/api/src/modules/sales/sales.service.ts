import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FinancialEntryStatus, SalesOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { TaxCalculationService, missingTaxRuleMessage } from '../tax/tax-calculation.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { ReturnOrderDto } from './dto/return-order.dto';
import { SALE_CONFIRMED_EVENT, SaleConfirmedEvent } from './events/sale-confirmed.event';
import { SALE_INVOICED_EVENT, SaleInvoicedEvent } from './events/sale-invoiced.event';

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly stockService: StockService,
    private readonly taxCalc: TaxCalculationService,
  ) {}

  // ─── S07.02: Criar OV em rascunho ────────────────────────────────────────

  async createOrder(dto: CreateSalesOrderDto, companyId: string, userId?: string) {
    const order = await this.prisma.salesOrder.create({
      data: {
        companyId,
        warehouseId: dto.warehouseId,
        customerId: dto.customerId,
        notes: dto.notes,
        paymentMethod: dto.paymentMethod,
        deliveryAddressId: dto.deliveryAddressId,
        // Frete → grupo transp da NF-e (#481)
        freightModality: dto.freightModality,
        freightValue: dto.freightValue,
        carrierId: dto.carrierId,
        volumesQuantity: dto.volumesQuantity,
        volumesSpecies: dto.volumesSpecies,
        createdById: userId,
        status: SalesOrderStatus.DRAFT,
        items: {
          create: dto.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            unit: (item.unit as any) ?? 'UN',
          })),
        },
      },
      include: { items: { include: { product: true } }, customer: true, warehouse: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: 'SalesOrder',
        action: 'CREATE',
        payload: { salesOrderId: order.id, itemCount: dto.items.length },
      },
    });

    return order;
  }

  // ─── S07.03: Reservar estoque (DRAFT → RESERVED) ─────────────────────────

  async reserveOrder(id: string, companyId: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findFirst({
        where: { id, companyId },
        include: { items: true },
      });

      if (!order) throw new NotFoundException(`Venda ${id} não encontrada`);
      if (order.status !== SalesOrderStatus.DRAFT) {
        throw new BadRequestException(
          `Venda não pode ser reservada. Status atual: ${order.status}`,
        );
      }
      if (order.items.length === 0) {
        throw new BadRequestException('Venda sem itens não pode ser reservada');
      }

      // #230: Use StockService facade for reserve operations
      for (const item of order.items) {
        const balance = await tx.stockBalance.findUnique({
          where: {
            warehouseId_productId: {
              warehouseId: order.warehouseId,
              productId: item.productId,
            },
          },
        });

        const available = Number(balance?.available ?? 0);
        const qty = Number(item.quantity);

        if (available < qty) {
          throw new BadRequestException(
            `Estoque insuficiente para o produto ${item.productId}. ` +
              `Disponível: ${available}, solicitado: ${qty}`,
          );
        }

        await this.stockService.reserveBalance(
          order.warehouseId, item.productId, qty, companyId, tx,
        );
      }

      const reserved = await tx.salesOrder.update({
        where: { id },
        data: { status: SalesOrderStatus.RESERVED },
        include: { items: { include: { product: true } }, customer: true, warehouse: true },
      });

      await tx.auditLog.create({
        data: {
          userId,
          companyId,
          entity: 'SalesOrder',
          action: 'RESERVE',
          payload: { salesOrderId: id, warehouseId: order.warehouseId },
        },
      });

      return reserved;
    });
  }

  // ─── S07.04a: Confirmar venda (RESERVED → AWAITING_PICKING) ────────────────
  //   Confirmação comercial. Dispara criação de PickingOrder via evento.
  //   Picking deve ser concluído antes do faturamento.

  async confirmOrder(id: string, companyId: string, userId?: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, companyId },
      include: { items: true },
    });

    if (!order) throw new NotFoundException(`Venda ${id} não encontrada`);
    if (order.status !== SalesOrderStatus.RESERVED) {
      throw new BadRequestException(
        `Venda não pode ser confirmada. Status atual: ${order.status}. ` +
          `Apenas vendas RESERVADAS podem ser confirmadas.`,
      );
    }

    const confirmed = await this.prisma.salesOrder.update({
      where: { id },
      data: { status: SalesOrderStatus.AWAITING_PICKING, confirmedAt: new Date() },
      include: { items: { include: { product: true } }, customer: true, warehouse: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: 'SalesOrder',
        action: 'CONFIRM',
        payload: { salesOrderId: id },
      },
    });

    // Emitir após commit — WMS ouve para criar PickingOrder
    this.eventEmitter.emit(
      SALE_CONFIRMED_EVENT,
      new SaleConfirmedEvent(
        confirmed.companyId,
        userId,
        confirmed.id,
        confirmed.warehouseId,
        (confirmed.items as any[]).map((i) => ({
          productId: i.productId,
          quantity: Number(i.quantity),
          unitPrice: Number(i.unitPrice),
        })),
      ),
    );

    return confirmed;
  }

  // ─── S07.04a2: Marcar como pronto para faturar (AWAITING_PICKING → READY_TO_INVOICE)
  //   Chamado pelo listener quando PickingOrder.status = DONE.

  async markReadyToInvoice(salesOrderId: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id: salesOrderId },
    });

    if (!order) throw new NotFoundException(`Venda ${salesOrderId} não encontrada`);
    if (order.status !== SalesOrderStatus.AWAITING_PICKING) {
      throw new BadRequestException(
        `Venda não pode ser marcada como pronta. Status atual: ${order.status}`,
      );
    }

    // #491: separação concluída → conferência da carga (nova etapa antes da NF-e)
    return this.prisma.salesOrder.update({
      where: { id: salesOrderId },
      data: { status: SalesOrderStatus.AWAITING_CONFERENCE, pickedAt: new Date() },
      include: { items: { include: { product: true } }, customer: true, warehouse: true },
    });
  }

  // ─── #491: Conferência da carga (AWAITING_CONFERENCE → READY_TO_INVOICE) ──
  //   Dupla checagem independente da separação: quantidades + re-scan do chassi.

  async conferOrder(
    id: string,
    companyId: string,
    dto: { items: { saleItemId: string; quantity: number; serialNumberId?: string }[] },
    userId?: string,
  ) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, companyId },
      include: { items: { include: { product: true, serialNumber: true } } },
    });
    if (!order) throw new NotFoundException(`Venda ${id} não encontrada`);
    if (order.status !== SalesOrderStatus.AWAITING_CONFERENCE) {
      throw new BadRequestException(
        `Venda não está aguardando conferência. Status atual: ${order.status}`,
      );
    }

    const divergencias: string[] = [];
    for (const item of order.items as any[]) {
      const conf = dto.items.find((c) => c.saleItemId === item.id);
      if (!conf) {
        divergencias.push(`Item ${item.product?.name ?? item.productId} não foi conferido`);
        continue;
      }
      if (Number(conf.quantity) !== Number(item.quantity)) {
        divergencias.push(
          `${item.product?.name}: conferido ${conf.quantity}, esperado ${Number(item.quantity)}`,
        );
      }
      // re-scan do chassi deve bater com o serial amarrado na separação
      if (item.product?.tracksSerial) {
        if (!item.serialNumberId) {
          divergencias.push(`${item.product.name}: sem chassi vinculado na separação`);
        } else if (conf.serialNumberId !== item.serialNumberId) {
          divergencias.push(
            `${item.product.name}: chassi conferido não confere com o separado (${item.serialNumber?.chassi ?? item.serialNumberId})`,
          );
        }
      }
    }
    if (divergencias.length > 0) {
      throw new BadRequestException(`Divergência na conferência: ${divergencias.join('; ')}`);
    }

    const conferred = await this.prisma.salesOrder.update({
      where: { id },
      data: {
        status: SalesOrderStatus.READY_TO_INVOICE,
        conferredAt: new Date(),
        conferredById: userId ?? null,
      },
      include: { items: { include: { product: true } }, customer: true, warehouse: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: 'SalesOrder',
        action: 'CONFER',
        payload: { salesOrderId: id, itemCount: dto.items.length },
      },
    });

    return conferred;
  }

  // ─── S07.04b: Faturar venda (READY_TO_INVOICE → INVOICED) — baixa estoque ──
  //   Picking deve estar concluído. Gera StockMovement EXIT e emite evento para fiscal e financeiro.

  async invoiceOrder(id: string, companyId: string, userId?: string) {
    const invoiced = await this.prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findFirst({
        where: { id, companyId },
        include: { items: { include: { product: true, serialNumber: true } }, pickingOrder: true, customer: true, company: true },
      });

      if (!order) throw new NotFoundException(`Venda ${id} não encontrada`);
      if (order.status !== SalesOrderStatus.READY_TO_INVOICE) {
        throw new BadRequestException(
          `Venda não pode ser faturada. Status atual: ${order.status}. ` +
            `Apenas vendas com picking concluído (READY_TO_INVOICE) podem ser faturadas.`,
        );
      }

      // Validação de segurança: picking deve estar DONE (se WMS ativo)
      // #220: non-WMS warehouses don't have a pickingOrder
      if (order.pickingOrder && order.pickingOrder.status !== 'DONE') {
        throw new BadRequestException(
          'Picking não concluído. Conclua todas as tarefas de picking antes de faturar.',
        );
      }

      // #498: pré-checagem de cobertura fiscal ANTES de consumir estoque —
      // sem regra cadastrada o Faturar falha limpo, com ação orientada,
      // em vez de emitir nota com tributação genérica (ex-FALLBACK_RULE)
      const ufEmpresa = order.company?.state ?? 'PR';
      const isInterstate = order.customer?.state && ufEmpresa !== order.customer.state;
      const operationType = (isInterstate ? 'VENDA_INTERESTADUAL' : 'VENDA_INTERNA') as any;
      for (const item of order.items as any[]) {
        const ruleInput = {
          companyId,
          operationType,
          ncm: item.product?.ncm ?? undefined,
          productType: item.product?.type,
          ufOrigem: ufEmpresa,
          ufDestino: order.customer?.state ?? ufEmpresa,
        };
        const rule = await this.taxCalc.findBestRule(ruleInput);
        if (!rule) {
          throw new BadRequestException(missingTaxRuleMessage(ruleInput as any));
        }
      }

      // #492: item rastreável não fatura sem chassi — a NF-e precisa do
      // veicProd do reboque que fisicamente saiu (emplacamento)
      const semChassi = (order.items as any[]).filter(
        (i) => i.product?.tracksSerial && !i.serialNumberId,
      );
      if (semChassi.length > 0) {
        throw new BadRequestException(
          `Itens sem chassi vinculado: ${semChassi.map((i) => i.product.name).join(', ')}. ` +
            'Conclua a separação escolhendo o chassi de cada unidade antes de faturar.',
        );
      }

      for (const item of order.items) {
        const qty = Number(item.quantity);

        // #230: Use StockService facade for invoice stock consumption
        await this.stockService.consumeReserved(
          order.warehouseId, item.productId, qty, companyId,
          `Faturamento OV #${id}`, userId, tx,
        );
      }

      // #492: chassis reservados na separação viram SOLD na fatura
      await tx.serialNumber.updateMany({
        where: { salesOrderId: id, status: 'RESERVED_FOR_SALE' as any },
        data: { status: 'SOLD' as any, soldAt: new Date() },
      });

      const updated = await tx.salesOrder.update({
        where: { id },
        data: { status: SalesOrderStatus.INVOICED, invoicedAt: new Date() },
        include: { items: { include: { product: true } }, customer: true, warehouse: true },
      });

      await tx.auditLog.create({
        data: {
          userId,
          companyId,
          entity: 'SalesOrder',
          action: 'INVOICE',
          payload: { salesOrderId: id, warehouseId: order.warehouseId },
        },
      });

      return updated;
    });

    // Emitir após commit — fiscal e financeiro ouvem este evento
    this.eventEmitter.emit(
      SALE_INVOICED_EVENT,
      new SaleInvoicedEvent(
        invoiced.companyId,
        userId,
        invoiced.id,
        invoiced.warehouseId,
        (invoiced.items as any[]).map((i) => ({
          saleItemId: i.id,
          productId: i.productId,
          quantity: Number(i.quantity),
          unitPrice: Number(i.unitPrice),
        })),
        (invoiced as any).customer?.type,
        (invoiced as any).customer?.state,
        (invoiced as any).company?.state,
      ),
    );

    return invoiced;
  }

  // ─── S07.06: Devolução (INVOICED → RETURNED) — entrada de estoque ─────────

  async returnOrder(id: string, companyId: string, dto: ReturnOrderDto, userId?: string) {
    const returned = await this.prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findFirst({
        where: { id, companyId },
        include: { items: true },
      });

      if (!order) throw new NotFoundException(`Venda ${id} não encontrada`);
      if (order.status !== SalesOrderStatus.INVOICED) {
        throw new BadRequestException(
          `Devolução só é permitida para vendas faturadas. Status atual: ${order.status}`,
        );
      }

      // 1. Reverter estoque: entrada de todos os itens
      // #230: Use StockService facade for return stock entry
      for (const item of order.items) {
        const qty = Number(item.quantity);
        await this.stockService.returnStock(
          order.warehouseId, item.productId, qty, companyId,
          `Devolução OV #${id}: ${dto.reason}`, userId, tx,
        );
      }

      // 2. Cancelar CR (conta a receber) vinculada (#178)
      const financialEntry = await tx.financialEntry.findFirst({
        where: { salesOrderId: id },
      });

      let crCancelled = false;
      if (financialEntry) {
        if (financialEntry.status === FinancialEntryStatus.PAID) {
          this.logger.warn(
            `CR ${financialEntry.id} da OV ${id} já foi PAGA — necessário gerar crédito manualmente`,
          );
        } else if (financialEntry.status !== FinancialEntryStatus.CANCELLED) {
          await tx.financialEntry.update({
            where: { id: financialEntry.id },
            data: { status: FinancialEntryStatus.CANCELLED },
          });
          crCancelled = true;
          this.logger.log(`CR ${financialEntry.id} → CANCELLED (devolução OV ${id})`);
        }
      }

      // 3. Atualizar status da venda
      // #492: devolução física — chassis voltam ao estoque
      await tx.serialNumber.updateMany({
        where: { salesOrderId: id, status: { in: ['SOLD', 'RESERVED_FOR_SALE'] as any } },
        data: { status: 'IN_STOCK' as any, soldAt: null, salesOrderId: null },
      });

      const updated = await tx.salesOrder.update({
        where: { id },
        data: { status: SalesOrderStatus.RETURNED, returnedAt: new Date() },
        include: { items: { include: { product: true } }, customer: true, warehouse: true },
      });

      await tx.auditLog.create({
        data: {
          userId,
          companyId,
          entity: 'SalesOrder',
          action: 'RETURN',
          payload: { salesOrderId: id, reason: dto.reason, crCancelled },
        },
      });

      return updated;
    });

    // 4. Cancelar NF-e (chamada externa, fora da transação) (#178)
    await this.cancelNfeForReturn(id, companyId, dto);

    return returned;
  }

  /**
   * Tenta cancelar a NF-e vinculada à venda.
   * Se o prazo de 24h expirou ou não há NF-e autorizada, apenas loga o aviso.
   */
  private async cancelNfeForReturn(
    salesOrderId: string,
    companyId: string,
    dto: ReturnOrderDto,
  ): Promise<void> {
    try {
      const fiscalDoc = await this.prisma.fiscalDocument.findFirst({
        where: { salesOrderId, companyId, status: 'AUTHORIZED' },
      });

      if (!fiscalDoc) {
        this.logger.log(`OV ${salesOrderId}: sem NF-e AUTHORIZED para cancelar`);
        return;
      }

      const justificativa =
        dto.justificativa ?? `Devolução de venda — ${dto.reason}`;

      const hoursElapsed = (Date.now() - fiscalDoc.createdAt.getTime()) / (1000 * 60 * 60);
      if (hoursElapsed > 24) {
        this.logger.warn(
          `NF-e ${fiscalDoc.id} da OV ${salesOrderId}: prazo de 24h expirado (${Math.floor(hoursElapsed)}h). ` +
            `Cancelamento automático não disponível — necessário Carta de Correção ou NF-e de devolução.`,
        );
        return;
      }

      // Marca o documento para cancelamento — o cancelamento efetivo na SEFAZ
      // deve ser executado via endpoint fiscal/cancel (evita dependência circular)
      await this.prisma.fiscalDocument.update({
        where: { id: fiscalDoc.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationJustification: justificativa,
        },
      });

      // Cancelar CR vinculada ao fiscalDoc (redundante mas seguro caso o CR esteja vinculado via fiscalDocumentId)
      await this.prisma.financialEntry.updateMany({
        where: { fiscalDocumentId: fiscalDoc.id, status: { not: 'CANCELLED' } },
        data: { status: 'CANCELLED' },
      });

      this.logger.log(`NF-e ${fiscalDoc.id} cancelada (devolução OV ${salesOrderId})`);
    } catch (err) {
      this.logger.error(
        `Erro ao cancelar NF-e da OV ${salesOrderId}: ${(err as Error).message}. ` +
          `Devolução concluída, cancelamento fiscal pendente.`,
      );
    }
  }

  // ─── S07.05: Cancelar venda ───────────────────────────────────────────────
  //   Permitido em DRAFT, RESERVED e CONFIRMED.
  //   RESERVED e CONFIRMED: devolve estoque reservado para disponível.
  //   INVOICED: não pode cancelar — usar devolução.

  async cancelOrder(id: string, companyId: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findFirst({
        where: { id, companyId },
        include: { items: true },
      });

      if (!order) throw new NotFoundException(`Venda ${id} não encontrada`);
      if (order.status === SalesOrderStatus.INVOICED) {
        throw new BadRequestException(
          'Venda já faturada não pode ser cancelada. Use o endpoint de devolução.',
        );
      }
      if (order.status === SalesOrderStatus.RETURNED) {
        throw new BadRequestException('Venda devolvida não pode ser cancelada');
      }
      if (order.status === SalesOrderStatus.CANCELLED) {
        throw new BadRequestException('Venda já está cancelada');
      }

      const needsStockRevert =
        order.status === SalesOrderStatus.RESERVED ||
        order.status === SalesOrderStatus.CONFIRMED ||
        order.status === SalesOrderStatus.AWAITING_PICKING ||
        order.status === SalesOrderStatus.READY_TO_INVOICE;

      // #230: Use StockService facade for cancel stock release
      if (needsStockRevert) {
        for (const item of order.items) {
          const qty = Number(item.quantity);
          await this.stockService.releaseBalance(
            order.warehouseId, item.productId, qty, tx,
          );
        }
      }

      // #492: cancelamento libera chassis reservados na separação
      await tx.serialNumber.updateMany({
        where: { salesOrderId: id, status: 'RESERVED_FOR_SALE' as any },
        data: { status: 'IN_STOCK' as any, salesOrderId: null },
      });

      const cancelled = await tx.salesOrder.update({
        where: { id },
        data: { status: SalesOrderStatus.CANCELLED, cancelledAt: new Date() },
        include: { items: { include: { product: true } }, customer: true, warehouse: true },
      });

      await tx.auditLog.create({
        data: {
          userId,
          companyId,
          entity: 'SalesOrder',
          action: 'CANCEL',
          payload: { salesOrderId: id, previousStatus: order.status },
        },
      });

      return cancelled;
    });
  }

  // ─── Consultas ────────────────────────────────────────────────────────────

  async findAll(
    companyId: string,
    filters: {
      status?: SalesOrderStatus;
      customerId?: string;
      from?: string;
      to?: string;
    } = {},
  ) {
    return this.prisma.salesOrder.findMany({
      where: {
        companyId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(filters.from || filters.to
          ? {
              createdAt: {
                ...(filters.from ? { gte: new Date(filters.from) } : {}),
                ...(filters.to ? { lte: new Date(filters.to) } : {}),
              },
            }
          : {}),
      },
      include: {
        customer: true,
        warehouse: true,
        items: { include: { product: true, serialNumber: true } }, // chassi visível na conferência (#491)
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, companyId },
      include: {
        customer: true,
        warehouse: true,
        items: { include: { product: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    if (!order) throw new NotFoundException(`Venda ${id} não encontrada`);
    return order;
  }

}
