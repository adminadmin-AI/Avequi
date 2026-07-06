import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SALE_INVOICED_EVENT, SaleInvoicedEvent } from '../sales/events/sale-invoiced.event';
import { LeadConversionService } from './lead-conversion.service';

/**
 * F2.2 (#515) — fecha o lead quando a NF-e da OV vinculada é emitida.
 * async/desacoplado: falha aqui não quebra o faturamento.
 */
@Injectable()
export class CrmListener {
  private readonly logger = new Logger(CrmListener.name);

  constructor(private readonly conversion: LeadConversionService) {}

  @OnEvent(SALE_INVOICED_EVENT)
  async onSaleInvoiced(event: SaleInvoicedEvent) {
    try {
      await this.conversion.closeWonBySalesOrder(event.companyId, event.salesOrderId);
    } catch (err) {
      this.logger.error(
        `Falha ao fechar lead da OV ${event.salesOrderId}: ${(err as Error).message}`,
      );
    }
  }
}
