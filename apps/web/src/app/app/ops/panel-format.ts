import type { BillingAging, BilledPeriod } from '@/types/api';

/**
 * Derivações puras do Painel da Operadora (#957).
 *
 * Regra da casa: NÚMERO INVENTADO NÃO EXISTE. Toda função aqui devolve
 * `null` quando não há base de cálculo — quem renderiza mostra "sem base",
 * nunca um zero disfarçado de resultado (mesmo precedente do "Meu Dia").
 *
 * Vive em `.ts` (sem JSX) para ser testável sem jsdom — convenção do repo,
 * igual a `billing-format.ts`.
 */

/** Soma das faixas VENCIDAS (a vencer não é inadimplência). Em centavos. */
export function inadimplenciaCents(aging: BillingAging): number {
  return aging.d1_15 + aging.d16_30 + aging.d31_plus;
}

export type AgingTone = 'success' | 'warning' | 'danger';

/**
 * Tom da inadimplência pela faixa MAIS VELHA ocupada — o que dói é a idade
 * do atraso, não o valor: nada vencido = verde, atraso até 30d = warning,
 * 31+ dias = danger.
 */
export function agingTone(aging: BillingAging): AgingTone {
  if (aging.d31_plus > 0) return 'danger';
  if (aging.d1_15 > 0 || aging.d16_30 > 0) return 'warning';
  return 'success';
}

/**
 * Ticket médio da carteira em centavos — `null` sem assinatura ativa
 * (divisão por zero não vira "R$ 0,00"; vira "sem base").
 */
export function ticketMedioCents(
  mrrCents: number,
  activeSubscriptions: number,
): number | null {
  if (activeSubscriptions <= 0) return null;
  return Math.round(mrrCents / activeSubscriptions);
}

const MESES_CURTOS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

/**
 * Competência "YYYY-MM" → "ago/26" (eixo X do gráfico, precisa ser curto).
 * Entrada fora do formato volta crua — o painel não inventa mês.
 */
export function periodShortLabel(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return period;
  return `${MESES_CURTOS[mes - 1]}/${m[1].slice(2)}`;
}

/** Competência "YYYY-MM" → "08/2026" (tooltip do gráfico, leitura fina). */
export function periodLongLabel(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  return m ? `${m[2]}/${m[1]}` : period;
}

/**
 * A série tem histórico de verdade? Seis meses todos zerados não é uma
 * linha rasa — é ausência de faturamento, e o painel diz isso com texto em
 * vez de desenhar um gráfico que sugere série.
 */
export function temFaturamento(series: BilledPeriod[] | undefined): boolean {
  return !!series && series.some((p) => p.amountCents > 0);
}
