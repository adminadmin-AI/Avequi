import { describe, it, expect } from 'vitest';
import { previsaoDate, isPrevisaoOn, toDayStr } from './previsao';

describe('filtro de Previsão da Carteira de Pagáveis', () => {
  it('previsaoDate usa expectedPaymentDate quando informada', () => {
    expect(
      previsaoDate({ expectedPaymentDate: '2026-07-28T00:00:00.000Z', dueDate: '2026-07-30' }),
    ).toBe('2026-07-28');
  });

  it('previsaoDate cai pro vencimento quando previsão ausente (null/undefined)', () => {
    expect(previsaoDate({ expectedPaymentDate: null, dueDate: '2026-07-30T12:00:00Z' })).toBe(
      '2026-07-30',
    );
    expect(previsaoDate({ expectedPaymentDate: undefined, dueDate: '2026-07-30' })).toBe(
      '2026-07-30',
    );
  });

  it('isPrevisaoOn casa exatamente o dia (ignora hora)', () => {
    const e = { expectedPaymentDate: '2026-07-28T09:15:00.000Z', dueDate: '2026-08-01' };
    expect(isPrevisaoOn(e, '2026-07-28')).toBe(true);
    expect(isPrevisaoOn(e, '2026-07-27')).toBe(false);
    expect(isPrevisaoOn(e, '2026-07-29')).toBe(false);
  });

  it('isPrevisaoOn usa o vencimento quando não há previsão', () => {
    const e = { expectedPaymentDate: null, dueDate: '2026-07-28' };
    expect(isPrevisaoOn(e, '2026-07-28')).toBe(true);
    expect(isPrevisaoOn(e, '2026-07-30')).toBe(false);
  });

  it('toDayStr formata YYYY-MM-DD com zero à esquerda', () => {
    expect(toDayStr(new Date(2026, 6, 28))).toBe('2026-07-28'); // mês 6 = julho
    expect(toDayStr(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
