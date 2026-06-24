export const PRODUCTION_COMPLETED_EVENT = 'production.order.completed';

export class ProductionCompletedEvent {
  constructor(
    public readonly companyId: string,
    public readonly productionOrderId: string,
    public readonly productId: string,
    public readonly warehouseId: string,
    public readonly producedQty: number,
    public readonly userId?: string,
  ) {}
}
