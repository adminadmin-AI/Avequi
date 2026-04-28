export const SALE_CONFIRMED_EVENT = 'sales.order.confirmed';

export class SaleConfirmedEvent {
  constructor(
    public readonly companyId: string,
    public readonly userId: string | undefined,
    public readonly salesOrderId: string,
    public readonly warehouseId: string,
    public readonly items: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
    }>,
  ) {}
}
