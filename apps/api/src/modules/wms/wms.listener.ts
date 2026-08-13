import { Injectable, Logger } from '@nestjs/common';
import { SYSTEM_CONTEXT } from '../iam/scope';
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

  /**
   * Venda confirmada: cria a separação no WMS ou, se o depósito não tem WMS,
   * declara a separação concluída na hora (#220) — é o desvio que permite
   * faturar sem a máquina de picking.
   *
   * Os dois passos têm tratamento de erro SEPARADO de propósito (#729). Antes,
   * um `catch` único cobria ambos e reportava qualquer falha como "falha ao
   * criar PickingOrder": se o desvio quebrasse, a venda ficava parada em
   * AWAITING_PICKING e o log apontava para o lugar errado. O evento é
   * fire-and-forget (emitido após o commit, sem retry), então o log é a única
   * chance de alguém descobrir — ele precisa dizer a verdade.
   */
  @OnEvent(SALE_CONFIRMED_EVENT, { async: true })
  async onSaleConfirmed(event: SaleConfirmedEvent): Promise<void> {
    let separacaoCriada: boolean;
    try {
      separacaoCriada = await this.wmsService.createPickingOrder(event);
    } catch (err) {
      this.logger.error(
        JSON.stringify({
          event: 'wms_picking_order_failed',
          salesOrderId: event.salesOrderId,
          warehouseId: event.warehouseId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return;
    }

    if (separacaoCriada) return;

    // #220: depósito sem WMS não tem separação — a venda avança direto para a
    // conferência da carga (AWAITING_CONFERENCE, ver #491).
    try {
      await this.salesService.marcarSeparacaoConcluida(event.salesOrderId, SYSTEM_CONTEXT);
      this.logger.log(
        `Venda ${event.salesOrderId}: separação concluída automaticamente (depósito sem WMS) — segue para conferência`,
      );
    } catch (err) {
      // A venda FICA em AWAITING_PICKING e ninguém é avisado pela interface:
      // sem este log, o travamento é invisível até alguém reclamar.
      this.logger.error(
        JSON.stringify({
          event: 'sales_non_wms_advance_failed',
          salesOrderId: event.salesOrderId,
          warehouseId: event.warehouseId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  @OnEvent(SALE_PICKED_EVENT, { async: true })
  async onSalePicked(event: SalePickedEvent): Promise<void> {
    try {
      await this.salesService.marcarSeparacaoConcluida(event.salesOrderId, SYSTEM_CONTEXT);
      this.logger.log(
        `Venda ${event.salesOrderId}: separação concluída pelo picking — segue para conferência`,
      );
    } catch (err) {
      this.logger.error(
        JSON.stringify({
          event: 'sales_picked_advance_failed',
          salesOrderId: event.salesOrderId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
}
