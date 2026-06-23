import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { FiscalDocumentType, FinancialEntryStatus } from '@prisma/client';
import { SALE_INVOICED_EVENT, SaleInvoicedEvent } from '../sales/events/sale-invoiced.event';
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
    this.logger.log(`Iniciando emissão fiscal para OV=${event.salesOrderId}`);
    try {
      await this.fiscalService.emitForSale(event.salesOrderId, FiscalDocumentType.NFCE);
    } catch (err: any) {
      // Falha fiscal nunca desfaz a venda — apenas loga
      this.logger.error(`Erro ao emitir NF para OV=${event.salesOrderId}: ${err.message}`);
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

    // Reverter lançamento financeiro vinculado
    const entry = await this.prisma.financialEntry.findFirst({
      where: { fiscalDocumentId: event.fiscalDocumentId },
    });
    if (entry && entry.status !== FinancialEntryStatus.CANCELLED) {
      await this.prisma.financialEntry.update({
        where: { id: entry.id },
        data: { status: FinancialEntryStatus.CANCELLED },
      });
      this.logger.log(`FinancialEntry ${entry.id} → CANCELLED`);
    }

    // Reverter movimentação de estoque vinculada à venda
    if (event.salesOrderId) {
      const movements = await this.prisma.stockMovement.findMany({
        where: {
          companyId: event.companyId,
          reason: { contains: event.salesOrderId },
          type: 'EXIT',
        },
      });
      for (const mov of movements) {
        // Criar movimento de entrada reversa
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
        // Atualizar saldo do estoque
        await this.prisma.stockBalance.updateMany({
          where: { warehouseId: mov.warehouseId, productId: mov.productId },
          data: { available: { increment: Number(mov.quantity) } },
        });
        this.logger.log(`StockMovement reverso criado para product=${mov.productId} qty=${mov.quantity}`);
      }
    }
  }
}
