export const SALE_INVOICED_EVENT = 'sales.order.invoiced';

export class SaleInvoicedEvent {
  constructor(
    public readonly companyId: string,
    public readonly userId: string | undefined,
    public readonly salesOrderId: string,
    public readonly warehouseId: string,
    public readonly items: Array<{
      saleItemId: string;
      productId: string;
      quantity: number;
      unitPrice: number;
    }>,
    /** Tipo do cliente: INDIVIDUAL (CPF) ou COMPANY (CNPJ) */
    public readonly customerType?: 'INDIVIDUAL' | 'COMPANY',
    /** UF do cliente (ex: "SP", "MG") */
    public readonly customerState?: string | null,
    /** UF da empresa emitente */
    public readonly companyState?: string | null,
  ) {}
}
