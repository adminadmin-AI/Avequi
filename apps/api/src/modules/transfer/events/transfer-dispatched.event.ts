export const TRANSFER_DISPATCHED_EVENT = 'transfer.dispatched';

export class TransferDispatchedEvent {
  constructor(
    public readonly companyId: string,
    public readonly userId: string | undefined,
    public readonly storeTransferId: string,
    public readonly fromWarehouseId: string,
    public readonly toWarehouseId: string,
    public readonly items: Array<{
      productId: string;
      quantity: number;
      unitCost: number;
      sku: string;
      name: string;
      ncm: string;
      unit: string;
    }>,
  ) {}
}
