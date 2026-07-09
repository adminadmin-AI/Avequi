import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SALE_INVOICED_EVENT, SaleInvoicedEvent } from '../sales/events/sale-invoiced.event';
import { BIN_REGISTERED_EVENT, BinRegisteredEvent } from '../vehicle-tracking/events/bin-registered.event';
import { DeliveryService } from './delivery.service';

@Injectable()
export class DeliveryListener {
  private readonly logger = new Logger(DeliveryListener.name);

  constructor(private readonly delivery: DeliveryService) {}

  // Ao faturar → cria a entrega em AWAITING_BIN (idempotente)
  @OnEvent(SALE_INVOICED_EVENT, { async: true })
  async onSaleInvoiced(event: SaleInvoicedEvent) {
    try {
      await this.delivery.createOnInvoice(event.companyId, event.salesOrderId);
    } catch (e) {
      this.logger.error(`Falha ao criar entrega da venda ${event.salesOrderId}: ${(e as Error).message}`);
    }
  }

  // BIN registrada → avança a entrega para AWAITING_PICKUP
  @OnEvent(BIN_REGISTERED_EVENT, { async: true })
  async onBinRegistered(event: BinRegisteredEvent) {
    try {
      await this.delivery.advanceOnBinRegistered(event.companyId, event.serialNumberId);
    } catch (e) {
      this.logger.error(`Falha ao avançar entrega (BIN ${event.serialNumberId}): ${(e as Error).message}`);
    }
  }
}
