import { BadRequestException } from '@nestjs/common';
import { AdjustmentSourceItem, IbsCbsAdjustmentService } from './ibscbs-adjustment.service';

// #755 — motor de diferença IBS/CBS (notas de débito/crédito, finNFe 5/6)

const item = (
  id: string,
  base: number,
  over: Partial<AdjustmentSourceItem['tax']> = {},
  sku = `SKU-${id}`,
): AdjustmentSourceItem => ({
  id,
  sku,
  name: `Produto ${id}`,
  ncm: '87163900',
  tax: {
    cClassTrib: '000001',
    cstCbs: '000',
    baseCbs: base,
    valorCbs: base * 0.009, // 0,9%
    baseIbsUf: base,
    valorIbsUf: base * 0.001, // 0,1%
    baseIbsMun: base,
    valorIbsMun: 0,
    ...over,
  },
});

describe('IbsCbsAdjustmentService (#755)', () => {
  const service = new IbsCbsAdjustmentService();

  it('FULL: estorno integral espelha bases e valores da original', () => {
    const r = service.compute([item('a', 3000), item('b', 1000)], { mode: 'FULL' });
    expect(r.totalBase).toBe(4000);
    expect(r.vCBS).toBe(36); // 0,9% de 4000
    expect(r.vIBS).toBe(4); // 0,1% UF de 4000 + 0 Mun
    expect(r.items.map((i) => i.base)).toEqual([3000, 1000]);
    expect(r.items[0].cbsAliquota).toBe(0.9);
    expect(r.items[0].ibsUfAliquota).toBe(0.1);
  });

  it('ITEMS: delta por item, com validação de teto na base original', () => {
    const r = service.compute([item('a', 3000)], {
      mode: 'ITEMS',
      itemDeltas: [{ fiscalDocumentItemId: 'a', baseDelta: 500 }],
    });
    expect(r.items[0].base).toBe(500);
    expect(r.items[0].cbsValor).toBe(4.5);
    expect(r.items[0].ibsUfValor).toBe(0.5);

    expect(() =>
      service.compute([item('a', 3000)], {
        mode: 'ITEMS',
        itemDeltas: [{ fiscalDocumentItemId: 'a', baseDelta: 3500 }],
      }),
    ).toThrow(/excede a base original/);

    expect(() =>
      service.compute([item('a', 3000)], {
        mode: 'ITEMS',
        itemDeltas: [{ fiscalDocumentItemId: 'zzz', baseDelta: 100 }],
      }),
    ).toThrow(/não existe na NF-e original/);
  });

  it('TOTAL: rateia proporcional às bases e fecha o arredondamento no último item', () => {
    // bases 3000/1000 → 75%/25%; delta 100.01 → 75.01 + 25.00 (resto no último)
    const r = service.compute([item('a', 3000), item('b', 1000)], {
      mode: 'TOTAL',
      totalDelta: 100.01,
    });
    expect(r.totalBase).toBe(100.01);
    expect(r.items[0].base + r.items[1].base).toBeCloseTo(100.01, 2);

    expect(() =>
      service.compute([item('a', 3000)], { mode: 'TOTAL', totalDelta: 3001 }),
    ).toThrow(/excede a base total/);
  });

  it('AMOUNT: item sintético com alíquotas espelhadas; heterogêneo exige ITEMS', () => {
    const r = service.compute([item('a', 3000)], {
      mode: 'AMOUNT',
      amount: 350,
      description: 'multa e juros atraso',
    });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].sourceItemId).toBeNull();
    expect(r.items[0].sku).toBe('AJUSTE');
    expect(r.items[0].name).toBe('MULTA E JUROS ATRASO');
    expect(r.items[0].base).toBe(350);
    expect(r.items[0].cbsValor).toBe(3.15); // 0,9% de 350

    // alíquotas heterogêneas (item b com CBS 0,5%) → erro orientado
    expect(() =>
      service.compute(
        [item('a', 3000), item('b', 1000, { valorCbs: 5 })],
        { mode: 'AMOUNT', amount: 100 },
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      service.compute(
        [item('a', 3000), item('b', 1000, { valorCbs: 5 })],
        { mode: 'AMOUNT', amount: 100 },
      ),
    ).toThrow(/heterogêneas/);
  });

  it('alíquota EFETIVA é derivada de valor/base — captura gRed implícito da original', () => {
    // original com redução (CST 200): 0,9% nominal mas efetiva 0,54% (40% red)
    const r = service.compute(
      [item('a', 1000, { cstCbs: '200', valorCbs: 5.4 })],
      { mode: 'ITEMS', itemDeltas: [{ fiscalDocumentItemId: 'a', baseDelta: 100 }] },
    );
    expect(r.items[0].cbsAliquota).toBe(0.54);
    expect(r.items[0].cbsValor).toBe(0.54);
  });

  it('original sem IBS/CBS persistido → erro orientado (pré-Reforma não é ajustável)', () => {
    expect(() =>
      service.compute([item('a', 1000, { cClassTrib: null })], { mode: 'FULL' }),
    ).toThrow(/sem grupo IBS\/CBS/);
  });
});
