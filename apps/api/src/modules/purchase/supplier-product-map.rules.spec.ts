import {
  canTransition,
  descriptionDiverges,
  maxStatusForSource,
  ncmCanIdentifyProduct,
  normalizeDescription,
  priorityScore,
  suggestKindFromNcm,
  validateState,
} from './supplier-product-map.rules';

describe('SupplierProductMap — invariantes de estado (espelham os CHECKs do banco)', () => {
  it('UNRESOLVED simples é válido', () => {
    expect(validateState({ status: 'UNRESOLVED', kind: null, productId: null, confirmedAt: null })).toEqual([]);
  });
  it('productId só com kind PRODUCT', () => {
    expect(
      validateState({ status: 'SUGGESTED', kind: 'CONSUMABLE', productId: 'p1', confirmedAt: null }),
    ).toHaveLength(1);
    expect(
      validateState({ status: 'SUGGESTED', kind: 'PRODUCT', productId: 'p1', confirmedAt: null }),
    ).toEqual([]);
  });
  it('CONFIRMED exige kind + confirmedAt; PRODUCT confirmado exige productId', () => {
    expect(
      validateState({ status: 'CONFIRMED', kind: null, productId: null, confirmedAt: null }),
    ).toHaveLength(2); // sem kind e sem confirmedAt
    expect(
      validateState({ status: 'CONFIRMED', kind: 'PRODUCT', productId: null, confirmedAt: new Date() }),
    ).toHaveLength(1);
    expect(
      validateState({ status: 'CONFIRMED', kind: 'PRODUCT', productId: 'p1', confirmedAt: new Date() }),
    ).toEqual([]);
  });
  it('não-produto confirmado NÃO cria Product artificial (productId nulo é o correto)', () => {
    for (const kind of ['CONSUMABLE', 'ASSET', 'FREIGHT_OTHER'] as const) {
      expect(
        validateState({ status: 'CONFIRMED', kind, productId: null, confirmedAt: new Date() }),
      ).toEqual([]);
    }
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
  it('CONFIRMED não regride direto para UNRESOLVED', () => {
    expect(canTransition('CONFIRMED', 'UNRESOLVED')).toBe(false);
    expect(canTransition('CONFIRMED', 'SUGGESTED')).toBe(false);
  });
});

describe('sugestões nunca confirmam sozinhas', () => {
  it('seed/descrição/NCM sem humano → no máximo SUGGESTED', () => {
    expect(maxStatusForSource('SEED_PRODUCAO_V2', false)).toBe('SUGGESTED');
    expect(maxStatusForSource('DESCRIPTION', false)).toBe('SUGGESTED');
    expect(maxStatusForSource('RULE_NCM', false)).toBe('SUGGESTED');
  });
  it('mesmo com humano, fonte automática continua SUGGESTED — só MANUAL confirma', () => {
    expect(maxStatusForSource('SEED_PRODUCAO_V2', true)).toBe('SUGGESTED');
    expect(maxStatusForSource('MANUAL', true)).toBe('CONFIRMED');
  });
  it('NCM sozinho nunca identifica Product', () => {
    expect(ncmCanIdentifyProduct()).toBe(false);
  });
  it('NCM 84/85/90 sugere classificação ASSET (máquina), sem apontar Product', () => {
    expect(suggestKindFromNcm('84581100')).toBe('ASSET');
    expect(suggestKindFromNcm('90318099')).toBe('ASSET');
    expect(suggestKindFromNcm('73181500')).toBeNull();
    expect(suggestKindFromNcm(null)).toBeNull();
  });
});

describe('priorização (valor + recorrência + relevância p/ BOM ativa)', () => {
  const base = { totalPurchasedValue: 10_000, occurrenceCount: 5, suggestedInActiveBom: false, activeBomCount: 0 };
  it('mais valor → mais prioridade', () => {
    expect(priorityScore({ ...base, totalPurchasedValue: 100_000 })).toBeGreaterThan(priorityScore(base));
  });
  it('mais recorrência desempata', () => {
    expect(priorityScore({ ...base, occurrenceCount: 50 })).toBeGreaterThan(priorityScore(base));
  });
  it('presença em BOM ativa fura a fila de um avulso mais caro', () => {
    const avulsoCaro = priorityScore({ ...base, totalPurchasedValue: 80_000 });
    const itemDeBom = priorityScore({ ...base, totalPurchasedValue: 10_000, suggestedInActiveBom: true, activeBomCount: 5 });
    expect(itemDeBom).toBeGreaterThan(avulsoCaro);
  });
});

describe('gatilho de REVIEW por divergência de descrição', () => {
  it('mesma coisa escrita diferente NÃO diverge', () => {
    expect(descriptionDiverges('PNEU 155/65R13 73T RW-581 - ROADWING', 'PNEU 155/65 R13 ROADWING RW-581')).toBe(false);
  });
  it('descrição completamente diferente diverge → REVIEW', () => {
    expect(descriptionDiverges('PNEU 155/65R13 ROADWING', 'CHAPA DE ACO 2MM QC')).toBe(true);
  });
  it('sem descrição confirmada não há divergência (nada a comparar)', () => {
    expect(descriptionDiverges(null, 'QUALQUER')).toBe(false);
  });
  it('normalização remove acento/pontuação e comprime espaços', () => {
    expect(normalizeDescription('  Parafuso  1/4"x1.1/4  FRANCÊS ')).toBe('PARAFUSO 1 4 X1 1 4 FRANCES');
  });
});
