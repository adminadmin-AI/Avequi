import type {
  EntryHistoryEvent,
  EntrySource,
  FinancialCategory,
  FinancialEntry,
  PaymentMethod,
} from '@/types/api';

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

// ── Fase 2 — forma de pagamento e histórico ──────────────────────────────────

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  BOLETO: 'Boleto',
  PIX: 'PIX',
  TED: 'TED/Transferência',
  DINHEIRO: 'Dinheiro',
  CARTAO: 'Cartão',
  CHEQUE: 'Cheque',
  CARTAO_CREDITO: 'Cartão de crédito',
  CARTAO_DEBITO: 'Cartão de débito',
  DEBITO_AUTOMATICO: 'Débito automático',
  OUTROS: 'Outros',
};

export function paymentMethodLabel(m: PaymentMethod | null | undefined): string | null {
  return m ? (PAYMENT_METHOD_LABELS[m] ?? m) : null;
}

/** Ações do AuditLog em português (fallback = código cru). */
export const ACTION_LABELS: Record<string, string> = {
  UPDATE: 'Editado',
  CREATE_PAYABLE: 'Criado (compra)',
  CREATE_RECEIVABLE: 'Criado (venda)',
  CREATE_RECEIVABLES_PLAN: 'Plano de recebimento criado',
  PAY: 'Baixado',
  CANCEL: 'Cancelado',
  WRITE_OFF: 'Baixado como perda',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** Nome pt dos campos que aparecem no diff do histórico. */
const FIELD_LABELS: Record<string, string> = {
  description: 'descrição',
  amount: 'valor',
  dueDate: 'vencimento',
  expectedPaymentDate: 'previsão',
  supplierId: 'fornecedor',
  categoryId: 'categoria',
  costCenter: 'centro de custo',
  status: 'status',
  issueDate: 'emissão',
  documentNumber: 'nº do documento',
  paymentMethod: 'forma de pagamento',
  boletoBarcode: 'código de barras',
  pixCopiaECola: 'PIX copia e cola',
};

/** "valor, vencimento, categoria" — resumo do que mudou num evento. */
export function changedFieldsSummary(changes: EntryHistoryEvent['changes']): string | null {
  if (!changes) return null;
  const keys = Object.keys(changes);
  if (!keys.length) return null;
  return keys.map((k) => FIELD_LABELS[k] ?? k).join(', ');
}
