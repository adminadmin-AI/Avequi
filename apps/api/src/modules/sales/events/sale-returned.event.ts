// #531 emitido quando uma OV transita INVOICED → RETURNED (devolução).
// O módulo vehicle-tracking escuta para cancelar a saída de estoque RENAVE
// (anula a ATPV-e e o RENAVE recria o estoque — cenário A do épico #527).
export const SALE_RETURNED_EVENT = 'sales.order.returned';

export class SaleReturnedEvent {
  constructor(
    public readonly companyId: string,
    public readonly salesOrderId: string,
  ) {}
}
