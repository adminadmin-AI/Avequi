import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GOODS_RECEIVED_EVENT, GoodsReceivedEvent } from './events/goods-received.event';

/**
 * Listener de eventos de recebimento de compra.
 *
 * A movimentação de estoque e o recálculo de custo médio já ocorrem de forma
 * atômica dentro da transação de GoodsReceipt (purchase.service.ts).
 * Este listener é responsável por ações pós-commit: logs, notificações e
 * integrações futuras (ex.: fiscal, BI).
 */
@Injectable()
export class StockListener {
  private readonly logger = new Logger(StockListener.name);

  @OnEvent(GOODS_RECEIVED_EVENT, { async: true })
  handleGoodsReceived(event: GoodsReceivedEvent): void {
    this.logger.log(
      `[${GOODS_RECEIVED_EVENT}] GR=${event.goodsReceiptId} ` +
        `PO=${event.purchaseOrderId} WH=${event.warehouseId} ` +
        `itens=${event.items.length} empresa=${event.companyId}`,
    );
  }
}
