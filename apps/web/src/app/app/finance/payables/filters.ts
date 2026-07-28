import type { FinancialEntry } from '@/types/api';

/**
 * Helpers puros dos filtros de data da Carteira de Pagáveis — isolados p/ teste.
 *
 * Convenção: tudo comparado como string `YYYY-MM-DD`. ISO ordena
 * lexicograficamente por data, então `<`/`>` bastam (mesma ideia que os antigos
 * filtros de Vencimento faziam contra o valor do `<input type="date">`).
 */

/** Vencimento do título (só a parte da data). */
export function venceDate(e: Pick<FinancialEntry, 'dueDate'>): string {
  return e.dueDate.slice(0, 10);
}

/**
 * Previsão efetiva do título (só a parte da data). Espelha a coluna "Previsão"
 * (#788): usa `expectedPaymentDate` quando informada; senão cai pro vencimento.
 */
export function previsaoDate(
  e: Pick<FinancialEntry, 'expectedPaymentDate' | 'dueDate'>,
): string {
  return (e.expectedPaymentDate ?? e.dueDate).slice(0, 10);
}

/**
 * `dayStr` está dentro do intervalo [`from`, `to`] (ambos inclusive)?
 * Limite vazio/ausente = aberto daquele lado.
 */
export function inRange(dayStr: string, from?: string, to?: string): boolean {
  if (from && dayStr < from) return false;
  if (to && dayStr > to) return false;
  return true;
}

/** Data local em `YYYY-MM-DD` (mesma base do calendário/`<input date>`). */
export function toDayStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
