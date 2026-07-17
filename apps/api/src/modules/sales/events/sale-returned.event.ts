// #531 emitido quando uma OV transita INVOICED → RETURNED (devolução).
// O módulo vehicle-tracking escuta para cancelar a saída de estoque RENAVE
// (anula a ATPV-e e o RENAVE recria o estoque — cenário A do épico #527).
// #747: o módulo fiscal também escuta — cancela a NF-e na SEFAZ (<24h) ou
// emite a NF-e de devolução referenciada (>24h). `reason` compõe a justificativa.
export const SALE_RETURNED_EVENT = 'sales.order.returned';

export class SaleReturnedEvent {
  constructor(
    public readonly companyId: string,
    public readonly salesOrderId: string,
    public readonly reason?: string,
  ) {}
}
