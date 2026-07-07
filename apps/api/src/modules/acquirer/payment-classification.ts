import { PaymentMethod } from '@prisma/client';

/**
 * Classificação de formas de pagamento (#584/#586) — fonte única.
 * Evita listas divergentes espalhadas (sales, finance, fiscal): adicionar uma
 * nova forma de cartão aqui reflete em todos os consumidores de uma vez.
 */
export const CARD_METHODS: PaymentMethod[] = [
  PaymentMethod.CARTAO, // legado
  PaymentMethod.CARTAO_CREDITO,
  PaymentMethod.CARTAO_DEBITO,
];

/** Formas em que o CLIENTE paga em N parcelas (vencimento a cada 30 dias) */
export const INSTALLMENT_METHODS: PaymentMethod[] = [
  PaymentMethod.BOLETO,
  PaymentMethod.CHEQUE,
];

export const isCardMethod = (m: PaymentMethod): boolean => CARD_METHODS.includes(m);
