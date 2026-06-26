import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GOODS_RECEIVED_EVENT, GoodsReceivedEvent } from '../stock/events/goods-received.event';
import { SALE_CONFIRMED_EVENT, SaleConfirmedEvent } from '../sales/events/sale-confirmed.event';
import { SALE_PICKED_EVENT, SalePickedEvent } from '../sales/events/sale-picked.event';
import { WmsService } from './wms.service';
import { SalesService } from '../sales/sales.service';

@Injectable()
export class WmsListener {
  private readonly logger = new Logger(WmsListener.name);

  constructor(
    private readonly wmsService: WmsService,
    private readonly salesService: SalesService,
  ) {}

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

  @OnEvent(SALE_CONFIRMED_EVENT, { async: true })
  async onSaleConfirmed(event: SaleConfirmedEvent): Promise<void> {
    try {
      const created = await this.wmsService.createPickingOrder(event);
      // #220: Non-WMS warehouses — skip picking, go straight to READY_TO_INVOICE
      if (!created) {
        await this.salesService.markReadyToInvoice(event.salesOrderId);
        this.logger.log(
          `SO ${event.salesOrderId} marcada como READY_TO_INVOICE (WMS desativado)`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Falha ao criar PickingOrder para SO ${event.salesOrderId}: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent(SALE_PICKED_EVENT, { async: true })
  async onSalePicked(event: SalePickedEvent): Promise<void> {
    try {
      await this.salesService.markReadyToInvoice(event.salesOrderId);
      this.logger.log(`SO ${event.salesOrderId} marcada como READY_TO_INVOICE após picking`);
    } catch (err) {
      this.logger.error(
        `Falha ao marcar SO ${event.salesOrderId} como READY_TO_INVOICE: ${(err as Error).message}`,
      );
    }
  }
}
