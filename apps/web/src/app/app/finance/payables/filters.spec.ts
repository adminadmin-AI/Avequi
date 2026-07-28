import { describe, it, expect } from 'vitest';
import { venceDate, previsaoDate, inRange, toDayStr } from './filters';

describe('helpers dos filtros de data da Carteira de Pagáveis', () => {
  it('venceDate devolve só a parte da data do vencimento', () => {
    expect(venceDate({ dueDate: '2026-07-28T00:00:00.000Z' })).toBe('2026-07-28');
    expect(venceDate({ dueDate: '2026-07-28' })).toBe('2026-07-28');
  });

  it('previsaoDate usa expectedPaymentDate quando informada', () => {
    expect(
      previsaoDate({ expectedPaymentDate: '2026-07-28T09:00:00Z', dueDate: '2026-07-30' }),
    ).toBe('2026-07-28');
  });

  it('previsaoDate cai pro vencimento quando previsão ausente (null/undefined)', () => {
    expect(previsaoDate({ expectedPaymentDate: null, dueDate: '2026-07-30' })).toBe('2026-07-30');
    expect(previsaoDate({ expectedPaymentDate: undefined, dueDate: '2026-07-30' })).toBe(
      '2026-07-30',
    );
  });

  describe('inRange', () => {
    it('sem limites = tudo passa', () => {
      expect(inRange('2026-07-28')).toBe(true);
      expect(inRange('2026-07-28', '', '')).toBe(true);
    });
    it('respeita o início (inclusive)', () => {
      expect(inRange('2026-07-28', '2026-07-28')).toBe(true); // borda
      expect(inRange('2026-07-27', '2026-07-28')).toBe(false);
      expect(inRange('2026-07-29', '2026-07-28')).toBe(true);
    });
    it('respeita o fim (inclusive)', () => {
      expect(inRange('2026-07-28', undefined, '2026-07-28')).toBe(true); // borda
      expect(inRange('2026-07-29', undefined, '2026-07-28')).toBe(false);
      expect(inRange('2026-07-27', undefined, '2026-07-28')).toBe(true);
    });
    it('intervalo fechado dos dois lados', () => {
      expect(inRange('2026-07-15', '2026-07-10', '2026-07-20')).toBe(true);
      expect(inRange('2026-07-10', '2026-07-10', '2026-07-20')).toBe(true);
      expect(inRange('2026-07-20', '2026-07-10', '2026-07-20')).toBe(true);
      expect(inRange('2026-07-09', '2026-07-10', '2026-07-20')).toBe(false);
      expect(inRange('2026-07-21', '2026-07-10', '2026-07-20')).toBe(false);
    });
  });

  it('toDayStr formata YYYY-MM-DD com zero à esquerda', () => {
    expect(toDayStr(new Date(2026, 6, 28))).toBe('2026-07-28'); // mês 6 = julho
    expect(toDayStr(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
