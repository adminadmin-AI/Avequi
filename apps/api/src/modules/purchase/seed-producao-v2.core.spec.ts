import {
  ExistingMapState,
  LegacyRow,
  TenantProduct,
  indexLegacy,
  indexProducts,
  nominalEvidence,
  parseLegacyTsv,
  planSeed,
  summarizeSeed,
} from './seed-producao-v2.core';
import { PairMetrics } from './supplier-product-map.aggregate';

const legacy: LegacyRow[] = [
  { id: '1', descricaoNota: 'PORCA 10MM AUTO-TRAVANTE MA Diversos Ref.:11025801', tipo: 'Comprado', codigo: 'COM-GER-002' },
  { id: '2', descricaoNota: 'DILUENTE UNIVERSAL 18L LL', tipo: 'Insumo', codigo: null },
  { id: '3', descricaoNota: 'LUVA PVC VERDE', tipo: 'EPI', codigo: null },
  { id: '4', descricaoNota: 'CHAPA 2,00 MM', tipo: 'MP', codigo: 'MP-CHP-004' },
  { id: '5', descricaoNota: 'PECA VELHA', tipo: 'Comprado', codigo: 'COM-OLD-999' }, // inativo
  { id: '6', descricaoNota: 'PECA SUMIDA', tipo: 'Comprado', codigo: 'COM-NAO-EXISTE' },
  { id: '7', descricaoNota: 'CUBO DE RODA TRASEIRO', tipo: 'Comprado', codigo: 'COM-EIX-001' },
  { id: '8', descricaoNota: 'CUBO DE RODA TRASEIRO', tipo: 'Comprado', codigo: 'COM-EIX-001' }, // duplicata idêntica
  { id: '9', descricaoNota: 'ITEM DUPLO', tipo: 'Comprado', codigo: 'COM-GER-002' },
  { id: '10', descricaoNota: 'ITEM DUPLO', tipo: 'Comprado', codigo: 'MP-CHP-004' }, // conflito real
  { id: '11', descricaoNota: 'ITEM MISTO', tipo: 'Comprado', codigo: 'COM-GER-002' },
  { id: '12', descricaoNota: 'ITEM MISTO', tipo: 'Insumo', codigo: null },
];
const products: TenantProduct[] = [
  { id: 'p-porca', companyId: 'gdr', sku: 'COM-GER-002', name: 'Porca M12 Trav.', isActive: true },
  { id: 'p-chapa', companyId: 'gdr', sku: 'MP-CHP-004', name: 'Chapa 2,0mm', isActive: true },
  { id: 'p-old', companyId: 'gdr', sku: 'COM-OLD-999', name: 'Peça velha', isActive: false },
  { id: 'p-cubo', companyId: 'gdr', sku: 'COM-EIX-001', name: 'Cubo 4x100', isActive: true },
];
const pair = (o: Partial<PairMetrics> & { descriptions: string[]; supplierId?: string; supplierProductCode?: string }): PairMetrics & { descriptions: string[] } => ({
  supplierId: 'sup-A', supplierProductCode: 'X1', documentCount: 2, itemCount: 2, totalQuantity: 1, totalValue: 100, lastPurchaseAt: null, lastUnitPrice: 10,
  lastDescription: o.descriptions[0] ?? null, lastNcm: null, lastUnit: null, descriptionVariants: o.descriptions.length, ...o,
});
const input = (companyId: string, pairs: Array<PairMetrics & { descriptions: string[] }>, existing: Array<[string, ExistingMapState]> = []) => ({
  companyId, pairs, legacy: indexLegacy(legacy), products: indexProducts(products), existing: new Map(existing),
});

describe('seed producao_v2 — plano puro (nunca confirma)', () => {
  it('Comprado/MP com código → Product ativo do mesmo tenant, único ⇒ WOULD_SUGGEST_PRODUCT (só sugestão)', () => {
    const [p] = planSeed(input('gdr', [pair({ descriptions: ['porca 10mm auto-travante ma diversos ref.:11025801'] })]));
    expect(p).toMatchObject({ outcome: 'WOULD_SUGGEST_PRODUCT', suggestedProductId: 'p-porca', suggestedSku: 'COM-GER-002', legacyIds: ['1'] });
    expect(p.rationale).toContain('SEED_PRODUCAO_V2');
    expect((p as unknown as { productId?: string }).productId).toBeUndefined(); // nada canônico
    const [mp] = planSeed(input('gdr', [pair({ descriptions: ['CHAPA 2,00 MM'] })]));
    expect(mp).toMatchObject({ outcome: 'WOULD_SUGGEST_PRODUCT', suggestedSku: 'MP-CHP-004' });
  });

  it('Insumo/EPI ⇒ WOULD_SUGGEST_KIND CONSUMABLE (sugestão de kind, não classificação canônica)', () => {
    const plan = planSeed(input('gdr', [pair({ descriptions: ['DILUENTE UNIVERSAL 18L LL'] }), pair({ supplierProductCode: 'X2', descriptions: ['LUVA PVC VERDE'] })]));
    expect(plan.map((p) => [p.outcome, p.suggestedKind])).toEqual([['WOULD_SUGGEST_KIND', 'CONSUMABLE'], ['WOULD_SUGGEST_KIND', 'CONSUMABLE']]);
    expect(plan.every((p) => p.suggestedProductId === undefined)).toBe(true);
  });

  it('mesmo texto em fornecedores diferentes ⇒ uma sugestão POR PAR (o legado não conhece fornecedor)', () => {
    const plan = planSeed(input('gdr', [
      pair({ supplierId: 'sup-A', supplierProductCode: '100', descriptions: ['CUBO DE RODA TRASEIRO'] }),
      pair({ supplierId: 'sup-B', supplierProductCode: 'CB-1', descriptions: ['CUBO DE RODA TRASEIRO'] }),
    ]));
    expect(plan.map((p) => [p.supplierId, p.outcome, p.suggestedSku])).toEqual([['sup-A', 'WOULD_SUGGEST_PRODUCT', 'COM-EIX-001'], ['sup-B', 'WOULD_SUGGEST_PRODUCT', 'COM-EIX-001']]);
    expect(plan[0].legacyIds).toEqual(['7', '8']); // duplicata idêntica do legado não vira conflito
  });

  it('tenant diferente: código existe só na GDR ⇒ SKIPPED_TENANT para a CRD; nunca cross-tenant', () => {
    const [p] = planSeed(input('crd', [pair({ descriptions: ['CUBO DE RODA TRASEIRO'] })]));
    expect(p).toMatchObject({ outcome: 'SKIPPED_TENANT' });
    expect(p.reason).toContain('COM-EIX-001');
    // Insumo/EPI é só kind: vale em qualquer tenant
    const [k] = planSeed(input('crd', [pair({ descriptions: ['DILUENTE UNIVERSAL 18L LL'] })]));
    expect(k.outcome).toBe('WOULD_SUGGEST_KIND');
  });

  it('Product inativo ⇒ SKIPPED_INACTIVE_PRODUCT; código inexistente ⇒ INVALID; sem match ⇒ NO_MATCH', () => {
    const plan = planSeed(input('gdr', [
      pair({ supplierProductCode: 'A', descriptions: ['PECA VELHA'] }),
      pair({ supplierProductCode: 'B', descriptions: ['PECA SUMIDA'] }),
      pair({ supplierProductCode: 'C', descriptions: ['NADA A VER'] }),
    ]));
    expect(plan.map((p) => p.outcome)).toEqual(['SKIPPED_INACTIVE_PRODUCT', 'INVALID', 'NO_MATCH']);
  });

  it('descrição com duas interpretações incompatíveis (2 Products, ou Product + kind) ⇒ AMBIGUOUS', () => {
    const plan = planSeed(input('gdr', [
      pair({ supplierProductCode: 'A', descriptions: ['ITEM DUPLO'] }),
      pair({ supplierProductCode: 'B', descriptions: ['ITEM MISTO'] }),
      pair({ supplierProductCode: 'C', descriptions: ['CHAPA 2,00 MM', 'DILUENTE UNIVERSAL 18L LL'] }), // duas descrições do mesmo par
    ]));
    expect(plan.map((p) => p.outcome)).toEqual(['AMBIGUOUS', 'AMBIGUOUS', 'AMBIGUOUS']);
  });

  it('zeros à esquerda em cProd preservados na identidade do plano', () => {
    const plan = planSeed(input('gdr', [pair({ supplierProductCode: ' 0012 ', descriptions: ['CHAPA 2,00 MM'] })]));
    expect(plan[0].supplierProductCode).toBe('0012');
  });

  it('precedência: decisão humana (CONFIRMED/REVIEW) nunca é rebaixada ⇒ CONFLICT_EXISTING_DECISION', () => {
    const confirmed: ExistingMapState = { status: 'CONFIRMED', kind: 'PRODUCT', productId: 'p-chapa', suggestedProductId: null, suggestedKind: null, suggestionSource: null };
    const review: ExistingMapState = { ...confirmed, status: 'REVIEW' };
    const plan = planSeed(input('gdr', [
      pair({ supplierProductCode: 'A', descriptions: ['porca 10mm auto-travante ma diversos ref.:11025801'] }),
      pair({ supplierProductCode: 'B', descriptions: ['DILUENTE UNIVERSAL 18L LL'] }),
    ], [['sup-A A', confirmed], ['sup-A B', review]]));
    expect(plan.map((p) => p.outcome)).toEqual(['CONFLICT_EXISTING_DECISION', 'CONFLICT_EXISTING_DECISION']);
  });

  it('idempotência: mesma sugestão já registrada ⇒ UNCHANGED; sugestão diferente ⇒ CONFLICT_EXISTING_SUGGESTION (nunca sobrescreve)', () => {
    const sameProduct: ExistingMapState = { status: 'SUGGESTED', kind: null, productId: null, suggestedProductId: 'p-porca', suggestedKind: 'PRODUCT', suggestionSource: 'SEED_PRODUCAO_V2' };
    const otherProduct: ExistingMapState = { ...sameProduct, suggestedProductId: 'p-chapa', suggestionSource: 'DESCRIPTION' };
    const sameKind: ExistingMapState = { status: 'SUGGESTED', kind: null, productId: null, suggestedProductId: null, suggestedKind: 'CONSUMABLE', suggestionSource: 'MANUAL' };
    const plan = planSeed(input('gdr', [
      pair({ supplierProductCode: 'A', descriptions: ['porca 10mm auto-travante ma diversos ref.:11025801'] }),
      pair({ supplierProductCode: 'B', descriptions: ['porca 10mm auto-travante ma diversos ref.:11025801'] }),
      pair({ supplierProductCode: 'C', descriptions: ['DILUENTE UNIVERSAL 18L LL'] }),
    ], [['sup-A A', sameProduct], ['sup-A B', otherProduct], ['sup-A C', sameKind]]));
    expect(plan.map((p) => p.outcome)).toEqual(['UNCHANGED', 'CONFLICT_EXISTING_SUGGESTION', 'UNCHANGED']);
  });

  it('resumo: suggestionCoverage ≠ confirmedCoverage; confirmada só conta mapa CONFIRMED', () => {
    const plan = planSeed(input('gdr', [
      pair({ supplierProductCode: 'A', descriptions: ['CHAPA 2,00 MM'], totalValue: 1000 }),
      pair({ supplierProductCode: 'B', descriptions: ['DILUENTE UNIVERSAL 18L LL'], totalValue: 50 }),
      pair({ supplierProductCode: 'C', descriptions: ['NADA'], totalValue: 5 }),
    ]));
    const comps = [{ id: 'p-chapa', sku: 'MP-CHP-004' }, { id: 'p-cubo', sku: 'COM-EIX-001' }];
    const s = summarizeSeed(plan, comps, new Set());
    expect(s.byOutcome.WOULD_SUGGEST_PRODUCT).toEqual({ pairs: 1, value: 1000 });
    expect(s.byOutcome.WOULD_SUGGEST_KIND).toEqual({ pairs: 1, value: 50 });
    expect(s.suggestionCoverage).toEqual({ components: 1, of: 2, skus: ['MP-CHP-004'] });
    expect(s.confirmedCoverage).toEqual({ components: 0, of: 2 });
    expect(s.note).toContain('SUGGESTED ≠ RESOLVED');
    expect(summarizeSeed(plan, comps, new Set(['p-cubo'])).confirmedCoverage).toEqual({ components: 1, of: 2 });
  });

  it('evidência nominal ordenada e estável (gate do --commit)', () => {
    const plan = planSeed(input('gdr', [
      pair({ supplierProductCode: 'B', descriptions: ['CHAPA 2,00 MM'] }),
      pair({ supplierProductCode: 'A', descriptions: ['DILUENTE UNIVERSAL 18L LL'] }),
    ]));
    expect(nominalEvidence(plan)).toEqual({ product: ['gdr|sup-A|B|p-chapa'], kind: ['gdr|sup-A|A|CONSUMABLE'], excluded: [] });
  });

  describe('exclusão nominal de linha legada (caso PROIND 07849 → Id 225)', () => {
    // legado real: Id 202 "ARRUELA 3/8 INOX LISA" e Id 225 "ARRUELA 1/4 LISA" apontam ambos para COM-CHA-004
    const legacyArruela: LegacyRow[] = [
      { id: '202', descricaoNota: 'ARRUELA 3/8 INOX LISA Diversos', tipo: 'Comprado', codigo: 'COM-CHA-004' },
      { id: '225', descricaoNota: 'ARRUELA 1/4 LISA Diversos Ref.:1141c.1', tipo: 'Comprado', codigo: 'COM-CHA-004' },
    ];
    const prods: TenantProduct[] = [{ id: 'p-arruela', companyId: 'gdr', sku: 'COM-CHA-004', name: 'Arruela do Frances', isActive: true }];
    const exclusions = new Map([['225', 'ARRUELA 1/4 LISA não corresponde à Arruela do Francês 3/8; exclusão confirmada após auditoria física em 25/08/2026']]);
    const pairs = () => [
      pair({ supplierId: 'proind-1', supplierProductCode: '08070', descriptions: ['ARRUELA 3/8 INOX LISA Diversos'], totalValue: 59.87 }),
      pair({ supplierId: 'proind-2', supplierProductCode: '08070', descriptions: ['ARRUELA 3/8 INOX LISA Diversos'], totalValue: 6.26 }),
      pair({ supplierId: 'proind-1', supplierProductCode: '07849', descriptions: ['ARRUELA 1/4 LISA Diversos Ref.:1141c.1'], totalValue: 268 }),
    ];
    const run = (ex?: Map<string, string>) => planSeed({ companyId: 'gdr', pairs: pairs(), legacy: indexLegacy(legacyArruela), products: indexProducts(prods), existing: new Map(), exclusions: ex });

    it('sem exclusão o legado sugeriria os 3 pares (inclusive 07849) — é o que a exclusão precisa evitar', () => {
      expect(run().map((p) => [p.supplierProductCode, p.outcome])).toEqual([['08070', 'WOULD_SUGGEST_PRODUCT'], ['08070', 'WOULD_SUGGEST_PRODUCT'], ['07849', 'WOULD_SUGGEST_PRODUCT']]);
    });

    it('legacyId 225 excluído: 07849 vira SKIPPED_MANUAL_EXCLUSION (não INVALID), sem suggestedProductId; ambos 08070 seguem sugerindo COM-CHA-004', () => {
      const plan = run(exclusions);
      const by = Object.fromEntries(plan.map((p) => [`${p.supplierId} ${p.supplierProductCode}`, p]));
      expect(by['proind-1 08070']).toMatchObject({ outcome: 'WOULD_SUGGEST_PRODUCT', suggestedSku: 'COM-CHA-004', legacyIds: ['202'] });
      expect(by['proind-2 08070']).toMatchObject({ outcome: 'WOULD_SUGGEST_PRODUCT', suggestedSku: 'COM-CHA-004' });
      expect(by['proind-1 07849']).toMatchObject({ outcome: 'SKIPPED_MANUAL_EXCLUSION', legacyIds: ['225'] });
      expect(by['proind-1 07849'].suggestedProductId).toBeUndefined();
      expect(by['proind-1 07849'].suggestedKind).toBeUndefined();
      expect(by['proind-1 07849'].reason).toContain('Id 225');
      expect(by['proind-1 07849'].reason).toContain('auditoria física');
      // seed continua nunca confirmando: nada canônico em lugar nenhum
      expect(plan.every((p) => !('productId' in p) && !('kind' in p))).toBe(true);
    });

    it('exclusão não afeta a cobertura de BOM (08070 ainda cobre COM-CHA-004) nem confirmedCoverage', () => {
      const s = summarizeSeed(run(exclusions), [{ id: 'p-arruela', sku: 'COM-CHA-004' }], new Set());
      expect(s.byOutcome.WOULD_SUGGEST_PRODUCT).toEqual({ pairs: 2, value: 66.13 });
      expect(s.byOutcome.SKIPPED_MANUAL_EXCLUSION).toEqual({ pairs: 1, value: 268 });
      expect(s.suggestionCoverage).toEqual({ components: 1, of: 1, skus: ['COM-CHA-004'] });
      expect(s.confirmedCoverage).toEqual({ components: 0, of: 1 });
    });

    it('a exclusão entra na evidência nominal e é idempotente (duas execuções = mesmo plano)', () => {
      const a = nominalEvidence(run(exclusions));
      const b = nominalEvidence(run(exclusions));
      expect(a.excluded).toEqual(['gdr|proind-1|07849|legado:225']);
      expect(a.product).toEqual(['gdr|proind-1|08070|p-arruela', 'gdr|proind-2|08070|p-arruela']);
      expect(a).toEqual(b);
    });

    it('par com duas descrições, uma excluída e outra válida, continua sugerindo pela válida', () => {
      const plan = planSeed({ companyId: 'gdr', pairs: [pair({ supplierProductCode: 'X', descriptions: ['ARRUELA 1/4 LISA Diversos Ref.:1141c.1', 'ARRUELA 3/8 INOX LISA Diversos'] })], legacy: indexLegacy(legacyArruela), products: indexProducts(prods), existing: new Map(), exclusions });
      expect(plan[0]).toMatchObject({ outcome: 'WOULD_SUGGEST_PRODUCT', suggestedSku: 'COM-CHA-004', legacyIds: ['202'] });
    });
  });

  it('parseLegacyTsv: cabeçalho obrigatório, código vazio vira null', () => {
    const rows = parseLegacyTsv('Id\tDescricaoNota\tOcorrencias\tTipoMapeamento\tCodigo\n1\tX\t3\tInsumo\t\n2\tY\t1\tComprado\tCOM-1\n');
    expect(rows).toEqual([{ id: '1', descricaoNota: 'X', ocorrencias: 3, tipo: 'Insumo', codigo: null }, { id: '2', descricaoNota: 'Y', ocorrencias: 1, tipo: 'Comprado', codigo: 'COM-1' }]);
    expect(() => parseLegacyTsv('a\tb\n1\t2')).toThrow(/colunas obrigatórias/);
  });
});
