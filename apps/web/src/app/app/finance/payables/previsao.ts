import type { FinancialEntry } from '@/types/api';

/**
 * Data de PREVISÃO efetiva do título, só a parte `YYYY-MM-DD`.
 *
 * Espelha a coluna "Previsão" da tela (#788): usa `expectedPaymentDate` quando
 * informada; senão cai pro vencimento. Comparação por string de data (mesma
 * convenção dos filtros de Vencimento, que também comparam o ISO com o valor do
 * `<input type="date">`).
 */
export function previsaoDate(
  e: Pick<FinancialEntry, 'expectedPaymentDate' | 'dueDate'>,
): string {
  return (e.expectedPaymentDate ?? e.dueDate).slice(0, 10);
}

/** A previsão do título cai exatamente no dia `dayStr` (`YYYY-MM-DD`)? */
export function isPrevisaoOn(
  e: Pick<FinancialEntry, 'expectedPaymentDate' | 'dueDate'>,
  dayStr: string,
): boolean {
  return previsaoDate(e) === dayStr;
}

/** Hoje em `YYYY-MM-DD` a partir de um `Date` local (mesma base do `<input date>`). */
export function toDayStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
