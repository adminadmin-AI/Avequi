import { PaymentMethod } from '@prisma/client';
import { INSTALLMENT_METHODS } from '../acquirer/payment-classification';
import { DataOperacional, somarDias } from '../../common/date/dia-operacional';

const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Divide um total em N parcelas de centavos consistentes: as N−1 primeiras
 * iguais (piso) e a última absorvendo o resto, de modo que a soma feche exato.
 * Fonte única do rateio de parcelas (cartão, boleto, createInstallments e
 * duplicatas da NF-e).
 */
export function splitInstallments(total: number, n: number): { number: number; amount: number }[] {
  const base = Math.floor((total / n) * 100) / 100;
  return Array.from({ length: n }, (_, i) => ({
    number: i + 1,
    amount: i === n - 1 ? round2(total - base * (n - 1)) : base,
  }));
}

/** Uma parcela que o CLIENTE deve — a mesma linha vira título no financeiro e duplicata na NF-e. */
export interface ParcelaAPrazo {
  salesPaymentId: string;
  method: PaymentMethod;
  /** nº da parcela dentro da forma (1..total) */
  number: number;
  /** total de parcelas da forma */
  total: number;
  amount: number;
  /** vencimento como data de negócio (#901) */
  vencimento: DataOperacional;
}

/** Intervalo entre parcelas a prazo (boleto/cheque): vence a cada 30 dias. */
export const INTERVALO_PARCELA_DIAS = 30;

/**
 * As parcelas A PRAZO do plano de pagamento de uma venda — só as formas em
 * que o CLIENTE paga em N vezes (INSTALLMENT_METHODS: boleto/cheque), valor
 * BRUTO, vencendo a cada 30 dias a partir do dia operacional do faturamento.
 *
 * Cartão fica de fora de propósito: quem deve é a ADQUIRENTE (líquido de
 * MDR, prazo de liquidação) e isso não é duplicata do cliente. À vista
 * também não gera parcela.
 *
 * FONTE ÚNICA (#1152): o financeiro gera os títulos daqui e a NF-e monta o
 * quadro "Fatura / Duplicata" daqui — o vencimento impresso na DANFE é o
 * mesmo que o contas a receber vai cobrar.
 */
export function parcelasAPrazo(
  plan: Array<{ id: string; method: PaymentMethod; amount: unknown; installments?: number | null }>,
  diaBase: DataOperacional,
): ParcelaAPrazo[] {
  const out: ParcelaAPrazo[] = [];
  for (const p of plan) {
    if (!INSTALLMENT_METHODS.includes(p.method)) continue;
    const n = p.installments ?? 1;
    for (const inst of splitInstallments(Number(p.amount), n)) {
      out.push({
        salesPaymentId: p.id,
        method: p.method,
        number: inst.number,
        total: n,
        amount: inst.amount,
        vencimento: somarDias(diaBase, INTERVALO_PARCELA_DIAS * inst.number),
      });
    }
  }
  return out;
}
