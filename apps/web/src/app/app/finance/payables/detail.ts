import type { EntrySource, FinancialCategory, FinancialEntry } from '@/types/api';

/**
 * Helpers puros do painel de detalhe da Carteira de Pagáveis — isolados p/
 * teste. Os de dinheiro (num/remainingOf) moraram na page e subiram pra cá
 * quando o drawer passou a precisar deles também.
 */

/** Decimal-string da API → number (null/undefined → 0). */
export function num(v: string | null | undefined): number {
  return v ? Number(v) : 0;
}

/** Quanto falta pagar do título. */
export function remainingOf(e: Pick<FinancialEntry, 'amount' | 'paidAmount'>): number {
  return num(e.amount) - num(e.paidAmount);
}

/** Origem do lançamento em português, p/ humanos. */
export const SOURCE_LABELS: Record<EntrySource, string> = {
  MANUAL: 'Lançamento manual',
  AUTO_SALES: 'Automático — venda',
  AUTO_PURCHASE: 'Automático — compra',
};

export function sourceLabel(source: EntrySource): string {
  return SOURCE_LABELS[source] ?? source;
}

/**
 * Nome da categoria pelo id, varrendo a árvore que o GET /finance/categories
 * devolve (raízes com children aninhados). O GET /finance não inclui a relação
 * category (Fase 2 do detalhe) — até lá, resolvemos client-side.
 */
export function findCategoryName(
  roots: FinancialCategory[],
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  for (const c of roots) {
    if (c.id === id) return c.name;
    const inChildren = findCategoryName(c.children ?? [], id);
    if (inChildren) return inChildren;
  }
  return null;
}
