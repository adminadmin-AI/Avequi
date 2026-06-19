import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GOODS_RECEIVED_EVENT, GoodsReceivedEvent } from '../stock/events/goods-received.event';
import { SALE_INVOICED_EVENT, SaleInvoicedEvent } from '../sales/events/sale-invoiced.event';
import { WmsService } from './wms.service';

@Injectable()
export class WmsListener {
  private readonly logger = new Logger(WmsListener.name);

  constructor(private readonly wmsService: WmsService) {}

  @OnEvent(GOODS_RECEIVED_EVENT, { async: true })
  async onGoodsReceived(event: GoodsReceivedEvent): Promise<void> {
    try {
      await this.wmsService.createReceivingOrder(event);
    } catch (err) {
      this.logger.error(
        `Falha ao criar ReceivingOrder para GR ${event.goodsReceiptId}: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent(SALE_INVOICED_EVENT, { async: true })
  async onSaleInvoiced(event: SaleInvoicedEvent): Promise<void> {
    try {
      await this.wmsService.createPickingOrder(event);
    } catch (err) {
      this.logger.error(
        `Falha ao criar PickingOrder para SO ${event.salesOrderId}: ${(err as Error).message}`,
      );
    }
  }
}
