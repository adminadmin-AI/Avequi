/**
 * Meu Dia — regras puras de apresentação (sem React), testáveis em node.
 *
 * A honestidade do delta mora aqui: variação nula (período anterior sem
 * movimento) NUNCA vira percentual, e variação abaixo de 1% é "estável" em
 * vez de um ±0% que parece precisão que não temos.
 */

export type DeltaTone = 'up' | 'down' | 'flat';

/** Abaixo disto a variação é ruído: mostra como estável. */
const FLAT_THRESHOLD_PCT = 1;

export function deltaTone(pct: number | null): DeltaTone {
  if (pct == null || Math.abs(pct) < FLAT_THRESHOLD_PCT) return 'flat';
  return pct > 0 ? 'up' : 'down';
}

/** "+12%" · "-5%" · "estável" · "sem base" (período anterior zerado). */
export function formatDeltaPct(pct: number | null): string {
  if (pct == null) return 'sem base';
  if (Math.abs(pct) < FLAT_THRESHOLD_PCT) return 'estável';
  const rounded = Math.round(pct);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

/** "sexta-feira, 31 de julho" a partir de um YYYY-MM-DD (sem shift de fuso). */
export function longBusinessDate(iso: string): string {
  // meio-dia local: parsear "YYYY-MM-DD" puro seria UTC e jogaria a data para
  // o dia anterior em qualquer fuso negativo (o nosso).
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(d);
}
