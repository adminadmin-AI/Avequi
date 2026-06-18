export const SALE_INVOICED_EVENT = 'sales.order.invoiced';

export class SaleInvoicedEvent {
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
