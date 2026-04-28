import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SALE_CONFIRMED_EVENT, SaleConfirmedEvent } from '../sales/events/sale-confirmed.event';
import { GOODS_RECEIVED_EVENT, GoodsReceivedEvent } from '../stock/events/goods-received.event';
import { FinanceService } from './finance.service';

@Injectable()
export class FinanceListener {
  private readonly logger = new Logger(FinanceListener.name);

  constructor(private readonly financeService: FinanceService) {}

  // ─── S09.02: Venda confirmada → gera conta a receber ─────────────────────

  @OnEvent(SALE_CONFIRMED_EVENT, { async: true })
  async onSaleConfirmed(event: SaleConfirmedEvent): Promise<void> {
    try {
      const amount = event.items.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice,
        0,
      );

      await this.financeService.createReceivableForSale({
        companyId: event.companyId,
        salesOrderId: event.salesOrderId,
        amount,
      });
    } catch (err) {
      // Erro financeiro nunca desfaz a venda
      this.logger.error(
        `Falha ao criar CR para OV ${event.salesOrderId}: ${(err as Error).message}`,
      );
    }
  }

  // ─── S09.03: Recebimento de compra → gera conta a pagar ──────────────────

  @OnEvent(GOODS_RECEIVED_EVENT, { async: true })
  async onGoodsReceived(event: GoodsReceivedEvent): Promise<void> {
    try {
      const amount = event.items.reduce(
        (sum, item) => sum + item.qtyReceived * item.unitCost,
        0,
      );

      await this.financeService.createPayableForReceipt({
        companyId: event.companyId,
        purchaseOrderId: event.purchaseOrderId,
        goodsReceiptId: event.goodsReceiptId,
        amount,
      });
    } catch (err) {
      // Erro financeiro nunca desfaz o recebimento
      this.logger.error(
        `Falha ao criar CP para GR ${event.goodsReceiptId}: ${(err as Error).message}`,
      );
    }
  }
}
