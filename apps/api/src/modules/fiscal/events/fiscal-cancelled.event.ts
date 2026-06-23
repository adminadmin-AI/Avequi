export const FISCAL_CANCELLED_EVENT = 'fiscal.document.cancelled';

export class FiscalCancelledEvent {
  constructor(
    public readonly companyId: string,
    public readonly fiscalDocumentId: string,
    public readonly salesOrderId: string | null,
    public readonly storeTransferId: string | null,
  ) {}
}
