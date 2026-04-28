import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { FiscalDocumentType } from '@prisma/client';
import { SALE_CONFIRMED_EVENT, SaleConfirmedEvent } from '../sales/events/sale-confirmed.event';
import { FiscalService } from './fiscal.service';

/**
 * Ouve o evento sales.order.confirmed e dispara a emissão fiscal.
 * Falha na emissão não afeta a venda — é registrada no FiscalDocument.
 */
@Injectable()
export class FiscalListener {
  private readonly logger = new Logger(FiscalListener.name);

  constructor(private readonly fiscalService: FiscalService) {}

  @OnEvent(SALE_CONFIRMED_EVENT, { async: true })
  async handleSaleConfirmed(event: SaleConfirmedEvent): Promise<void> {
    this.logger.log(`Iniciando emissão fiscal para OV=${event.salesOrderId}`);
    try {
      await this.fiscalService.emitForSale(event.salesOrderId, FiscalDocumentType.NFCE);
    } catch (err: any) {
      // Falha fiscal nunca desfaz a venda — apenas loga
      this.logger.error(`Erro ao emitir NF para OV=${event.salesOrderId}: ${err.message}`);
    }
  }
}
