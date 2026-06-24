import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  PRODUCTION_COMPLETED_EVENT,
  ProductionCompletedEvent,
} from '../production/events/production-completed.event';
import {
  SALE_INVOICED_EVENT,
  SaleInvoicedEvent,
} from '../sales/events/sale-invoiced.event';
import { SerialService } from './serial.service';

@Injectable()
export class SerialListener {
  private readonly logger = new Logger(SerialListener.name);

  constructor(private readonly serialService: SerialService) {}

  @OnEvent(PRODUCTION_COMPLETED_EVENT, { async: true })
  async onProductionCompleted(event: ProductionCompletedEvent): Promise<void> {
    try {
      const result = await this.serialService.generateForProduction(
        event.companyId,
        event.productionOrderId,
        event.productId,
        event.warehouseId,
        event.producedQty,
      );

      if (result.generated > 0) {
        this.logger.log(
          `OP ${event.productionOrderId}: ${result.generated} seriais gerados automaticamente`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Erro ao gerar seriais para OP ${event.productionOrderId}: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent(SALE_INVOICED_EVENT, { async: true })
  async onSaleInvoiced(event: SaleInvoicedEvent): Promise<void> {
    try {
      const items = event.items.map((i: any) => ({
        saleItemId: i.saleItemId,
        productId: i.productId,
        quantity: i.quantity,
      }));

      const result = await this.serialService.assignForSale(
        event.companyId,
        event.salesOrderId,
        items,
      );

      if (result.assigned > 0) {
        this.logger.log(
          `OV ${event.salesOrderId}: ${result.assigned} seriais vinculados automaticamente`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Erro ao vincular seriais para OV ${event.salesOrderId}: ${(err as Error).message}`,
      );
    }
  }
}
