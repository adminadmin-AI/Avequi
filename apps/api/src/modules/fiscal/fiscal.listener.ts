import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { FiscalDocumentType } from '@prisma/client';
import { SALE_INVOICED_EVENT, SaleInvoicedEvent } from '../sales/events/sale-invoiced.event';
import { TRANSFER_DISPATCHED_EVENT, TransferDispatchedEvent } from '../transfer/events/transfer-dispatched.event';
import { FiscalService } from './fiscal.service';

/**
 * Ouve eventos de negócio e dispara emissão fiscal.
 * Falha na emissão não afeta o fluxo de origem — é registrada no FiscalDocument.
 */
@Injectable()
export class FiscalListener {
  private readonly logger = new Logger(FiscalListener.name);

  constructor(private readonly fiscalService: FiscalService) {}

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
}
