import {
  FiscalItemRow,
  PairView,
  aggregatePairs,
  bomCoverage,
  buildPairViews,
  comparePriority,
  normalizeSupplierProductCode,
  suggestByDescription,
  summarize,
} from './supplier-product-map.aggregate';

const row = (o: Partial<FiscalItemRow>): FiscalItemRow => ({
  documentId: 'd1', documentStatus: 'AUTHORIZED', supplierId: 'sup-A', issueDate: new Date('2026-06-01'),
  productCode: 'X1', productName: 'PARAFUSO SEXTAVADO M8', ncm: '73181500', unit: 'UN', quantity: 10, unitPrice: 2, totalPrice: 20,
  ...o,
});

describe('identidade — normalizeSupplierProductCode', () => {
  it('só trim: preserva zeros à esquerda, caixa e espaços internos', () => {
    expect(normalizeSupplierProductCode(' 0012 ')).toBe('0012');
    expect(normalizeSupplierProductCode('0012')).not.toBe(normalizeSupplierProductCode('12'));
    expect(normalizeSupplierProductCode('ab 1')).toBe('ab 1');
    expect(normalizeSupplierProductCode('')).toBeNull();
    expect(normalizeSupplierProductCode('   ')).toBeNull();
    expect(normalizeSupplierProductCode(null)).toBeNull();
  });
});

describe('aggregatePairs — métricas por (supplierId, cProd)', () => {
  it('mesmo cProd em fornecedores diferentes = pares diferentes', () => {
    const pairs = aggregatePairs([row({ supplierId: 'sup-A' }), row({ supplierId: 'sup-B', documentId: 'd2' })]);
    expect(pairs).toHaveLength(2);
    expect(pairs.map((p) => p.supplierId).sort()).toEqual(['sup-A', 'sup-B']);
  });

  it('zeros à esquerda distinguem pares; trim não', () => {
    const pairs = aggregatePairs([row({ productCode: '0012' }), row({ productCode: '12', documentId: 'd2' }), row({ productCode: ' 0012 ', documentId: 'd3' })]);
    expect(pairs).toHaveLength(2);
    expect(pairs.find((p) => p.supplierProductCode === '0012')!.documentCount).toBe(2);
    expect(pairs.find((p) => p.supplierProductCode === '12')!.documentCount).toBe(1);
  });

  it('documento CANCELADO/REJEITADO não contamina valor, recorrência nem "última compra"', () => {
    const pairs = aggregatePairs([
      row({ documentId: 'd1', totalPrice: 100, issueDate: new Date('2026-01-01'), unitPrice: 10 }),
      row({ documentId: 'd2', documentStatus: 'CANCELLED', totalPrice: 9999, issueDate: new Date('2026-08-01'), unitPrice: 999, productName: 'OUTRA DESCRICAO' }),
      row({ documentId: 'd3', documentStatus: 'REJECTED', totalPrice: 5000 }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ documentCount: 1, itemCount: 1, totalValue: 100, lastUnitPrice: 10, descriptionVariants: 1 });
    expect(pairs[0].lastPurchaseAt).toEqual(new Date('2026-01-01'));
  });

  it('itens sem fornecedor ou sem cProd ficam de fora (sem identidade possível)', () => {
    expect(aggregatePairs([row({ supplierId: null }), row({ productCode: null }), row({ productCode: '  ' })])).toHaveLength(0);
  });

  it('agrega: documentos distintos, linhas, quantidade, valor; "último" pela data de emissão; variantes de descrição', () => {
    const pairs = aggregatePairs([
      row({ documentId: 'd1', issueDate: new Date('2026-03-01'), quantity: 5, totalPrice: 50, unitPrice: 10, productName: 'PARAFUSO M8' }),
      row({ documentId: 'd1', issueDate: new Date('2026-03-01'), quantity: 1, totalPrice: 10, unitPrice: 10, productName: 'PARAFUSO M8' }),
      row({ documentId: 'd2', issueDate: new Date('2026-07-15'), quantity: 2, totalPrice: 26, unitPrice: 13, productName: 'PARAFUSO SEXT M8 ZINC', ncm: '73181500', unit: 'PC' }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ documentCount: 2, itemCount: 3, totalQuantity: 8, totalValue: 86, lastUnitPrice: 13, lastDescription: 'PARAFUSO SEXT M8 ZINC', lastUnit: 'PC', descriptionVariants: 2 });
  });
});

describe('buildPairViews — canônico × sugestão × BOM × prioridade', () => {
  const suppliers = new Map([['sup-A', { name: 'Fornecedor A', cnpj: '11111111000191' }], ['sup-B', { name: 'Fornecedor B', cnpj: null }]]);
  const products = new Map([
    ['p-bom', { id: 'p-bom', sku: 'COM-001', name: 'PARAFUSO M8', type: 'COMPONENT', isActive: true }],
    ['p-x', { id: 'p-x', sku: 'COM-002', name: 'OUTRO', type: 'COMPONENT', isActive: true }],
  ]);
  const bom = new Map([['p-bom', 3]]);
  const base = (o: Partial<PairView>): PairView => ({
    supplierId: 'sup-A', supplierProductCode: 'X', documentCount: 1, itemCount: 1, totalQuantity: 1, totalValue: 10, lastPurchaseAt: null, lastUnitPrice: 10,
    lastDescription: 'd', lastNcm: null, lastUnit: null, descriptionVariants: 1, supplierName: 'A', supplierCnpj: null, mapId: null, status: 'UNRESOLVED',
    canonical: null, suggestion: null, reviewReason: null, notes: null, bomRelevance: null, priorityTier: 1, needsDecision: true, ...o,
  });

  it('par sem mapa = UNRESOLVED sem canônico; sugestão fica separada da verdade', () => {
    const views = buildPairViews({
      metrics: aggregatePairs([row({ productCode: 'X1' }), row({ productCode: 'X2', documentId: 'd2' })]),
      maps: [{ id: 'm2', supplierId: 'sup-A', supplierProductCode: 'X2', status: 'SUGGESTED', kind: null, productId: null, suggestedProductId: 'p-x', suggestedKind: 'PRODUCT', suggestionSource: 'DESCRIPTION', confirmedAt: null, confirmedById: null, reviewReason: null, notes: null, lastSeenDescription: null }],
      suppliers, products, activeBomCountByProduct: bom,
    });
    const x1 = views.find((v) => v.supplierProductCode === 'X1')!;
    const x2 = views.find((v) => v.supplierProductCode === 'X2')!;
    expect(x1).toMatchObject({ status: 'UNRESOLVED', canonical: null, suggestion: null, needsDecision: true, mapId: null, supplierName: 'Fornecedor A' });
    expect(x2).toMatchObject({ status: 'SUGGESTED', canonical: null, needsDecision: true });
    expect(x2.suggestion).toMatchObject({ productId: 'p-x', productSku: 'COM-002', source: 'DESCRIPTION' });
  });

  it('par confirmado aparece com canônico preenchido, resolvido, tier 2 — e BOM via CONFIRMED', () => {
    const views = buildPairViews({
      metrics: aggregatePairs([row({ productCode: 'X1' })]),
      maps: [{ id: 'm1', supplierId: 'sup-A', supplierProductCode: 'X1', status: 'CONFIRMED', kind: 'PRODUCT', productId: 'p-bom', suggestedProductId: null, suggestedKind: null, suggestionSource: null, confirmedAt: new Date(), confirmedById: 'u1', reviewReason: null, notes: null, lastSeenDescription: null }],
      suppliers, products, activeBomCountByProduct: bom,
    });
    expect(views[0]).toMatchObject({ status: 'CONFIRMED', needsDecision: false, priorityTier: 2 });
    expect(views[0].canonical).toMatchObject({ kind: 'PRODUCT', productId: 'p-bom', productSku: 'COM-001' });
    expect(views[0].bomRelevance).toEqual({ productId: 'p-bom', activeBomCount: 3, via: 'CONFIRMED' });
  });

  it('REVIEW mantém o canônico anterior mas volta a precisar de decisão', () => {
    const views = buildPairViews({
      metrics: aggregatePairs([row({ productCode: 'X1' })]),
      maps: [{ id: 'm1', supplierId: 'sup-A', supplierProductCode: 'X1', status: 'REVIEW', kind: 'PRODUCT', productId: 'p-x', suggestedProductId: null, suggestedKind: null, suggestionSource: null, confirmedAt: new Date(), confirmedById: 'u1', reviewReason: 'descrição divergente', notes: null, lastSeenDescription: null }],
      suppliers, products, activeBomCountByProduct: bom,
    });
    expect(views[0]).toMatchObject({ status: 'REVIEW', needsDecision: true, priorityTier: 1, reviewReason: 'descrição divergente' });
    expect(views[0].canonical?.productId).toBe('p-x');
  });

  it('mapa existente sem item fiscal autorizado ainda aparece (métricas zeradas)', () => {
    const views = buildPairViews({
      metrics: [],
      maps: [{ id: 'm9', supplierId: 'sup-B', supplierProductCode: 'ZZ', status: 'UNRESOLVED', kind: null, productId: null, suggestedProductId: null, suggestedKind: null, suggestionSource: null, confirmedAt: null, confirmedById: null, reviewReason: null, notes: null, lastSeenDescription: 'algo' }],
      suppliers, products, activeBomCountByProduct: bom,
    });
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ supplierId: 'sup-B', totalValue: 0, documentCount: 0, lastDescription: 'algo', mapId: 'm9' });
  });

  it('prioridade: pendente ligado a BOM ativa (mesmo por SUGESTÃO) > pendente de maior valor > recorrência; resolvidos no fim', () => {
    const views: PairView[] = [
      base({ supplierProductCode: 'capex', totalValue: 1_000_000, documentCount: 1 }),
      base({ supplierProductCode: 'bom-sug', totalValue: 5_000, documentCount: 2, suggestion: { productId: 'p-bom', productSku: 'COM-001', productName: 'x', kind: 'PRODUCT', source: 'DESCRIPTION' }, bomRelevance: { productId: 'p-bom', activeBomCount: 3, via: 'SUGGESTED' }, priorityTier: 0, status: 'SUGGESTED' }),
      base({ supplierProductCode: 'confirmado', totalValue: 9_000_000, documentCount: 50, status: 'CONFIRMED', needsDecision: false, priorityTier: 2 }),
      base({ supplierProductCode: 'recorrente', totalValue: 1_000, documentCount: 40 }),
      base({ supplierProductCode: 'mesmo-valor-menos-rec', totalValue: 1_000, documentCount: 3 }),
    ];
    const ordered = [...views].sort(comparePriority).map((v) => v.supplierProductCode);
    expect(ordered).toEqual(['bom-sug', 'capex', 'recorrente', 'mesmo-valor-menos-rec', 'confirmado']);
  });
});

describe('summarize / bomCoverage', () => {
  const v = (code: string, value: number, status: 'UNRESOLVED' | 'CONFIRMED' = 'UNRESOLVED', extra: Partial<PairView> = {}): PairView => ({
    supplierId: 's', supplierProductCode: code, documentCount: 1, itemCount: 1, totalQuantity: 1, totalValue: value, lastPurchaseAt: null, lastUnitPrice: null,
    lastDescription: null, lastNcm: null, lastUnit: null, descriptionVariants: 1, supplierName: null, supplierCnpj: null, mapId: null, status,
    canonical: status === 'CONFIRMED' ? { kind: 'PRODUCT', productId: 'p1', productSku: 'P1', productName: 'p', confirmedAt: new Date(), confirmedById: 'u' } : null,
    suggestion: null, reviewReason: null, notes: null, bomRelevance: null, priorityTier: status === 'CONFIRMED' ? 2 : 1, needsDecision: status !== 'CONFIRMED', ...extra,
  });

  it('quantos pares (por valor) faltam para ~80% do valor; contagem por status; pendentes BOM', () => {
    const views = [v('a', 500, 'CONFIRMED'), v('b', 300), v('c', 150), v('d', 40), v('e', 10, 'UNRESOLVED', { priorityTier: 0, bomRelevance: { productId: 'p9', activeBomCount: 1, via: 'SUGGESTED' } })];
    const s = summarize(views, 0.8);
    // total 1000; resolvido 500 (50%); meta 800 → +b (800) = 1 par
    expect(s).toMatchObject({ pairs: 5, totalValue: 1000, resolvedValue: 500, resolvedValuePct: 50, pairsToReachTarget: 1, pendingBomRelevant: 1 });
    expect(s.byStatus).toEqual({ UNRESOLVED: 4, SUGGESTED: 0, CONFIRMED: 1, REVIEW: 0 });
    expect(summarize([v('a', 100, 'CONFIRMED')], 0.8).pairsToReachTarget).toBe(0);
  });

  it('bomCoverage: componente comprado sem par CONFIRMED = descoberto (impede custo); sugestão não cobre', () => {
    const comps = [
      { id: 'p1', sku: 'COM-1', name: 'A', type: 'COMPONENT', isActive: true, activeBomCount: 5 },
      { id: 'p2', sku: 'COM-2', name: 'B', type: 'RAW_MATERIAL', isActive: true, activeBomCount: 2 },
      { id: 'p3', sku: 'COM-3', name: 'C', type: 'COMPONENT', isActive: true, activeBomCount: 9 },
    ];
    const views = [
      v('a', 100, 'CONFIRMED'), // canônico p1
      v('b', 50, 'UNRESOLVED', { status: 'SUGGESTED', suggestion: { productId: 'p2', productSku: 'COM-2', productName: 'B', kind: 'PRODUCT', source: 'DESCRIPTION' } }),
    ];
    const cov = bomCoverage(comps, views);
    expect(cov.map((c) => [c.sku, c.covered, c.confirmedPairs, c.suggestedPairs])).toEqual([
      ['COM-3', false, 0, 0], // descoberto, mais BOMs primeiro
      ['COM-2', false, 0, 1], // só sugestão — ainda descoberto
      ['COM-1', true, 1, 0],
    ]);
  });
});

describe('suggestByDescription — barata, sem NCM, nunca confirma', () => {
  const products = [
    { id: 'p1', sku: 'COM-001', name: 'PARAFUSO SEXTAVADO M8 X 30 ZINCADO', type: 'COMPONENT', isActive: true },
    { id: 'p2', sku: 'COM-002', name: 'PORCA SEXTAVADA M8 ZINCADA', type: 'COMPONENT', isActive: true },
    { id: 'p3', sku: 'COM-003', name: 'ARRUELA LISA M8', type: 'COMPONENT', isActive: true },
    { id: 'p4', sku: 'COM-004', name: 'PARAFUSO SEXTAVADO M8 X 30 ZINCADO', type: 'COMPONENT', isActive: false },
  ];
  it('descrição claramente igual a um Product ativo → candidato com score e racional', () => {
    const c = suggestByDescription('PARAFUSO SEXT. M8 X 30 ZINCADO', products);
    expect(c).toMatchObject({ productId: 'p1', sku: 'COM-001' });
    expect(c!.score).toBeGreaterThanOrEqual(0.5);
    expect(c!.rationale).toContain('DESCRIPTION jaccard=');
  });
  it('ambiguidade (dois candidatos próximos) não vira sugestão', () => {
    const near = [
      { id: 'a', sku: 'A', name: 'CHAPA ACO 3MM', type: 'RAW_MATERIAL', isActive: true },
      { id: 'b', sku: 'B', name: 'CHAPA ACO 4MM', type: 'RAW_MATERIAL', isActive: true },
    ];
    expect(suggestByDescription('CHAPA ACO', near)).toBeNull();
  });
  it('descrição sem afinidade, vazia ou só de Product inativo → null', () => {
    expect(suggestByDescription('OLEO LUBRIFICANTE 20L', products)).toBeNull();
    expect(suggestByDescription(null, products)).toBeNull();
    expect(suggestByDescription('QUALQUER', [products[3]])).toBeNull();
  });
});
