import { describe, expect, it } from 'vitest';
import {
  defaultSelectedDay,
  groupByDate,
  monthGrid,
  monthWindowDays,
  rollingWeek,
} from './agenda-calendar';

/** Modelo do calendário — grid de mês estilo Apple + semana rolante. */

describe('rollingWeek', () => {
  it('hoje e os 6 dias seguintes, virando mês sem escorregar', () => {
    const week = rollingWeek('2026-07-29');
    expect(week).toHaveLength(7);
    expect(week[0]).toBe('2026-07-29');
    expect(week[6]).toBe('2026-08-04');
  });
});

describe('monthGrid', () => {
  it('semanas completas dom→sáb cobrindo o mês corrente', () => {
    const grid = monthGrid('2026-07-31');
    // julho/2026: dia 1 é quarta → grid começa em 28/06 (domingo)
    expect(grid.weeks[0][0]).toBe('2026-06-28');
    // termina no sábado 01/08
    const lastWeek = grid.weeks[grid.weeks.length - 1];
    expect(lastWeek[6]).toBe('2026-08-01');
    expect(grid.weeks.every((w) => w.length === 7)).toBe(true);
    expect(grid.label).toContain('julho');
    expect(grid.label).toContain('2026');
  });

  it('todo dia do mês aparece exatamente uma vez', () => {
    const grid = monthGrid('2026-02-10');
    const all = grid.weeks.flat();
    const ofMonth = all.filter((d) => d.startsWith('2026-02'));
    expect(ofMonth).toHaveLength(28);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('monthWindowDays', () => {
  it('cobre de hoje até o último sábado do grid, com piso de 7', () => {
    // 31/07/2026 (sexta): última célula é sáb 01/08 → diff 2 → piso 7
    expect(monthWindowDays('2026-07-31')).toBe(7);
    // início do mês: janela grande, mas nunca acima do cap do backend
    expect(monthWindowDays('2026-07-01')).toBeGreaterThan(30);
    expect(monthWindowDays('2026-07-01')).toBeLessThanOrEqual(42);
  });
});

describe('defaultSelectedDay', () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));

  it('hoje quando hoje tem compromissos', () => {
    const byDate = new Map<string, unknown[]>([['2026-07-31', items(2)]]);
    expect(defaultSelectedDay(byDate, '2026-07-31')).toBe('2026-07-31');
  });

  it('senão o primeiro dia futuro com algo', () => {
    const byDate = new Map<string, unknown[]>([
      ['2026-07-30', items(1)], // passado não conta
      ['2026-08-02', items(1)],
      ['2026-08-01', items(3)],
    ]);
    expect(defaultSelectedDay(byDate, '2026-07-31')).toBe('2026-08-01');
  });

  it('sem nada na janela, cai em hoje', () => {
    expect(defaultSelectedDay(new Map(), '2026-07-31')).toBe('2026-07-31');
  });
});

describe('groupByDate', () => {
  it('agrupa preservando a ordem de chegada dentro do dia', () => {
    const byDate = groupByDate([
      { id: 'a', date: '2026-08-01' },
      { id: 'b', date: '2026-08-02' },
      { id: 'c', date: '2026-08-01' },
    ]);
    expect(byDate.get('2026-08-01')?.map((i) => i.id)).toEqual(['a', 'c']);
  });
});
