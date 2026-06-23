export const SALE_PICKED_EVENT = 'sales.order.picked';

export class SalePickedEvent {
  constructor(
    public readonly companyId: string,
    public readonly salesOrderId: string,
    public readonly pickingOrderId: string,
    public readonly warehouseId: string,
  ) {}
}
