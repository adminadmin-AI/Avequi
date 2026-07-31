/**
 * Deep-link por vencimento (?due=YYYY-MM-DD) — helper PURO compartilhado por
 * Pagáveis e Recebíveis. Origem: o calendário da Home (widget Agenda) linka o
 * dia clicado direto na carteira já filtrada naquele vencimento.
 *
 * A URL é só ESTADO INICIAL do filtro: o usuário enxerga o período no próprio
 * controle de Vencimento e limpa por lá; valor inválido é ignorado em silêncio
 * (a tela abre sem filtro, nunca quebra).
 */

const DUE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Valida o parâmetro cru; devolve o ISO yyyy-mm-dd ou null. */
export function parseDueParam(value: string | null | undefined): string | null {
  if (!value || !DUE_RE.test(value)) return null;
  // Meio-dia fixo esquiva fuso; getTime NaN pega 2026-13-40 e afins.
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return value;
}

/** Lê e valida ?due= de uma query string ("?due=2026-07-31" ou "due=..."). */
export function dueFromSearch(search: string): string | null {
  return parseDueParam(new URLSearchParams(search).get('due'));
}
