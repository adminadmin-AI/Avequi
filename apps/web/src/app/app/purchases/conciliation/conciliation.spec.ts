import { describe, it, expect } from 'vitest';
import {
  SPM_RESOURCE,
  buildListParams,
  effectiveBomOnly,
  bomCoverageStats,
  pendingCount,
  unresolvedValue,
  rowHighlight,
  bomLabel,
  initialDecisionMode,
  suggestedNonProductKind,
  decisionRequest,
  describeDecision,
  decisionIsValid,
  canActOnRow,
  primaryActionLabel,
  productLabel,
  sourceLabel,
  eventLabel,
  KIND_LABEL,
  NON_PRODUCT_KINDS,
  FILTER_PRESETS,
  type PairView,
  type BomComponentCoverage,
  type CoverageSummary,
  type QueueFilters,
} from './conciliation';

// ─── fixtures sanitizadas (nenhum dado real) ─────────────────────────────────

function pair(over: Partial<PairView> = {}): PairView {
  return {
    supplierId: 'sup-1',
    supplierProductCode: '08070',
    supplierName: 'Fornecedor Exemplo',
    supplierCnpj: '12345678000199',
    documentCount: 3,
    itemCount: 4,
    totalQuantity: 120,
    totalValue: 1500.5,
    lastPurchaseAt: '2026-08-01T00:00:00.000Z',
    lastUnitPrice: 12.5,
    lastDescription: 'ARRUELA 3/8 INOX LISA',
    lastNcm: '73182200',
    lastUnit: 'UN',
    descriptionVariants: 1,
    mapId: null,
    status: 'UNRESOLVED',
    canonical: null,
    suggestion: null,
    reviewReason: null,
    notes: null,
    bomRelevance: null,
    priorityTier: 1,
    needsDecision: true,
    ...over,
  };
}

const suggestedProduct = (): PairView =>
  pair({
    status: 'SUGGESTED',
    mapId: 'map-1',
    suggestion: { productId: 'prod-1', productSku: 'COM-CHA-004', productName: 'Arruela do Francês', kind: 'PRODUCT', source: 'SEED_PRODUCAO_V2' },
    bomRelevance: { productId: 'prod-1', activeBomCount: 16, via: 'SUGGESTED' },
    priorityTier: 0,
  });

const confirmedProduct = (): PairView =>
  pair({
    status: 'CONFIRMED',
    mapId: 'map-2',
    canonical: { kind: 'PRODUCT', productId: 'prod-1', productSku: 'COM-CHA-004', productName: 'Arruela do Francês', confirmedAt: '2026-08-25T12:00:00.000Z', confirmedById: 'u1' },
    bomRelevance: { productId: 'prod-1', activeBomCount: 16, via: 'CONFIRMED' },
    priorityTier: 2,
    needsDecision: false,
  });

const filters = (over: Partial<QueueFilters> = {}): QueueFilters => ({ preset: 'ALL', bomOnly: false, supplierId: '', q: '', ...over });

// ─── parâmetros da listagem ──────────────────────────────────────────────────

describe('buildListParams', () => {
  it('padrão: só page/pageSize — nada de companyId (tenant vem do JWT)', () => {
    const p = buildListParams(filters(), 1, 25);
    expect(p).toEqual({ page: 1, pageSize: 25 });
    expect(Object.keys(p)).not.toContain('companyId');
  });

  it('preset Pendentes → pendingOnly=true; Sugeridos/Confirmados → status', () => {
    expect(buildListParams(filters({ preset: 'PENDING' }), 1, 25)).toMatchObject({ pendingOnly: true });
    expect(buildListParams(filters({ preset: 'PENDING' }), 1, 25)).not.toHaveProperty('status');
    expect(buildListParams(filters({ preset: 'SUGGESTED' }), 1, 25)).toMatchObject({ status: 'SUGGESTED' });
    expect(buildListParams(filters({ preset: 'CONFIRMED' }), 1, 25)).toMatchObject({ status: 'CONFIRMED' });
    expect(buildListParams(filters({ preset: 'ALL' }), 1, 25)).not.toHaveProperty('pendingOnly');
  });

  it('bomOnly só vai quando true (o DTO coage "false" para true)', () => {
    expect(buildListParams(filters({ bomOnly: true }), 1, 25)).toMatchObject({ bomOnly: true });
    expect(buildListParams(filters({ bomOnly: false }), 1, 25)).not.toHaveProperty('bomOnly');
  });

  it('pendentes + bomOnly = a visão inicial da company com BOM ativa', () => {
    expect(buildListParams(filters({ preset: 'PENDING', bomOnly: true }), 1, 25)).toEqual({ page: 1, pageSize: 25, pendingOnly: true, bomOnly: true });
  });

  it('fornecedor e busca (q, trim, máx. 120) entram só quando preenchidos', () => {
    expect(buildListParams(filters({ supplierId: 'sup-9', q: '  arruela ' }), 2, 50)).toEqual({ page: 2, pageSize: 50, supplierId: 'sup-9', q: 'arruela' });
    expect(buildListParams(filters({ q: '   ' }), 1, 25)).not.toHaveProperty('q');
    expect((buildListParams(filters({ q: 'x'.repeat(200) }), 1, 25).q as string).length).toBe(120);
  });

  it('pageSize respeita o teto 200 do DTO', () => {
    expect(buildListParams(filters(), 1, 999).pageSize).toBe(200);
    expect(buildListParams(filters(), 1, 0).pageSize).toBe(1);
  });

  it('presets expostos na UI cobrem Todos/Pendentes/Sugeridos/Confirmados', () => {
    expect(FILTER_PRESETS.map((p) => p.value).sort()).toEqual(['ALL', 'CONFIRMED', 'PENDING', 'SUGGESTED']);
  });
});

describe('effectiveBomOnly', () => {
  const cov: BomComponentCoverage[] = [{ productId: 'p', sku: 'S', name: 'N', type: 'COMPONENT', purchasedReason: 'BY_TYPE', activeBomCount: 2, confirmedPairs: 0, suggestedPairs: 1, covered: false }];
  it('company com BOM ativa começa ligado; sem BOM começa desligado', () => {
    expect(effectiveBomOnly(null, cov)).toBe(true);
    expect(effectiveBomOnly(null, [])).toBe(false);
    expect(effectiveBomOnly(null, undefined)).toBe(false);
  });
  it('escolha do usuário prevalece', () => {
    expect(effectiveBomOnly(false, cov)).toBe(false);
    expect(effectiveBomOnly(true, [])).toBe(true);
  });
});

// ─── resumo ──────────────────────────────────────────────────────────────────

describe('resumo', () => {
  const summary: CoverageSummary = {
    pairs: 10,
    byStatus: { UNRESOLVED: 5, SUGGESTED: 2, CONFIRMED: 2, REVIEW: 1 },
    totalValue: 1000,
    resolvedValue: 250,
    resolvedValuePct: 25,
    pairsToReachTarget: 4,
    targetPct: 80,
    pendingBomRelevant: 3,
  };
  it('pendentes = UNRESOLVED + SUGGESTED + REVIEW', () => {
    expect(pendingCount(summary)).toBe(8);
    expect(pendingCount(undefined)).toBe(0);
  });
  it('valor sem decisão = total − resolvido (nunca negativo)', () => {
    expect(unresolvedValue(summary)).toBe(750);
    expect(unresolvedValue({ ...summary, resolvedValue: 5000 })).toBe(0);
  });
  it('cobertura de BOM: confirmados / total (sugestão não cobre)', () => {
    const cov: BomComponentCoverage[] = [
      { productId: 'a', sku: 'A', name: 'A', type: 'COMPONENT', purchasedReason: 'BY_TYPE', activeBomCount: 3, confirmedPairs: 1, suggestedPairs: 0, covered: true },
      { productId: 'b', sku: 'B', name: 'B', type: 'COMPONENT', purchasedReason: 'BY_TYPE', activeBomCount: 1, confirmedPairs: 0, suggestedPairs: 2, covered: false },
      { productId: 'c', sku: 'C', name: 'C', type: 'RAW_MATERIAL', purchasedReason: 'BY_TYPE', activeBomCount: 1, confirmedPairs: 0, suggestedPairs: 0, covered: false },
    ];
    expect(bomCoverageStats(cov)).toEqual({ covered: 1, total: 3, pending: 2 });
    expect(bomCoverageStats(undefined)).toEqual({ covered: 0, total: 0, pending: 0 });
  });
});

// ─── destaque e rótulos ──────────────────────────────────────────────────────

describe('destaque da linha', () => {
  it('pendente ligado a BOM (tier 0) bloqueia BOM — acima de tudo', () => {
    expect(rowHighlight(suggestedProduct())).toBe('BLOCKS_BOM');
  });
  it('sugerido sem BOM → HAS_SUGGESTION; em revisão → REVIEW; pendente puro → UNRESOLVED; confirmado → null', () => {
    expect(rowHighlight(pair({ status: 'SUGGESTED', suggestion: { productId: 'p', productSku: 'S', productName: 'N', kind: 'PRODUCT', source: 'MANUAL' } }))).toBe('HAS_SUGGESTION');
    expect(rowHighlight(pair({ status: 'REVIEW', priorityTier: 1 }))).toBe('REVIEW');
    expect(rowHighlight(pair())).toBe('UNRESOLVED');
    expect(rowHighlight(confirmedProduct())).toBeNull();
  });
  it('bomLabel: singular/plural e nulo sem relevância', () => {
    expect(bomLabel({ productId: 'p', activeBomCount: 16, via: 'SUGGESTED' })).toBe('Usado em 16 BOMs ativas');
    expect(bomLabel({ productId: 'p', activeBomCount: 1, via: 'CONFIRMED' })).toBe('Usado em 1 BOM ativa');
    expect(bomLabel(null)).toBeNull();
    expect(bomLabel({ productId: 'p', activeBomCount: 0, via: 'CONFIRMED' })).toBeNull();
  });
  it('rótulos amigáveis preservam os enums da API', () => {
    expect(NON_PRODUCT_KINDS).toEqual(['CONSUMABLE', 'ASSET', 'FREIGHT_OTHER']);
    expect(KIND_LABEL.CONSUMABLE).toBe('Consumo / insumo');
    expect(KIND_LABEL.ASSET).toBe('Ativo / imobilizado');
    expect(KIND_LABEL.FREIGHT_OTHER).toBe('Frete / outro');
    expect(sourceLabel('SEED_PRODUCAO_V2')).toMatch(/legado/);
    expect(sourceLabel('DESCONHECIDA')).toBe('DESCONHECIDA');
    expect(sourceLabel(null)).toBeNull();
    expect(eventLabel('REVIEW_FLAGGED')).toBe('Marcado para revisão');
    expect(productLabel('SKU', 'Nome')).toBe('SKU · Nome');
    expect(productLabel(null, null)).toBe('—');
  });
});

// ─── decisão humana ──────────────────────────────────────────────────────────

describe('decisão', () => {
  it('sugestão de Product abre em "confirmar sugestão"; sem sugestão abre em "escolher"', () => {
    expect(initialDecisionMode(suggestedProduct())).toBe('SUGGESTION');
    expect(initialDecisionMode(pair())).toBe('PRODUCT');
  });
  it('sugestão de tipo (ex.: CONSUMABLE do seed) abre em "não é produto" com o tipo pré-selecionado', () => {
    const r = pair({ status: 'SUGGESTED', suggestion: { productId: null, productSku: null, productName: null, kind: 'CONSUMABLE', source: 'SEED_PRODUCAO_V2' } });
    expect(initialDecisionMode(r)).toBe('KIND');
    expect(suggestedNonProductKind(r)).toBe('CONSUMABLE');
    expect(suggestedNonProductKind(suggestedProduct())).toBeNull();
  });

  it('confirmar sugestão → POST confirm-product com o productId sugerido (nunca automático: precisa do ato)', () => {
    const r = suggestedProduct();
    const req = decisionRequest(r, { mode: 'SUGGESTION', productId: r.suggestion!.productId!, productLabel: 'COM-CHA-004 · Arruela do Francês' });
    expect(req.path).toBe(`${SPM_RESOURCE}/pairs/sup-1/08070/confirm-product`);
    expect(req.body).toEqual({ productId: 'prod-1' });
  });

  it('escolher outro Product → confirm-product com o Product escolhido (sugestão ≠ confirmado)', () => {
    const r = suggestedProduct();
    const req = decisionRequest(r, { mode: 'PRODUCT', productId: 'prod-77', productLabel: 'X', reason: '  conferido  ' });
    expect(req.body).toEqual({ productId: 'prod-77', reason: 'conferido' });
    expect(req.body.productId).not.toBe(r.suggestion!.productId);
  });

  it('classificar CONSUMABLE/ASSET/FREIGHT_OTHER → POST classify com o enum', () => {
    for (const kind of NON_PRODUCT_KINDS) {
      const req = decisionRequest(pair(), { mode: 'KIND', kind });
      expect(req.path).toBe(`${SPM_RESOURCE}/pairs/sup-1/08070/classify`);
      expect(req.body).toEqual({ kind });
    }
  });

  it('item sem sugestão continua resolvível (Product ou classificação)', () => {
    const r = pair();
    expect(decisionIsValid({ mode: 'PRODUCT', productId: 'prod-1', productLabel: 'x' })).toBe(true);
    expect(decisionIsValid({ mode: 'KIND', kind: 'ASSET' })).toBe(true);
    expect(decisionRequest(r, { mode: 'KIND', kind: 'ASSET' }).body).toEqual({ kind: 'ASSET' });
  });

  it('decisão inválida: sem Product escolhido / tipo fora do enum / nula', () => {
    expect(decisionIsValid(null)).toBe(false);
    expect(decisionIsValid({ mode: 'PRODUCT', productId: '  ', productLabel: '' })).toBe(false);
    expect(decisionIsValid({ mode: 'KIND', kind: 'PRODUCT' as never })).toBe(false);
  });

  it('cProd com caracteres especiais é URL-encoded na identidade (zeros à esquerda preservados)', () => {
    const req = decisionRequest(pair({ supplierProductCode: '00 12/A' }), { mode: 'KIND', kind: 'ASSET' });
    expect(req.path).toBe(`${SPM_RESOURCE}/pairs/sup-1/00%2012%2FA/classify`);
  });

  it('"o que será gravado" descreve Product, classificação e troca de decisão', () => {
    const s = describeDecision(suggestedProduct(), { mode: 'SUGGESTION', productId: 'prod-1', productLabel: 'COM-CHA-004 · Arruela do Francês' });
    expect(s).toContain('Fornecedor Exemplo · cProd 08070');
    expect(s).toContain('COM-CHA-004');
    expect(s).toContain('confirmando a sugestão');
    expect(describeDecision(pair(), { mode: 'KIND', kind: 'FREIGHT_OTHER' })).toContain('Frete / outro');
    expect(describeDecision(confirmedProduct(), { mode: 'PRODUCT', productId: 'p2', productLabel: 'OUTRO' })).toContain('substitui a decisão atual');
  });
});

// ─── permissões (UX; backend revalida) ──────────────────────────────────────

describe('ações por permissão', () => {
  it('view-only: nenhuma ação ativa, em qualquer status', () => {
    for (const r of [pair(), suggestedProduct(), confirmedProduct()]) {
      expect(canActOnRow(false, r)).toEqual({ resolve: false, dismiss: false, review: false });
    }
  });
  it('resolve: resolver sempre; descartar só SUGGESTED; revisão só CONFIRMED', () => {
    expect(canActOnRow(true, pair())).toEqual({ resolve: true, dismiss: false, review: false });
    expect(canActOnRow(true, suggestedProduct())).toEqual({ resolve: true, dismiss: true, review: false });
    expect(canActOnRow(true, confirmedProduct())).toEqual({ resolve: true, dismiss: false, review: true });
  });
  it('rótulo do botão principal', () => {
    expect(primaryActionLabel(suggestedProduct())).toBe('Confirmar');
    expect(primaryActionLabel(pair())).toBe('Resolver');
    expect(primaryActionLabel(confirmedProduct())).toBe('Trocar');
  });
});
