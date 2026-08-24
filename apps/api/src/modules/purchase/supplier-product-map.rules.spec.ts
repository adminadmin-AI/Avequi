import {
  canTransition,
  descriptionDiverges,
  maxStatusForSource,
  normalizeDescription,
  provisionalPriorityScore,
  validateState,
  validateTenantConsistency,
} from './supplier-product-map.rules';

describe('SupplierProductMap — invariantes por status (espelham os CHECKs do banco)', () => {
  const at = new Date();

  it('UNRESOLVED: canônicos vazios é o único estado válido', () => {
    expect(validateState({ status: 'UNRESOLVED', kind: null, productId: null, confirmedAt: null })).toEqual([]);
    expect(validateState({ status: 'UNRESOLVED', kind: 'PRODUCT', productId: null, confirmedAt: null })).toHaveLength(1);
    expect(validateState({ status: 'UNRESOLVED', kind: null, productId: 'p1', confirmedAt: null })).toHaveLength(1);
  });

  it('SUGGESTED: sugestão NÃO ocupa os campos canônicos (vive só em suggested*)', () => {
    expect(validateState({ status: 'SUGGESTED', kind: null, productId: null, confirmedAt: null })).toEqual([]);
    expect(validateState({ status: 'SUGGESTED', kind: 'PRODUCT', productId: 'p1', confirmedAt: null })).toHaveLength(2);
    expect(validateState({ status: 'SUGGESTED', kind: null, productId: null, confirmedAt: at })).toHaveLength(1);
  });

  it('CONFIRMED: exige kind + confirmedAt; PRODUCT exige productId; não-PRODUCT proíbe productId', () => {
    expect(validateState({ status: 'CONFIRMED', kind: null, productId: null, confirmedAt: null })).toHaveLength(2);
    expect(validateState({ status: 'CONFIRMED', kind: 'PRODUCT', productId: null, confirmedAt: at })).toHaveLength(1);
    expect(validateState({ status: 'CONFIRMED', kind: 'PRODUCT', productId: 'p1', confirmedAt: at })).toEqual([]);
    for (const kind of ['CONSUMABLE', 'ASSET', 'FREIGHT_OTHER'] as const) {
      expect(validateState({ status: 'CONFIRMED', kind, productId: null, confirmedAt: at })).toEqual([]);
      expect(validateState({ status: 'CONFIRMED', kind, productId: 'p1', confirmedAt: at })).toHaveLength(1);
    }
  });

  it('REVIEW mantém a verdade canônica anterior — mesmas regras de coerência de CONFIRMED', () => {
    // vínculo confirmado que entrou em revisão: NÃO perde kind/productId/trilha
    expect(validateState({ status: 'REVIEW', kind: 'PRODUCT', productId: 'p1', confirmedAt: at })).toEqual([]);
    expect(validateState({ status: 'REVIEW', kind: 'ASSET', productId: null, confirmedAt: at })).toEqual([]);
    // REVIEW sem a verdade anterior é inválido (não existe REVIEW "vazio")
    expect(validateState({ status: 'REVIEW', kind: null, productId: null, confirmedAt: null })).toHaveLength(2);
    expect(validateState({ status: 'REVIEW', kind: 'PRODUCT', productId: null, confirmedAt: at })).toHaveLength(1);
  });
});

describe('transições de status (auditáveis e reversíveis)', () => {
  it('caminho feliz: UNRESOLVED → SUGGESTED → CONFIRMED', () => {
    expect(canTransition('UNRESOLVED', 'SUGGESTED')).toBe(true);
    expect(canTransition('SUGGESTED', 'CONFIRMED')).toBe(true);
  });
  it('reversível: CONFIRMED → REVIEW → CONFIRMED (nunca deletar)', () => {
    expect(canTransition('CONFIRMED', 'REVIEW')).toBe(true);
    expect(canTransition('REVIEW', 'CONFIRMED')).toBe(true);
  });
  it('reclassificação = CONFIRMED → CONFIRMED (com evento de auditoria)', () => {
    expect(canTransition('CONFIRMED', 'CONFIRMED')).toBe(true);
  });
  it('CONFIRMED não regride direto para UNRESOLVED/SUGGESTED', () => {
    expect(canTransition('CONFIRMED', 'UNRESOLVED')).toBe(false);
    expect(canTransition('CONFIRMED', 'SUGGESTED')).toBe(false);
  });
});

describe('sugestões nunca confirmam sozinhas (NCM incluso)', () => {
  it('seed/descrição/NCM sem humano → no máximo SUGGESTED', () => {
    expect(maxStatusForSource('SEED_PRODUCAO_V2', false)).toBe('SUGGESTED');
    expect(maxStatusForSource('DESCRIPTION', false)).toBe('SUGGESTED');
    expect(maxStatusForSource('RULE_NCM', false)).toBe('SUGGESTED');
  });
  it('mesmo com humano, fonte automática continua SUGGESTED — só MANUAL confirma', () => {
    expect(maxStatusForSource('SEED_PRODUCAO_V2', true)).toBe('SUGGESTED');
    expect(maxStatusForSource('RULE_NCM', true)).toBe('SUGGESTED');
    expect(maxStatusForSource('MANUAL', true)).toBe('CONFIRMED');
  });
  it('não existe classificação determinística por NCM no PR-1 (decisão 24/08)', () => {
    // 84/85/90 contêm componentes legítimos de BOM — a heurística combinada
    // fica para o futuro; provamos que o módulo não exporta o atalho.
    const rules = require('./supplier-product-map.rules');
    expect(rules.suggestKindFromNcm).toBeUndefined();
  });
});

describe('isolamento entre empresas (padrão de guard do Avequi)', () => {
  const base = {
    mapCompanyId: 'co-gdr',
    supplierCompanyId: 'co-gdr',
    productCompanyId: undefined,
    suggestedProductCompanyId: undefined,
  };
  it('tudo do mesmo tenant passa', () => {
    expect(validateTenantConsistency({ ...base, productCompanyId: 'co-gdr', suggestedProductCompanyId: 'co-gdr' })).toEqual([]);
  });
  it('supplier de outro tenant → rejeitado', () => {
    expect(validateTenantConsistency({ ...base, supplierCompanyId: 'co-crd' })).toHaveLength(1);
  });
  it('supplier inexistente no tenant (null) → rejeitado', () => {
    expect(validateTenantConsistency({ ...base, supplierCompanyId: null })).toHaveLength(1);
  });
  it('product de outro tenant → rejeitado', () => {
    expect(validateTenantConsistency({ ...base, productCompanyId: 'co-crd' })).toHaveLength(1);
  });
  it('suggestedProduct de outro tenant → rejeitado', () => {
    expect(validateTenantConsistency({ ...base, suggestedProductCompanyId: 'co-crd' })).toHaveLength(1);
  });
});

describe('priorização provisória (política concreta calibrada no PR-2)', () => {
  const base = { totalPurchasedValue: 10_000, occurrenceCount: 5, suggestedInActiveBom: false, activeBomCount: 0 };
  it('mais valor → mais prioridade', () => {
    expect(provisionalPriorityScore({ ...base, totalPurchasedValue: 100_000 })).toBeGreaterThan(provisionalPriorityScore(base));
  });
  it('mais recorrência desempata', () => {
    expect(provisionalPriorityScore({ ...base, occurrenceCount: 50 })).toBeGreaterThan(provisionalPriorityScore(base));
  });
  it('BOM ativa dá peso forte: fura a fila de item de valor comparável', () => {
    const semBom = provisionalPriorityScore({ ...base, totalPurchasedValue: 30_000 });
    const comBom = provisionalPriorityScore({ ...base, totalPurchasedValue: 10_000, suggestedInActiveBom: true, activeBomCount: 5 });
    expect(comBom).toBeGreaterThan(semBom);
  });
  it('mas o peso é FINITO: item muito mais caro fora de BOM ainda vence', () => {
    const foraDeBomMuitoCaro = provisionalPriorityScore({ ...base, totalPurchasedValue: 1_000_000 });
    const dentroDeBomBarato = provisionalPriorityScore({ ...base, totalPurchasedValue: 1_000, suggestedInActiveBom: true, activeBomCount: 10 });
    expect(foraDeBomMuitoCaro).toBeGreaterThan(dentroDeBomBarato);
  });
});

describe('gatilho de REVIEW por divergência de descrição', () => {
  it('mesma coisa escrita diferente NÃO diverge', () => {
    expect(descriptionDiverges('PNEU 155/65R13 73T RW-581 - ROADWING', 'PNEU 155/65 R13 ROADWING RW-581')).toBe(false);
  });
  it('descrição completamente diferente diverge → REVIEW (nunca desfaz sozinha)', () => {
    expect(descriptionDiverges('PNEU 155/65R13 ROADWING', 'CHAPA DE ACO 2MM QC')).toBe(true);
  });
  it('sem descrição confirmada não há divergência (nada a comparar)', () => {
    expect(descriptionDiverges(null, 'QUALQUER')).toBe(false);
  });
  it('normalização remove acento/pontuação e comprime espaços', () => {
    expect(normalizeDescription('  Parafuso  1/4"x1.1/4  FRANCÊS ')).toBe('PARAFUSO 1 4 X1 1 4 FRANCES');
  });
});
