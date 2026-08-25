/**
 * SupplierProductMap — núcleo PURO da listagem/priorização (Fase 2, PR-2).
 *
 *   FiscalDocument RECEBIDA → FiscalDocumentItem.cProd → SupplierProductMap → Product
 *
 * Este módulo não conhece Prisma: recebe linhas de itens fiscais, mapas
 * existentes, componentes das BOMs ativas e produtos, e devolve a visão por
 * par (companyId, supplierId, supplierProductCode) com métricas de compra,
 * estado canônico, sugestão (separada da verdade) e prioridade.
 *
 * Decisões de produto aplicadas (Rafael, 24/08/2026):
 *  - identidade = cProd EXATO do fornecedor (trim apenas; zeros à esquerda
 *    preservados; descrição/NCM/unidade nunca identificam);
 *  - itens de documento CANCELADO não contaminam as métricas de compra;
 *  - sugestão nunca é verdade: `suggestion` e `canonical` são campos distintos;
 *  - prioridade: primeiro o que impacta BOM ativa, depois valor acumulado,
 *    depois recorrência (ver `comparePriority` para a justificativa).
 */

import { SpmKind, SpmStatus, normalizeDescription } from './supplier-product-map.rules';

// ─── Identidade ──────────────────────────────────────────────────────────────

/**
 * Normalização DEFENSIVA do cProd: só remove espaços nas pontas. Nunca remove
 * zeros à esquerda, nunca muda caixa, nunca colapsa espaços internos — o
 * código é o vocabulário do fornecedor e "0012" ≠ "12".
 */
export function normalizeSupplierProductCode(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

export function pairKey(supplierId: string, supplierProductCode: string): string {
  return `${supplierId}\u0000${supplierProductCode}`;
}

// ─── Entrada ─────────────────────────────────────────────────────────────────

/** Uma linha de FiscalDocumentItem já juntada ao seu FiscalDocument (mesma company). */
export interface FiscalItemRow {
  documentId: string;
  documentStatus: string; // FiscalStatus — só AUTHORIZED conta
  supplierId: string | null;
  issueDate: Date | null;
  productCode: string | null; // cProd
  productName: string;
  ncm: string | null;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface ExistingMap {
  id: string;
  supplierId: string;
  supplierProductCode: string;
  status: SpmStatus;
  kind: SpmKind | null;
  productId: string | null;
  suggestedProductId: string | null;
  suggestedKind: SpmKind | null;
  suggestionSource: string | null;
  confirmedAt: Date | null;
  confirmedById: string | null;
  reviewReason: string | null;
  notes: string | null;
  lastSeenDescription: string | null;
}

export interface ProductRef {
  id: string;
  sku: string;
  name: string;
  type: string; // ProductType
  isActive: boolean;
}

// ─── Métricas por par ────────────────────────────────────────────────────────

export interface PairMetrics {
  supplierId: string;
  supplierProductCode: string;
  /** notas fiscais AUTORIZADAS distintas em que o par aparece */
  documentCount: number;
  /** linhas de item (um documento pode ter o mesmo cProd em 2 linhas) */
  itemCount: number;
  totalQuantity: number;
  /** valor acumulado comprado (soma de totalPrice dos itens autorizados) */
  totalValue: number;
  lastPurchaseAt: Date | null;
  lastUnitPrice: number | null;
  /** descrição/NCM/unidade da ocorrência MAIS RECENTE (evidência, não identidade) */
  lastDescription: string | null;
  lastNcm: string | null;
  lastUnit: string | null;
  /** quantas descrições distintas o fornecedor já usou para o mesmo cProd */
  descriptionVariants: number;
}

const ELIGIBLE_STATUS = 'AUTHORIZED';

/**
 * Agrega itens fiscais em pares. Ignora: documentos não autorizados
 * (cancelados/rejeitados/pendentes), itens sem fornecedor cadastrado (passam
 * antes pela #611) e itens sem cProd (não há identidade possível).
 */
export function aggregatePairs(rows: FiscalItemRow[]): PairMetrics[] {
  const acc = new Map<string, PairMetrics & { _descriptions: Set<string>; _lastAt: number }>();
  for (const r of rows) {
    if (r.documentStatus !== ELIGIBLE_STATUS) continue;
    if (!r.supplierId) continue;
    const code = normalizeSupplierProductCode(r.productCode);
    if (!code) continue;
    const key = pairKey(r.supplierId, code);
    let m = acc.get(key);
    if (!m) {
      m = {
        supplierId: r.supplierId, supplierProductCode: code,
        documentCount: 0, itemCount: 0, totalQuantity: 0, totalValue: 0,
        lastPurchaseAt: null, lastUnitPrice: null, lastDescription: null, lastNcm: null, lastUnit: null,
        descriptionVariants: 0, _descriptions: new Set<string>(), _lastAt: -Infinity,
      };
      acc.set(key, m);
    }
    m.itemCount += 1;
    m.totalQuantity += Number(r.quantity) || 0;
    m.totalValue += Number(r.totalPrice) || 0;
    m._descriptions.add(normalizeDescription(r.productName ?? ''));
    const at = r.issueDate ? new Date(r.issueDate).getTime() : 0;
    // "mais recente" por data de emissão; empate mantém a primeira vista
    if (at > m._lastAt) {
      m._lastAt = at;
      m.lastPurchaseAt = r.issueDate ? new Date(r.issueDate) : null;
      m.lastUnitPrice = Number(r.unitPrice);
      m.lastDescription = r.productName ?? null;
      m.lastNcm = r.ncm ?? null;
      m.lastUnit = r.unit ?? null;
    }
  }
  // documentCount = documentos distintos
  const docsByKey = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.documentStatus !== ELIGIBLE_STATUS || !r.supplierId) continue;
    const code = normalizeSupplierProductCode(r.productCode);
    if (!code) continue;
    const key = pairKey(r.supplierId, code);
    if (!docsByKey.has(key)) docsByKey.set(key, new Set());
    docsByKey.get(key)!.add(r.documentId);
  }
  return [...acc.values()].map((m) => {
    const { _descriptions, _lastAt, ...rest } = m;
    return {
      ...rest,
      documentCount: docsByKey.get(pairKey(m.supplierId, m.supplierProductCode))?.size ?? 0,
      descriptionVariants: _descriptions.size,
      totalValue: round4(rest.totalValue),
      totalQuantity: round4(rest.totalQuantity),
    };
  });
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ─── Visão por par (métricas + canônico + sugestão + BOM + prioridade) ───────

export interface BomRelevance {
  /** Product que liga o par a BOM ativa (canônico confirmado OU sugerido) */
  productId: string;
  /** em quantas BOMs ativas esse Product é componente */
  activeBomCount: number;
  /** de onde vem a ligação — sugestão NÃO é verdade */
  via: 'CONFIRMED' | 'SUGGESTED';
}

export interface PairView extends PairMetrics {
  supplierName: string | null;
  supplierCnpj: string | null;
  mapId: string | null;
  status: SpmStatus; // UNRESOLVED quando ainda não existe linha de mapa
  /** verdade canônica — só CONFIRMED/REVIEW */
  canonical: { kind: SpmKind; productId: string | null; productSku: string | null; productName: string | null; confirmedAt: Date | null; confirmedById: string | null } | null;
  /** sugestão — nunca vira verdade sozinha */
  suggestion: { productId: string | null; productSku: string | null; productName: string | null; kind: SpmKind | null; source: string | null } | null;
  reviewReason: string | null;
  notes: string | null;
  bomRelevance: BomRelevance | null;
  /** 0 = pendente E relevante para BOM ativa · 1 = pendente · 2 = resolvido */
  priorityTier: 0 | 1 | 2;
  /** decisão humana ainda necessária? (UNRESOLVED/SUGGESTED/REVIEW) */
  needsDecision: boolean;
}

export interface BuildViewsInput {
  metrics: PairMetrics[];
  maps: ExistingMap[];
  suppliers: Map<string, { name: string; cnpj: string | null }>;
  products: Map<string, ProductRef>;
  /** componentId → nº de BOMs ATIVAS em que aparece (só desta company) */
  activeBomCountByProduct: Map<string, number>;
}

export function isResolved(status: SpmStatus): boolean {
  return status === 'CONFIRMED';
}

export function buildPairViews(input: BuildViewsInput): PairView[] {
  const mapsByKey = new Map(input.maps.map((m) => [pairKey(m.supplierId, m.supplierProductCode), m]));
  // pares que só existem como mapa (sem item fiscal autorizado) também aparecem
  const metricsByKey = new Map(input.metrics.map((m) => [pairKey(m.supplierId, m.supplierProductCode), m]));
  for (const m of input.maps) {
    const k = pairKey(m.supplierId, m.supplierProductCode);
    if (!metricsByKey.has(k)) {
      metricsByKey.set(k, {
        supplierId: m.supplierId, supplierProductCode: m.supplierProductCode,
        documentCount: 0, itemCount: 0, totalQuantity: 0, totalValue: 0, lastPurchaseAt: null, lastUnitPrice: null,
        lastDescription: m.lastSeenDescription, lastNcm: null, lastUnit: null, descriptionVariants: 0,
      });
    }
  }
  const views: PairView[] = [];
  for (const [k, met] of metricsByKey) {
    const map = mapsByKey.get(k) ?? null;
    const status: SpmStatus = map?.status ?? 'UNRESOLVED';
    const sup = input.suppliers.get(met.supplierId);
    const prod = (id: string | null) => (id ? input.products.get(id) ?? null : null);
    const canonical = map && (status === 'CONFIRMED' || status === 'REVIEW') && map.kind
      ? { kind: map.kind, productId: map.productId, productSku: prod(map.productId)?.sku ?? null, productName: prod(map.productId)?.name ?? null, confirmedAt: map.confirmedAt, confirmedById: map.confirmedById }
      : null;
    const suggestion = map && (map.suggestedProductId || map.suggestedKind)
      ? { productId: map.suggestedProductId, productSku: prod(map.suggestedProductId)?.sku ?? null, productName: prod(map.suggestedProductId)?.name ?? null, kind: map.suggestedKind, source: map.suggestionSource }
      : null;
    let bomRelevance: BomRelevance | null = null;
    if (canonical?.productId && input.activeBomCountByProduct.has(canonical.productId)) {
      bomRelevance = { productId: canonical.productId, activeBomCount: input.activeBomCountByProduct.get(canonical.productId)!, via: 'CONFIRMED' };
    } else if (suggestion?.productId && input.activeBomCountByProduct.has(suggestion.productId)) {
      bomRelevance = { productId: suggestion.productId, activeBomCount: input.activeBomCountByProduct.get(suggestion.productId)!, via: 'SUGGESTED' };
    }
    const needsDecision = !isResolved(status);
    const priorityTier: 0 | 1 | 2 = !needsDecision ? 2 : bomRelevance ? 0 : 1;
    views.push({
      ...met,
      supplierName: sup?.name ?? null, supplierCnpj: sup?.cnpj ?? null,
      mapId: map?.id ?? null, status, canonical, suggestion,
      reviewReason: map?.reviewReason ?? null, notes: map?.notes ?? null,
      bomRelevance, priorityTier, needsDecision,
    });
  }
  return views;
}

/**
 * Ordem de prioridade (decisão §7 do PR-2):
 *   1. pares PENDENTES ligados a componente de BOM ativa (o que impede custo);
 *   2. dentro do tier, VALOR acumulado comprado (é o que leva aos ~80%);
 *   3. RECORRÊNCIA (nº de documentos) — desempate; um par recorrente de valor
 *      igual vale mais porque volta a aparecer nas próximas compras;
 *   4. código (estabilidade da ordenação).
 *
 * Por que tiers e não um score contínuo: com log(valor) um CAPEX de R$ 1 mi
 * (laser, robô) passa na frente de um componente de BOM de R$ 5 mil, e o
 * objetivo declarado é cobrir a BOM ativa PRIMEIRO e só depois o valor.
 * `provisionalPriorityScore` (PR-1) fica como referência; a ordenação
 * canônica é esta. Resolvidos vão para o fim.
 */
export function comparePriority(a: PairView, b: PairView): number {
  if (a.priorityTier !== b.priorityTier) return a.priorityTier - b.priorityTier;
  if (a.totalValue !== b.totalValue) return b.totalValue - a.totalValue;
  if (a.documentCount !== b.documentCount) return b.documentCount - a.documentCount;
  if (a.supplierId !== b.supplierId) return a.supplierId < b.supplierId ? -1 : 1;
  return a.supplierProductCode < b.supplierProductCode ? -1 : a.supplierProductCode > b.supplierProductCode ? 1 : 0;
}

// ─── Resumo / cobertura ──────────────────────────────────────────────────────

export interface CoverageSummary {
  pairs: number;
  byStatus: Record<SpmStatus, number>;
  totalValue: number;
  /** valor dos pares CONFIRMED (qualquer kind — classificar como não-produto também resolve) */
  resolvedValue: number;
  resolvedValuePct: number;
  /** quantos pares (pendentes, por ordem de valor) faltam para o valor resolvido atingir a meta */
  pairsToReachTarget: number;
  targetPct: number;
  /** pendentes ligados a BOM ativa (tier 0) */
  pendingBomRelevant: number;
}

export function summarize(views: PairView[], targetPct = 0.8): CoverageSummary {
  const byStatus: Record<SpmStatus, number> = { UNRESOLVED: 0, SUGGESTED: 0, CONFIRMED: 0, REVIEW: 0 };
  let totalValue = 0;
  let resolvedValue = 0;
  for (const v of views) {
    byStatus[v.status] += 1;
    totalValue += v.totalValue;
    if (isResolved(v.status)) resolvedValue += v.totalValue;
  }
  const target = totalValue * targetPct;
  let cum = resolvedValue;
  let needed = 0;
  if (cum < target) {
    const pending = views.filter((v) => v.needsDecision).sort((a, b) => b.totalValue - a.totalValue);
    for (const v of pending) {
      cum += v.totalValue;
      needed += 1;
      if (cum >= target) break;
    }
    if (cum < target) needed = pending.length; // nem resolvendo tudo chega (valor sem fornecedor etc.)
  }
  return {
    pairs: views.length, byStatus,
    totalValue: round4(totalValue), resolvedValue: round4(resolvedValue),
    resolvedValuePct: totalValue > 0 ? Math.round((resolvedValue / totalValue) * 10000) / 100 : 0,
    pairsToReachTarget: needed, targetPct: targetPct * 100,
    pendingBomRelevant: views.filter((v) => v.priorityTier === 0).length,
  };
}

/** Tipos de Product comprados POR NATUREZA (nunca fabricados internamente). */
export const PURCHASED_COMPONENT_TYPES = ['RAW_MATERIAL', 'COMPONENT', 'CONSUMABLE'] as const;

/**
 * Por que um componente de BOM ativa conta como COMPRADO:
 *  - BY_TYPE: RAW_MATERIAL/COMPONENT/CONSUMABLE — comprado por natureza;
 *  - PURCHASE_EVIDENCE: já foi comprado (POItem, SupplierPriceHistory) ou já
 *    tem de-para CONFIRMED apontando para ele — vale para qualquer tipo,
 *    inclusive SEMI_FINISHED e FINISHED_GOOD;
 *  - LEAF_SEMI_FINISHED: SEMI_FINISHED sem BOM própria ativa — não é feito
 *    aqui, logo vem de fora. (FINISHED_GOOD NÃO entra por esta via.)
 * O schema não tem flag make/buy no Product; esta é a inferência mínima e
 * explícita — cada componente diz por que entrou.
 */
export type PurchasedReason = 'BY_TYPE' | 'PURCHASE_EVIDENCE' | 'LEAF_SEMI_FINISHED';

export interface BomComponentInput extends ProductRef {
  activeBomCount: number;
  /** o próprio Product tem BomVersion ativa (é fabricado internamente) */
  hasOwnActiveBom: boolean;
  /** POItem / SupplierPriceHistory / SupplierProductMap CONFIRMED apontando para ele */
  hasPurchaseEvidence: boolean;
}

export function purchasedReason(c: BomComponentInput): PurchasedReason | null {
  if ((PURCHASED_COMPONENT_TYPES as readonly string[]).includes(c.type)) return 'BY_TYPE';
  if (c.hasPurchaseEvidence) return 'PURCHASE_EVIDENCE';
  if (c.type === 'SEMI_FINISHED' && !c.hasOwnActiveBom) return 'LEAF_SEMI_FINISHED';
  return null;
}

export interface BomComponentCoverage {
  productId: string;
  sku: string;
  name: string;
  type: string;
  purchasedReason: PurchasedReason;
  activeBomCount: number;
  confirmedPairs: number; // mapas CONFIRMED kind=PRODUCT apontando para ele
  suggestedPairs: number; // mapas com suggestedProductId apontando para ele
  covered: boolean; // ≥ 1 par CONFIRMED
}

/**
 * "Quais componentes comprados das BOMs ativas ainda não têm de-para
 * confirmado?" — a resposta a "o que impede calcular o custo".
 * Componentes fabricados internamente (SEMI_FINISHED/FINISHED_GOOD com BOM
 * própria e sem evidência de compra) ficam de fora: o custo deles vem da
 * própria BOM, não de um fornecedor.
 */
export function bomCoverage(components: BomComponentInput[], views: PairView[]): BomComponentCoverage[] {
  const confirmed = new Map<string, number>();
  const suggested = new Map<string, number>();
  for (const v of views) {
    if (v.canonical?.productId && v.status === 'CONFIRMED') confirmed.set(v.canonical.productId, (confirmed.get(v.canonical.productId) ?? 0) + 1);
    if (v.suggestion?.productId && v.needsDecision) suggested.set(v.suggestion.productId, (suggested.get(v.suggestion.productId) ?? 0) + 1);
  }
  const out: BomComponentCoverage[] = [];
  for (const c of components) {
    const reason = purchasedReason({ ...c, hasPurchaseEvidence: c.hasPurchaseEvidence || (confirmed.get(c.id) ?? 0) > 0 });
    if (!reason) continue;
    out.push({
      productId: c.id, sku: c.sku, name: c.name, type: c.type, purchasedReason: reason, activeBomCount: c.activeBomCount,
      confirmedPairs: confirmed.get(c.id) ?? 0, suggestedPairs: suggested.get(c.id) ?? 0,
      covered: (confirmed.get(c.id) ?? 0) > 0,
    });
  }
  return out.sort((a, b) => Number(a.covered) - Number(b.covered) || b.activeBomCount - a.activeBomCount || a.sku.localeCompare(b.sku));
}

// ─── Sugestão por descrição (barata, sem IA) ─────────────────────────────────

export interface DescriptionCandidate {
  productId: string;
  sku: string;
  name: string;
  score: number; // Jaccard de tokens (0..1)
  rationale: string;
}

const STOPWORDS = new Set(['DE', 'DA', 'DO', 'PARA', 'COM', 'EM', 'E', 'A', 'O', 'UN', 'PC', 'PCS', 'KG', 'MM', 'CM', 'M']);

function tokens(s: string): string[] {
  return [...new Set(normalizeDescription(s).split(' ').filter((t) => t.length > 1 && !STOPWORDS.has(t)))];
}

/** Abreviações de fornecedor: "SEXT" ~ "SEXTAVADO", "ZINC" ~ "ZINCADO" (prefixo ≥ 4). Números/curtos só exatos. */
function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (/^\d/.test(a) || /^\d/.test(b)) return false;
  return a.startsWith(b) || b.startsWith(a);
}

/** Jaccard tolerante a prefixo: |casados| / (|a| + |b| − |casados|). */
function tokenSimilarity(a: string[], b: string[]): { score: number; shared: string[] } {
  const shared = a.filter((ta) => b.some((tb) => tokenMatches(ta, tb)));
  const denom = a.length + b.length - shared.length;
  return { score: denom > 0 ? shared.length / denom : 0, shared };
}

export function suggestByDescription(
  description: string | null,
  products: ProductRef[],
  opts: { minScore?: number; minGap?: number } = {},
): DescriptionCandidate | null {
  const minScore = opts.minScore ?? 0.5;
  const minGap = opts.minGap ?? 0.15;
  if (!description) return null;
  const a = tokens(description);
  if (a.length === 0) return null;
  const scored: Array<DescriptionCandidate & { shared: string[] }> = [];
  for (const p of products) {
    if (!p.isActive) continue;
    const b = tokens(p.name);
    if (b.length === 0) continue;
    const { score, shared } = tokenSimilarity(a, b);
    if (score > 0) scored.push({ productId: p.id, sku: p.sku, name: p.name, score, rationale: '', shared });
  }
  if (scored.length === 0) return null;
  scored.sort((x, y) => y.score - x.score);
  const best = scored[0];
  const second = scored[1];
  if (best.score < minScore) return null;
  if (second && best.score - second.score < minGap) return null; // ambíguo
  const rationale = `DESCRIPTION jaccard=${best.score.toFixed(2)} tokens=[${best.shared.join(' ')}]` + (second ? ` segundo=${second.sku}(${second.score.toFixed(2)})` : '');
  return { productId: best.productId, sku: best.sku, name: best.name, score: Math.round(best.score * 100) / 100, rationale };
}
