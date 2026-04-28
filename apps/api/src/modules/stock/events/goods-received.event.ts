export const GOODS_RECEIVED_EVENT = 'purchase.goods_received';

export class GoodsReceivedEvent {
  constructor(
    public readonly companyId: string,
    public readonly userId: string | undefined,
    public readonly purchaseOrderId: string,
    public readonly goodsReceiptId: string,
    public readonly warehouseId: string,
    public readonly items: Array<{
      productId: string;
      qtyReceived: number;
      unitCost: number;
    }>,
  ) {}
}
