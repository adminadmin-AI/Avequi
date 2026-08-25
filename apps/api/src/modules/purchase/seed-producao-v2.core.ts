/**
 * Bootstrap Avequi (PR-3 da Fase 2, #609): sugestões a partir do
 * `Mapeamento_Nota_Item` do producao_v2 — NÚCLEO PURO.
 *
 * Ferramenta de MIGRAÇÃO, descartável e reexecutável. O runtime do ERP não
 * depende disto: o script lê um export do legado (TSV) e usa o serviço
 * canônico (`SupplierProductMapService.suggest`) para gravar — e só grava
 * com `--commit` + evidência nominal do mesmo dia.
 *
 * O legado mapeia por DESCRIÇÃO (`DescricaoNota`), sem fornecedor, sem
 * company. Aqui isso vira, no máximo, uma SUGESTÃO por par canônico
 * (companyId, supplierId, cProd):
 *   - Comprado/MP → código legado → Product.sku do MESMO tenant, ativo, único
 *     ⇒ WOULD_SUGGEST_PRODUCT (suggestedProductId, source SEED_PRODUCAO_V2);
 *   - Insumo/EPI ⇒ WOULD_SUGGEST_KIND (suggestedKind CONSUMABLE);
 *   - qualquer outra coisa ⇒ SKIPPED/AMBIGUOUS/INVALID com motivo.
 * SUGGESTED ≠ RESOLVED: nada aqui confirma, classifica canonicamente ou
 * tira um par da fila de decisão humana.
 *
 * Precedência: decisão humana canônica (CONFIRMED/REVIEW) > sugestão
 * existente > seed legado > nada. Sugestão igual ⇒ UNCHANGED; diferente ⇒
 * CONFLICT_EXISTING_SUGGESTION (nunca sobrescreve em silêncio).
 */

import { SpmKind, SpmStatus, normalizeDescription } from './supplier-product-map.rules';
import { PairMetrics, normalizeSupplierProductCode } from './supplier-product-map.aggregate';

export type LegacyTipo = 'Comprado' | 'MP' | 'Insumo' | 'EPI';

/** Linha do export legado (Mapeamento_Nota_Item já juntado a Pecas/Materia_Prima). */
export interface LegacyRow {
  id: string;
  descricaoNota: string;
  tipo: LegacyTipo | string;
  /** Pecas.Codigo ou Materia_Prima.Codigo (= Product.sku esperado); vazio para Insumo/EPI */
  codigo: string | null;
  ocorrencias?: number;
}

export interface TenantProduct {
  id: string;
  companyId: string;
  sku: string;
  name: string;
  isActive: boolean;
}

export interface ExistingMapState {
  status: SpmStatus;
  kind: SpmKind | null;
  productId: string | null;
  suggestedProductId: string | null;
  suggestedKind: SpmKind | null;
  suggestionSource: string | null;
}

export type SeedOutcome =
  | 'WOULD_SUGGEST_PRODUCT'
  | 'WOULD_SUGGEST_KIND'
  | 'UNCHANGED'
  | 'SKIPPED_TENANT'
  | 'SKIPPED_INACTIVE_PRODUCT'
  | 'AMBIGUOUS'
  | 'CONFLICT_EXISTING_DECISION'
  | 'CONFLICT_EXISTING_SUGGESTION'
  | 'SKIPPED_MANUAL_EXCLUSION'
  | 'INVALID'
  | 'NO_MATCH';

export interface SeedPlanItem {
  companyId: string;
  supplierId: string;
  supplierProductCode: string;
  outcome: SeedOutcome;
  reason: string;
  /** só em WOULD_SUGGEST_PRODUCT */
  suggestedProductId?: string;
  suggestedSku?: string;
  /** só em WOULD_SUGGEST_KIND */
  suggestedKind?: SpmKind;
  /** ids das linhas legadas que sustentam a sugestão */
  legacyIds: string[];
  rationale: string;
  totalValue: number;
  documentCount: number;
  lastDescription: string | null;
}

export const SEED_SOURCE = 'SEED_PRODUCAO_V2';
const KIND_TIPOS = new Set(['Insumo', 'EPI']);
const PRODUCT_TIPOS = new Set(['Comprado', 'MP']);

/** Índice do legado por descrição normalizada (a MESMA normalização das regras). */
export function indexLegacy(rows: LegacyRow[]): Map<string, LegacyRow[]> {
  const idx = new Map<string, LegacyRow[]>();
  for (const r of rows) {
    const k = normalizeDescription(r.descricaoNota ?? '');
    if (!k) continue;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k)!.push(r);
  }
  return idx;
}

/** Índice de Products por (companyId, sku upper). */
export function indexProducts(products: TenantProduct[]): Map<string, TenantProduct[]> {
  const idx = new Map<string, TenantProduct[]>();
  for (const p of products) {
    const k = `${p.companyId} ${p.sku.trim().toUpperCase()}`;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k)!.push(p);
  }
  return idx;
}

export interface PlanInput {
  companyId: string;
  /** pares do tenant com métricas (aggregatePairs) — cada par traz TODAS as descrições vistas */
  pairs: Array<PairMetrics & { descriptions: string[] }>;
  legacy: Map<string, LegacyRow[]>;
  products: Map<string, TenantProduct[]>;
  /** mapa existente por chave `${supplierId} ${code}` (pode estar vazio) */
  existing: Map<string, ExistingMapState>;
  /**
   * Exclusões NOMINAIS de linhas legadas (legacyId → razão): o dado legado
   * continua existindo e íntegro na fonte; o bootstrap apenas recusa usá-lo
   * como sugestão, de forma explícita e versionada. Um par cuja única
   * correspondência legada esteja excluída sai como SKIPPED_MANUAL_EXCLUSION.
   */
  exclusions?: Map<string, string>;
}

interface Resolution {
  productIds: Set<string>;
  skus: Set<string>;
  kinds: Set<SpmKind>;
  invalid: string[];
  tenantBlocked: string[];
  inactive: string[];
  legacyIds: string[];
  excluded: Array<{ id: string; reason: string }>;
}

function resolveLegacy(input: PlanInput, descriptions: string[]): Resolution | null {
  const r: Resolution = { productIds: new Set(), skus: new Set(), kinds: new Set(), invalid: [], tenantBlocked: [], inactive: [], legacyIds: [], excluded: [] };
  let hits = 0;
  for (const d of descriptions) {
    for (const row of input.legacy.get(normalizeDescription(d)) ?? []) {
      const exclusion = input.exclusions?.get(row.id);
      if (exclusion !== undefined) { r.excluded.push({ id: row.id, reason: exclusion }); continue; }
      hits++;
      r.legacyIds.push(row.id);
      if (KIND_TIPOS.has(row.tipo)) { r.kinds.add('CONSUMABLE'); continue; }
      if (!PRODUCT_TIPOS.has(row.tipo)) { r.invalid.push(`tipo legado desconhecido: ${row.tipo}`); continue; }
      const sku = (row.codigo ?? '').trim().toUpperCase();
      if (!sku) { r.invalid.push(`linha legada ${row.id} sem código`); continue; }
      const sameTenant = input.products.get(`${input.companyId} ${sku}`) ?? [];
      if (sameTenant.length === 0) {
        // existe em OUTRO tenant? então é bloqueio de tenant, não código inexistente
        const anywhere = [...input.products.entries()].some(([k]) => k.endsWith(` ${sku}`));
        if (anywhere) r.tenantBlocked.push(sku); else r.invalid.push(`SKU ${sku} não existe no ERP`);
        continue;
      }
      if (sameTenant.length > 1) { r.invalid.push(`SKU ${sku} duplicado no tenant`); continue; }
      const p = sameTenant[0];
      if (!p.isActive) { r.inactive.push(sku); continue; }
      r.productIds.add(p.id); r.skus.add(sku);
    }
  }
  return hits === 0 && r.excluded.length === 0 ? null : r;
}

/**
 * Planeja o que o seed faria para UM tenant. Puro; nada é gravado.
 */
export function planSeed(input: PlanInput): SeedPlanItem[] {
  const out: SeedPlanItem[] = [];
  for (const pair of input.pairs) {
    const code = normalizeSupplierProductCode(pair.supplierProductCode);
    if (!code) continue;
    const base = {
      companyId: input.companyId, supplierId: pair.supplierId, supplierProductCode: code,
      totalValue: pair.totalValue, documentCount: pair.documentCount, lastDescription: pair.lastDescription,
    };
    const res = resolveLegacy(input, pair.descriptions);
    if (!res) { out.push({ ...base, outcome: 'NO_MATCH', reason: 'descrição sem correspondência no legado', legacyIds: [], rationale: '' }); continue; }
    const legacyIds = [...new Set(res.legacyIds)];
    if (legacyIds.length === 0) {
      // só havia correspondências legadas EXCLUÍDAS nominalmente: recusa consciente, não erro
      out.push({ ...base, outcome: 'SKIPPED_MANUAL_EXCLUSION', reason: res.excluded.map((e) => `legado Id ${e.id} excluído: ${e.reason}`).join('; '), legacyIds: res.excluded.map((e) => e.id), rationale: '' });
      continue;
    }
    const rationale = `${SEED_SOURCE} legado=[${legacyIds.join(',')}] descricao="${normalizeDescription(pair.descriptions[0] ?? '')}"`;

    // 1) resolução do legado para este par
    let outcome: SeedOutcome; let reason: string; let suggestedProductId: string | undefined; let suggestedSku: string | undefined; let suggestedKind: SpmKind | undefined;
    if (res.productIds.size > 1) { outcome = 'AMBIGUOUS'; reason = `legado aponta para ${res.productIds.size} Products: ${[...res.skus].join(', ')}`; }
    else if (res.productIds.size === 1 && (res.kinds.size > 0 || res.inactive.length || res.tenantBlocked.length || res.invalid.length)) {
      outcome = 'AMBIGUOUS'; reason = `legado mistura Product (${[...res.skus].join(',')}) com ${res.kinds.size ? 'kind' : ''}${res.inactive.length ? ' inativo' : ''}${res.tenantBlocked.length ? ' outro-tenant' : ''}${res.invalid.length ? ' inválido' : ''}`;
    }
    else if (res.productIds.size === 1) { outcome = 'WOULD_SUGGEST_PRODUCT'; suggestedProductId = [...res.productIds][0]; suggestedSku = [...res.skus][0]; reason = `Comprado/MP → ${suggestedSku} (ativo, mesmo tenant, único)`; }
    else if (res.kinds.size === 1 && !res.inactive.length && !res.tenantBlocked.length && !res.invalid.length) { outcome = 'WOULD_SUGGEST_KIND'; suggestedKind = 'CONSUMABLE'; reason = 'Insumo/EPI → parece CONSUMABLE (só sugestão)'; }
    else if (res.tenantBlocked.length && !res.inactive.length && !res.invalid.length && !res.kinds.size) { outcome = 'SKIPPED_TENANT'; reason = `Product ${[...new Set(res.tenantBlocked)].join(',')} pertence a outra company`; }
    else if (res.inactive.length && !res.tenantBlocked.length && !res.invalid.length && !res.kinds.size) { outcome = 'SKIPPED_INACTIVE_PRODUCT'; reason = `Product ${[...new Set(res.inactive)].join(',')} inativo`; }
    else if (res.kinds.size && (res.tenantBlocked.length || res.inactive.length || res.invalid.length)) { outcome = 'AMBIGUOUS'; reason = 'legado mistura kind com alvo inválido/outro tenant/inativo'; }
    else { outcome = 'INVALID'; reason = [...new Set([...res.invalid, ...res.tenantBlocked.map((s) => `outro tenant ${s}`), ...res.inactive.map((s) => `inativo ${s}`)])].join('; '); }

    // 2) precedência sobre o que já existe no mapa
    const existing = input.existing.get(`${pair.supplierId} ${code}`);
    if (existing && (outcome === 'WOULD_SUGGEST_PRODUCT' || outcome === 'WOULD_SUGGEST_KIND')) {
      if (existing.status === 'CONFIRMED' || existing.status === 'REVIEW') {
        outcome = 'CONFLICT_EXISTING_DECISION'; reason = `decisão humana ${existing.status} (${existing.kind ?? '-'}${existing.productId ? ' ' + existing.productId : ''}) prevalece`;
      } else if (existing.suggestedProductId || existing.suggestedKind) {
        const same = suggestedProductId ? existing.suggestedProductId === suggestedProductId : existing.suggestedKind === suggestedKind && !existing.suggestedProductId;
        if (same) { outcome = 'UNCHANGED'; reason = `mesma sugestão já registrada (${existing.suggestionSource ?? '-'})`; }
        else { outcome = 'CONFLICT_EXISTING_SUGGESTION'; reason = `já existe sugestão ${existing.suggestionSource ?? '-'} (${existing.suggestedProductId ?? existing.suggestedKind}) diferente do seed — não sobrescrever`; }
      }
    }
    out.push({ ...base, outcome, reason, suggestedProductId, suggestedSku, suggestedKind, legacyIds, rationale });
  }
  return out;
}

export interface SeedSummary {
  byOutcome: Record<SeedOutcome, { pairs: number; value: number }>;
  totalPairs: number;
  totalValue: number;
  /** componentes comprados de BOM ativa que RECEBERIAM sugestão (≠ cobertura confirmada) */
  suggestionCoverage: { components: number; of: number; skus: string[] };
  /** componentes com par CONFIRMED apontando para eles — o seed NUNCA altera isto */
  confirmedCoverage: { components: number; of: number };
  note: string;
}

export function summarizeSeed(
  plan: SeedPlanItem[],
  bomComponents: Array<{ id: string; sku: string }>,
  confirmedProductIds: Set<string>,
): SeedSummary {
  const outcomes: SeedOutcome[] = ['WOULD_SUGGEST_PRODUCT', 'WOULD_SUGGEST_KIND', 'UNCHANGED', 'SKIPPED_TENANT', 'SKIPPED_INACTIVE_PRODUCT', 'AMBIGUOUS', 'CONFLICT_EXISTING_DECISION', 'CONFLICT_EXISTING_SUGGESTION', 'SKIPPED_MANUAL_EXCLUSION', 'INVALID', 'NO_MATCH'];
  const byOutcome = Object.fromEntries(outcomes.map((o) => [o, { pairs: 0, value: 0 }])) as SeedSummary['byOutcome'];
  for (const p of plan) { byOutcome[p.outcome].pairs += 1; byOutcome[p.outcome].value += p.totalValue; }
  for (const o of outcomes) byOutcome[o].value = Math.round(byOutcome[o].value * 100) / 100;
  const suggested = new Set(plan.filter((p) => p.outcome === 'WOULD_SUGGEST_PRODUCT').map((p) => p.suggestedProductId!));
  const covered = bomComponents.filter((c) => suggested.has(c.id));
  return {
    byOutcome,
    totalPairs: plan.length,
    totalValue: Math.round(plan.reduce((s, p) => s + p.totalValue, 0) * 100) / 100,
    suggestionCoverage: { components: covered.length, of: bomComponents.length, skus: covered.map((c) => c.sku).sort() },
    confirmedCoverage: { components: bomComponents.filter((c) => confirmedProductIds.has(c.id)).length, of: bomComponents.length },
    note: 'SUGGESTED ≠ RESOLVED/CONFIRMED: nenhum par sai da fila de decisão humana por receber sugestão; confirmedCoverage só muda por confirmação explícita e auditada.',
  };
}

/** Evidência nominal (chaves ordenadas) para o gate do --commit — inclui as exclusões conscientes. */
export function nominalEvidence(plan: SeedPlanItem[]): { product: string[]; kind: string[]; excluded: string[] } {
  const key = (p: SeedPlanItem) => `${p.companyId}|${p.supplierId}|${p.supplierProductCode}|${p.suggestedProductId ?? p.suggestedKind}`;
  return {
    product: plan.filter((p) => p.outcome === 'WOULD_SUGGEST_PRODUCT').map(key).sort(),
    kind: plan.filter((p) => p.outcome === 'WOULD_SUGGEST_KIND').map(key).sort(),
    excluded: plan.filter((p) => p.outcome === 'SKIPPED_MANUAL_EXCLUSION').map((p) => `${p.companyId}|${p.supplierId}|${p.supplierProductCode}|legado:${p.legacyIds.join('+')}`).sort(),
  };
}

/** Parser do TSV exportado do legado (colunas: Id, DescricaoNota, Ocorrencias, TipoMapeamento, Codigo). */
export function parseLegacyTsv(text: string): LegacyRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split('\t').map((h) => h.trim());
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iId = col('Id'), iDesc = col('DescricaoNota'), iOc = col('Ocorrencias'), iTipo = col('TipoMapeamento'), iCod = col('Codigo');
  if (iId < 0 || iDesc < 0 || iTipo < 0 || iCod < 0) throw new Error(`TSV legado sem colunas obrigatórias (Id, DescricaoNota, TipoMapeamento, Codigo); header=${header.join(',')}`);
  return lines.slice(1).map((l) => {
    const c = l.split('\t');
    return { id: c[iId]?.trim(), descricaoNota: c[iDesc] ?? '', tipo: c[iTipo]?.trim(), codigo: (c[iCod] ?? '').trim() || null, ocorrencias: iOc >= 0 ? parseInt(c[iOc], 10) || 0 : undefined };
  });
}
