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

/** "1/10" quando o total é conhecido; "1" sem total; null = à vista. */
export function installmentLabel(
  e: Pick<FinancialEntry, 'installmentNumber' | 'installmentTotal'>,
): string | null {
  if (e.installmentNumber == null) return null;
  return e.installmentTotal
    ? `${e.installmentNumber}/${e.installmentTotal}`
    : String(e.installmentNumber);
}

/**
 * Quais blocos de "Dados de pagamento" mostrar para ESTA conta: o drawer se
 * adapta à forma de pagamento — conta de boleto mostra boleto (não PIX) e
 * vice-versa; TED/débito/cheque mostram dados bancários. Dado EXISTENTE nunca
 * é escondido (ex.: boleto com PIX Copia e Cola gravado mostra os dois).
 * Sem forma informada, mostra o que existir.
 */
export function paymentDataVisibility(
  e: Pick<FinancialEntry, 'paymentMethod' | 'boletoBarcode' | 'pixCopiaECola'>,
  supplier: { pixKey?: string | null; bankName?: string | null } | null,
): { boleto: boolean; pix: boolean; banco: boolean } {
  const m = e.paymentMethod ?? null;
  const boleto = m === 'BOLETO' || !!e.boletoBarcode;
  const pix = m === 'PIX' || !!e.pixCopiaECola || (!m && !!supplier?.pixKey);
  const banco = !!supplier?.bankName && m !== 'BOLETO' && m !== 'PIX';
  return { boleto, pix, banco };
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

// ── #864 anti-fraude: mensagem do aviso de troca bancária ────────────────────

const BANKING_FIELD_LABELS: Record<string, string> = {
  pixKey: 'chave PIX',
  bankName: 'banco',
  bankAgency: 'agência',
  bankAccount: 'conta',
};

/** "há 2 dias" / "hoje" — diferença em dias corridos entre `at` e `now`. */
export function diasAtras(at: string | Date, now: Date): string {
  const d = Math.floor((now.getTime() - new Date(at).getTime()) / 86_400_000);
  if (d <= 0) return 'hoje';
  return d === 1 ? 'há 1 dia' : `há ${d} dias`;
}

/**
 * Frase do aviso amarelo: "chave PIX alterada há 2 dias por Manu". Campos em
 * português; sem ator = mudança de sistema (omite o "por").
 */
export function bankingAlertMessage(
  alert: { at: string; by: { name: string } | null; fields: string[] },
  now: Date,
): string {
  const campos = alert.fields.map((f) => BANKING_FIELD_LABELS[f] ?? f).join(', ');
  const quando = diasAtras(alert.at, now);
  const quem = alert.by ? ` por ${alert.by.name}` : '';
  const plural = alert.fields.length > 1 ? 'alterados' : (alert.fields[0] === 'pixKey' ? 'alterada' : 'alterado');
  return `${campos} ${plural} ${quando}${quem}`;
}
