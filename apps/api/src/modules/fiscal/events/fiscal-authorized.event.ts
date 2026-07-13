// #529 emitido quando um FiscalDocument transita para AUTHORIZED (webhook Focus
// ou resposta síncrona). O módulo vehicle-tracking escuta para disparar o
// pré-cadastro BIN e a cadeia RENAVE/ATPV-e da venda.
export const FISCAL_AUTHORIZED_EVENT = 'fiscal.document.authorized';

export class FiscalAuthorizedEvent {
  constructor(
    public readonly companyId: string,
    public readonly fiscalDocumentId: string,
    public readonly salesOrderId: string | null,
    public readonly storeTransferId: string | null,
    public readonly chave: string | null,
  ) {}
}
