import { PaymentModality } from '@prisma/client';

/** Token de injeção do adapter de TEF/gateway ativo (#596) */
export const PAYMENT_PORT = Symbol('PAYMENT_PORT');

export interface AuthorizeRequest {
  /** Valor bruto da transação (o que passa no cartão) */
  amount: number;
  installments: number;
  modality: PaymentModality;
  brand?: string;
  /** Referência da venda p/ rastreio/idempotência no provider */
  orderRef: string;
  paymentRef: string;
}

export interface AuthorizeResult {
  authorized: boolean;
  authCode?: string; // cAut do grupo card da NF-e (#587)
  nsu?: string;
  brand?: string; // bandeira retornada pela maquininha (pode preencher a que faltava)
  /** Motivo da negativa quando authorized=false */
  declineReason?: string;
  providerRef?: string; // id da transação no provider (p/ void/estorno)
}

export interface VoidRequest {
  paymentRef: string;
  providerRef?: string;
  nsu?: string;
  amount: number;
}

/**
 * Porta de autorização de cartão (TEF/gateway) — #596. Domínio fala só com esta
 * interface; cada adquirente (InfinitePay, Stone, Cielo...) é um adapter. O gate
 * do faturamento (#595) exige AuthorizeResult.authorized antes de emitir a NF-e.
 */
export interface PaymentPort {
  readonly name: string;
  authorize(req: AuthorizeRequest): Promise<AuthorizeResult>;
  /** Estorna/cancela uma autorização (venda cancelada antes de faturar) */
  voidPayment(req: VoidRequest): Promise<void>;
}
