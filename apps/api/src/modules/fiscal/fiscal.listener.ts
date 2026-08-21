import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { FiscalDocumentType, FiscalStatus, FinancialEntryStatus, FinancialEntryType } from '@prisma/client';
import { SALE_INVOICED_EVENT, SaleInvoicedEvent } from '../sales/events/sale-invoiced.event';
import { SALE_RETURNED_EVENT, SaleReturnedEvent } from '../sales/events/sale-returned.event';
import { TRANSFER_DISPATCHED_EVENT, TransferDispatchedEvent } from '../transfer/events/transfer-dispatched.event';
import { FISCAL_CANCELLED_EVENT, FiscalCancelledEvent } from './events/fiscal-cancelled.event';
import { FiscalService } from './fiscal.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Ouve eventos de negócio e dispara emissão fiscal / reversão.
 * Falha na emissão não afeta o fluxo de origem — é registrada no FiscalDocument.
 */
@Injectable()
export class FiscalListener {
  private readonly logger = new Logger(FiscalListener.name);

  constructor(
    private readonly fiscalService: FiscalService,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent(SALE_INVOICED_EVENT, { async: true })
  async handleSaleInvoiced(event: SaleInvoicedEvent): Promise<void> {
    // #222: NF-e (mod 55) para PJ ou venda interestadual; NFC-e (mod 65) para PF mesma UF.
    // Veículo (veicProd p/ emplacamento) não cabe no layout da NFC-e — sempre NF-e.
    const isCompany = event.customerType === 'COMPANY';
    const isInterstate =
      event.customerState && event.companyState && event.customerState !== event.companyState;
    const docType =
      isCompany || isInterstate || event.hasVehicle
        ? FiscalDocumentType.NFE
        : FiscalDocumentType.NFCE;

    this.logger.log(
      `Emissão fiscal OV=${event.salesOrderId} tipo=${docType} (customer=${event.customerType ?? 'N/A'}, interstate=${!!isInterstate}, vehicle=${!!event.hasVehicle})`,
    );
    try {
      await this.fiscalService.emitForSale(event.salesOrderId, docType);
    } catch (err: any) {
      // Falha fiscal nunca desfaz a venda — apenas loga
      this.logger.error(`Erro ao emitir NF para OV=${event.salesOrderId}: ${err.message}`);
    }
  }

  /**
   * #747 — Lado fiscal da devolução (a reversão interna é do returnOrder):
   * NF-e AUTHORIZED dentro das 24h → CANCELA na SEFAZ (antes só marcava
   * CANCELLED no banco, sem evento na SEFAZ); fora das 24h → emite a NF-e de
   * DEVOLUÇÃO referenciada (entrada 1202/2202, espelho da original).
   * Falha aqui nunca desfaz a devolução interna — fica no doc p/ retry.
   */
  @OnEvent(SALE_RETURNED_EVENT, { async: true })
  async handleSaleReturned(event: SaleReturnedEvent): Promise<void> {
    const doc = await this.prisma.fiscalDocument.findFirst({
      where: {
        salesOrderId: event.salesOrderId,
        companyId: event.companyId,
        direction: 'EMITIDA', // Fase 1: a NF-e da OV é sempre emissão própria
        status: FiscalStatus.AUTHORIZED,
      },
    });
    if (!doc) {
      this.logger.log(`OV ${event.salesOrderId}: sem NF-e AUTHORIZED — nada a fazer no fiscal`);
      return;
    }

    const justificativa = event.reason
      ? `Devolução de venda — ${event.reason}`
      : 'Devolução de venda registrada no ERP';
    const hoursElapsed = (Date.now() - doc.createdAt.getTime()) / (1000 * 60 * 60);

    try {
      if (hoursElapsed <= 24) {
        await this.fiscalService.cancel(doc.id, event.companyId, justificativa);
        this.logger.log(`NF-e ${doc.id} cancelada na SEFAZ (devolução OV ${event.salesOrderId})`);
      } else {
        await this.fiscalService.emitReturnNote(doc.id, event.companyId, event.reason);
        this.logger.log(`NF-e de devolução emitida p/ original ${doc.id} (OV ${event.salesOrderId}, ${Math.floor(hoursElapsed)}h)`);
      }
    } catch (err: any) {
      this.logger.error(
        `Lado fiscal da devolução OV ${event.salesOrderId} falhou: ${err.message}. ` +
          'Devolução interna mantida — resolver via cancelamento/devolução manual no módulo fiscal.',
      );
    }
  }

  @OnEvent(TRANSFER_DISPATCHED_EVENT, { async: true })
  async handleTransferDispatched(event: TransferDispatchedEvent): Promise<void> {
    this.logger.log(`Iniciando emissão de NF-e de transferência para TR=${event.storeTransferId}`);
    try {
      await this.fiscalService.emitForTransfer(event.storeTransferId);
    } catch (err: any) {
      this.logger.error(`Erro ao emitir NF-e de transferência TR=${event.storeTransferId}: ${err.message}`);
    }
  }

  /** #164 — Reverter lançamento financeiro e estoque ao cancelar NF-e */
  @OnEvent(FISCAL_CANCELLED_EVENT, { async: true })
  async handleFiscalCancelled(event: FiscalCancelledEvent): Promise<void> {
    this.logger.log(`Revertendo efeitos do cancelamento fiscal doc=${event.fiscalDocumentId}`);

    // Reverter os títulos da venda (#586: a venda gera N recebíveis — parcelas
    // e formas — então cancela TODOS os RECEIVABLE abertos da OV, não só o que
    // carrega o fiscalDocumentId). Fallback por fiscalDocumentId quando o evento
    // não trouxer a OV.
    const where = event.salesOrderId
      ? { salesOrderId: event.salesOrderId, type: FinancialEntryType.RECEIVABLE }
      : { fiscalDocumentId: event.fiscalDocumentId };
    const cancelled = await this.prisma.financialEntry.updateMany({
      where: { ...where, status: { not: FinancialEntryStatus.CANCELLED } },
      data: { status: FinancialEntryStatus.CANCELLED },
    });
    if (cancelled.count > 0) {
      this.logger.log(`${cancelled.count} título(s) da OV ${event.salesOrderId ?? '—'} → CANCELLED`);
    }

    // Reverter movimentação de estoque vinculada à venda
    // Guard: se a venda já está RETURNED, o estoque já foi revertido pelo returnOrder (#178)
    if (event.salesOrderId) {
      const salesOrder = await this.prisma.salesOrder.findFirst({
        where: { id: event.salesOrderId },
        select: { status: true },
      });

      if (salesOrder?.status === 'RETURNED') {
        this.logger.log(
          `OV ${event.salesOrderId} já está RETURNED — estoque já revertido, pulando reversão fiscal`,
        );
      } else {
        const movements = await this.prisma.stockMovement.findMany({
          where: {
            companyId: event.companyId,
            reason: { contains: event.salesOrderId },
            type: 'EXIT',
          },
        });
        for (const mov of movements) {
          await this.prisma.stockMovement.create({
            data: {
              companyId: mov.companyId,
              warehouseId: mov.warehouseId,
              productId: mov.productId,
              type: 'ENTRY',
              quantity: mov.quantity,
              reason: `Reversão por cancelamento NF-e — doc=${event.fiscalDocumentId}`,
              userId: mov.userId,
            },
          });
          await this.prisma.stockBalance.updateMany({
            where: { warehouseId: mov.warehouseId, productId: mov.productId },
            data: { available: { increment: Number(mov.quantity) } },
          });
          this.logger.log(`StockMovement reverso criado para product=${mov.productId} qty=${mov.quantity}`);
        }
      }
    }
  }
}
