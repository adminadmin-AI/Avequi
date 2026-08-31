/**
 * Conciliação de compras — lógica pura da fila (Fase 2, #609, UI V1).
 *
 * Tudo aqui é testável sem DOM: tipos do contrato da API (PR-2, #1131),
 * rótulos em pt-BR, montagem dos parâmetros da listagem, presets de filtro,
 * e a descrição do que cada decisão humana vai gravar. A página (`page.tsx`)
 * só compõe estes helpers com os componentes do design system.
 *
 * Regras que esta camada protege:
 * - identidade canônica = (company do usuário, supplierId, cProd); a company
 *   vem do JWT — a UI NUNCA manda companyId (ver `buildListParams`);
 * - sugestão ≠ verdade: só `canonical` é decisão; `suggestion` é contexto;
 * - cada confirmação/classificação é um ato humano individual (sem bulk);
 * - descrição da nota é evidência, nunca identidade.
 */

export const SPM_RESOURCE = '/purchase/supplier-product-maps';
export const PERM_VIEW = 'purchases.supplier-map.view';
export const PERM_RESOLVE = 'purchases.supplier-map.resolve';

// ─── Contrato (#1131) ─────────────────────────────────────────────────────────

export type SpmStatus = 'UNRESOLVED' | 'SUGGESTED' | 'CONFIRMED' | 'REVIEW';
export type SpmKind = 'PRODUCT' | 'CONSUMABLE' | 'ASSET' | 'FREIGHT_OTHER';
/** Só os tipos que o humano pode escolher ao classificar como não-produto. */
export type NonProductKind = Exclude<SpmKind, 'PRODUCT'>;

export interface PairCanonical {
  kind: SpmKind;
  productId: string | null;
  productSku: string | null;
  productName: string | null;
  confirmedAt: string | null;
  confirmedById: string | null;
}

export interface PairSuggestion {
  productId: string | null;
  productSku: string | null;
  productName: string | null;
  kind: SpmKind | null;
  /** SEED_PRODUCAO_V2 | DESCRIPTION | RULE_NCM | MANUAL (string livre no banco) */
  source: string | null;
}

export interface BomRelevance {
  productId: string;
  activeBomCount: number;
  via: 'CONFIRMED' | 'SUGGESTED';
}

export interface PairView {
  supplierId: string;
  supplierProductCode: string;
  supplierName: string | null;
  supplierCnpj: string | null;
  documentCount: number;
  itemCount: number;
  totalQuantity: number;
  totalValue: number;
  lastPurchaseAt: string | null;
  lastUnitPrice: number | null;
  lastDescription: string | null;
  lastNcm: string | null;
  lastUnit: string | null;
  descriptionVariants: number;
  mapId: string | null;
  status: SpmStatus;
  canonical: PairCanonical | null;
  suggestion: PairSuggestion | null;
  reviewReason: string | null;
  notes: string | null;
  bomRelevance: BomRelevance | null;
  /** 0 = pendente ligado a BOM ativa · 1 = pendente · 2 = resolvido */
  priorityTier: 0 | 1 | 2;
  needsDecision: boolean;
}

export interface PairEvent {
  id: string;
  mapId: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  fromKind: string | null;
  toKind: string | null;
  fromProductId: string | null;
  toProductId: string | null;
  reason: string | null;
  actorId: string | null;
  createdAt: string;
}

export interface PairDetail extends PairView {
  events: PairEvent[];
}

export interface CoverageSummary {
  pairs: number;
  byStatus: Record<SpmStatus, number>;
  totalValue: number;
  resolvedValue: number;
  resolvedValuePct: number;
  pairsToReachTarget: number;
  targetPct: number;
  pendingBomRelevant: number;
}

export interface BomComponentCoverage {
  productId: string;
  sku: string;
  name: string;
  type: string;
  purchasedReason: 'BY_TYPE' | 'PURCHASE_EVIDENCE' | 'LEAF_SEMI_FINISHED';
  activeBomCount: number;
  confirmedPairs: number;
  suggestedPairs: number;
  covered: boolean;
}

// ─── Rótulos ─────────────────────────────────────────────────────────────────

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export const STATUS_META: Record<SpmStatus, { label: string; variant: BadgeTone }> = {
  UNRESOLVED: { label: 'Pendente', variant: 'neutral' },
  SUGGESTED: { label: 'Sugerido', variant: 'info' },
  CONFIRMED: { label: 'Confirmado', variant: 'success' },
  REVIEW: { label: 'Em revisão', variant: 'warning' },
};

/** Linguagem amigável na UI; os enums da API ficam intactos. */
export const KIND_LABEL: Record<SpmKind, string> = {
  PRODUCT: 'Produto do catálogo',
  CONSUMABLE: 'Consumo / insumo',
  ASSET: 'Ativo / imobilizado',
  FREIGHT_OTHER: 'Frete / outro',
};

export const NON_PRODUCT_KINDS: NonProductKind[] = ['CONSUMABLE', 'ASSET', 'FREIGHT_OTHER'];

export const SOURCE_LABEL: Record<string, string> = {
  SEED_PRODUCAO_V2: 'importada da ferramenta de produção (legado)',
  DESCRIPTION: 'por semelhança de descrição',
  RULE_NCM: 'por regra de NCM',
  MANUAL: 'anotada manualmente',
};

export function sourceLabel(source: string | null | undefined): string | null {
  if (!source) return null;
  return SOURCE_LABEL[source] ?? source;
}

export const EVENT_LABEL: Record<string, string> = {
  SUGGESTED: 'Sugestão registrada',
  CONFIRMED: 'Confirmado',
  RECLASSIFIED: 'Reclassificado',
  REVIEW_FLAGGED: 'Marcado para revisão',
  REVERTED: 'Sugestão descartada',
};

export function eventLabel(action: string): string {
  return EVENT_LABEL[action] ?? action;
}

/** "SKU · nome" ou só o que existir. */
export function productLabel(sku: string | null | undefined, name: string | null | undefined): string {
  if (sku && name) return `${sku} · ${name}`;
  return sku ?? name ?? '—';
}

/** Texto curto para a coluna BOM: "Usado em 16 BOMs ativas". */
export function bomLabel(rel: BomRelevance | null): string | null {
  if (!rel || rel.activeBomCount <= 0) return null;
  return rel.activeBomCount === 1 ? 'Usado em 1 BOM ativa' : `Usado em ${rel.activeBomCount} BOMs ativas`;
}

/** Destaque visual da linha — no máximo um, na ordem de urgência. */
export type RowHighlight = 'BLOCKS_BOM' | 'REVIEW' | 'HAS_SUGGESTION' | 'UNRESOLVED' | null;

export function rowHighlight(row: Pick<PairView, 'status' | 'priorityTier' | 'suggestion' | 'needsDecision'>): RowHighlight {
  if (row.priorityTier === 0) return 'BLOCKS_BOM';
  if (row.status === 'REVIEW') return 'REVIEW';
  if (row.status === 'SUGGESTED' || (row.needsDecision && row.suggestion)) return 'HAS_SUGGESTION';
  if (row.status === 'UNRESOLVED') return 'UNRESOLVED';
  return null;
}

// ─── Filtros ─────────────────────────────────────────────────────────────────

export type FilterPreset = 'ALL' | 'PENDING' | 'SUGGESTED' | 'CONFIRMED';

export const FILTER_PRESETS: { value: FilterPreset; label: string }[] = [
  { value: 'PENDING', label: 'Pendentes' },
  { value: 'SUGGESTED', label: 'Sugeridos' },
  { value: 'CONFIRMED', label: 'Confirmados' },
  { value: 'ALL', label: 'Todos' },
];

export interface QueueFilters {
  preset: FilterPreset;
  bomOnly: boolean;
  supplierId: string;
  q: string;
}

export const DEFAULT_PAGE_SIZE = 25;

export type ListParams = Record<string, string | number | boolean | undefined>;

/**
 * Parâmetros exatos do `GET /purchase/supplier-product-maps`.
 *
 * - `bomOnly`/`pendingOnly` só vão quando true (o DTO coage `"false"` → true);
 * - nunca inclui `companyId` (tenant vem do JWT — a UI não escolhe empresa);
 * - o DTO tem `forbidNonWhitelisted`: só chaves conhecidas.
 */
export function buildListParams(f: QueueFilters, page: number, pageSize: number): ListParams {
  const p: ListParams = { page, pageSize: Math.min(200, Math.max(1, pageSize)) };
  if (f.preset === 'PENDING') p.pendingOnly = true;
  if (f.preset === 'SUGGESTED') p.status = 'SUGGESTED';
  if (f.preset === 'CONFIRMED') p.status = 'CONFIRMED';
  if (f.bomOnly) p.bomOnly = true;
  const q = f.q.trim();
  if (q) p.q = q.slice(0, 120);
  if (f.supplierId) p.supplierId = f.supplierId;
  return p;
}

/**
 * "Só o que bloqueia custo de BOM" ligado por padrão quando a company tem
 * componentes comprados em BOM ativa; o usuário pode desligar. Company sem
 * BOM (caso CRD) começa com a fila completa.
 */
export function effectiveBomOnly(userChoice: boolean | null, coverage: BomComponentCoverage[] | undefined): boolean {
  if (userChoice !== null) return userChoice;
  return (coverage?.length ?? 0) > 0;
}

// ─── Resumo ──────────────────────────────────────────────────────────────────

export interface CoverageStats {
  covered: number;
  total: number;
  pending: number;
}

export function bomCoverageStats(coverage: BomComponentCoverage[] | undefined): CoverageStats {
  const total = coverage?.length ?? 0;
  const covered = coverage?.filter((c) => c.covered).length ?? 0;
  return { covered, total, pending: total - covered };
}

/** Pendentes = tudo que ainda exige decisão (UNRESOLVED + SUGGESTED + REVIEW). */
export function pendingCount(s: CoverageSummary | undefined): number {
  if (!s) return 0;
  return s.byStatus.UNRESOLVED + s.byStatus.SUGGESTED + s.byStatus.REVIEW;
}

/** Valor comprado ainda sem decisão — diferença direta dos dois totais da API. */
export function unresolvedValue(s: CoverageSummary | undefined): number {
  if (!s) return 0;
  return Math.max(0, s.totalValue - s.resolvedValue);
}

// ─── Decisão humana ──────────────────────────────────────────────────────────

export type DecisionMode = 'SUGGESTION' | 'PRODUCT' | 'KIND';

export type Decision =
  | { mode: 'SUGGESTION' | 'PRODUCT'; productId: string; productLabel: string; reason?: string }
  | { mode: 'KIND'; kind: NonProductKind; reason?: string };

/** Modo inicial do diálogo: sugestão de Product → confirmar; sugestão de tipo → classificar; senão escolher. */
export function initialDecisionMode(row: Pick<PairView, 'suggestion' | 'canonical' | 'status'>): DecisionMode {
  if (row.suggestion?.productId) return 'SUGGESTION';
  if (row.suggestion?.kind && row.suggestion.kind !== 'PRODUCT') return 'KIND';
  if (row.canonical && row.canonical.kind !== 'PRODUCT') return 'KIND';
  return 'PRODUCT';
}

export function suggestedNonProductKind(row: Pick<PairView, 'suggestion'>): NonProductKind | null {
  const k = row.suggestion?.kind;
  return k && k !== 'PRODUCT' ? k : null;
}

/** Endpoint + corpo exatos que a decisão vai enviar. */
export function decisionRequest(
  row: Pick<PairView, 'supplierId' | 'supplierProductCode'>,
  d: Decision,
): { path: string; body: Record<string, string> } {
  const base = `${SPM_RESOURCE}/pairs/${encodeURIComponent(row.supplierId)}/${encodeURIComponent(row.supplierProductCode)}`;
  const reason = d.reason?.trim();
  if (d.mode === 'KIND') {
    return { path: `${base}/classify`, body: { kind: d.kind, ...(reason ? { reason } : {}) } };
  }
  return { path: `${base}/confirm-product`, body: { productId: d.productId, ...(reason ? { reason } : {}) } };
}

export function pairDetailPath(row: Pick<PairView, 'supplierId' | 'supplierProductCode'>): string {
  return `${SPM_RESOURCE}/pairs/${encodeURIComponent(row.supplierId)}/${encodeURIComponent(row.supplierProductCode)}`;
}

/** Frase "o que será gravado" mostrada antes de confirmar. */
export function describeDecision(row: Pick<PairView, 'supplierName' | 'supplierProductCode' | 'canonical'>, d: Decision): string {
  const who = `${row.supplierName ?? 'fornecedor'} · cProd ${row.supplierProductCode}`;
  const troca = row.canonical ? ' (substitui a decisão atual; a anterior fica no histórico)' : '';
  if (d.mode === 'KIND') return `${who} → ${KIND_LABEL[d.kind]}, sem vínculo a Product${troca}.`;
  const origem = d.mode === 'SUGGESTION' ? ' (confirmando a sugestão)' : '';
  return `${who} → Product ${d.productLabel}${origem}${troca}.`;
}

export function decisionIsValid(d: Decision | null): d is Decision {
  if (!d) return false;
  if (d.mode === 'KIND') return NON_PRODUCT_KINDS.includes(d.kind);
  return d.productId.trim().length > 0;
}

/** Quem pode agir na linha (UX; o backend revalida). */
export function canActOnRow(canResolve: boolean, row: Pick<PairView, 'status'>): { resolve: boolean; dismiss: boolean; review: boolean } {
  if (!canResolve) return { resolve: false, dismiss: false, review: false };
  return {
    resolve: true, // qualquer status: CONFIRMED→CONFIRMED é reclassificação auditada
    dismiss: row.status === 'SUGGESTED',
    review: row.status === 'CONFIRMED',
  };
}

/** Texto do botão principal da linha. */
export function primaryActionLabel(row: Pick<PairView, 'status' | 'suggestion'>): string {
  if (row.status === 'CONFIRMED') return 'Trocar';
  if (row.suggestion?.productId || row.suggestion?.kind) return 'Confirmar';
  return 'Resolver';
}
