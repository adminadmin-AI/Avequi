import { describe, expect, it } from 'vitest';
import {
  compactBRL,
  groupByDate,
  groupOf,
  monthFitsWindow,
  monthGrid,
  monthWindowDays,
  rollingWeek,
  summarizeDay,
  weekFitsWindow,
  weekWindowDays,
  type CalendarItem,
} from './agenda-calendar';

/** Modelo do calendário — projeções, janela e rollup por grupo. */

describe('rollingWeek', () => {
  it('hoje e os 6 dias seguintes, virando mês sem escorregar', () => {
    const week = rollingWeek('2026-07-29');
    expect(week).toHaveLength(7);
    expect(week[0]).toBe('2026-07-29');
    expect(week[6]).toBe('2026-08-04');
  });

  it('offset avança semanas inteiras', () => {
    const week = rollingWeek('2026-07-31', 2);
    expect(week[0]).toBe('2026-08-14');
    expect(week[6]).toBe('2026-08-20');
  });
});

describe('janela da semana', () => {
  it('cresce com o offset e respeita o cap de 42 dias', () => {
    expect(weekWindowDays(0)).toBe(7);
    expect(weekWindowDays(3)).toBe(28);
    expect(weekWindowDays(5)).toBe(42);
  });

  it('6ª semana (offset 5) é a última navegável', () => {
    expect(weekFitsWindow(5)).toBe(true);
    expect(weekFitsWindow(6)).toBe(false);
    expect(weekFitsWindow(-1)).toBe(false);
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
    expect(grid.month).toBe('2026-07');
  });

  it('offset navega para o mês seguinte com label e âncora certos', () => {
    const grid = monthGrid('2026-07-31', 1);
    expect(grid.label).toContain('agosto');
    expect(grid.month).toBe('2026-08');
    expect(grid.weeks.flat()).toContain('2026-08-15');
  });

  it('todo dia do mês aparece exatamente uma vez', () => {
    const grid = monthGrid('2026-02-10');
    const all = grid.weeks.flat();
    const ofMonth = all.filter((d) => d.startsWith('2026-02'));
    expect(ofMonth).toHaveLength(28);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('janela do mês', () => {
  it('cobre de hoje até o último sábado do grid, com piso de 7', () => {
    // 31/07/2026 (sexta): última célula é sáb 01/08 → diff 2 → piso 7
    expect(monthWindowDays('2026-07-31')).toBe(7);
    expect(monthWindowDays('2026-07-01')).toBeGreaterThan(30);
    expect(monthWindowDays('2026-07-01')).toBeLessThanOrEqual(42);
  });

  it('mês seguinte navegável no fim do mês, bloqueado no início', () => {
    // 31/07: grid de agosto termina 05/09 → ~37d, cabe
    expect(monthFitsWindow('2026-07-31', 1)).toBe(true);
    // 01/07: grid de agosto termina 05/09 → 67d, não cabe
    expect(monthFitsWindow('2026-07-01', 1)).toBe(false);
    expect(monthFitsWindow('2026-07-31', 0)).toBe(true);
    expect(monthFitsWindow('2026-07-31', -1)).toBe(false);
  });
});

describe('rollup do dia', () => {
  const item = (over: Partial<CalendarItem>): CalendarItem => ({
    id: Math.random().toString(36).slice(2),
    date: '2026-08-03',
    kind: 'finance-due',
    title: 'x',
    href: '/app/finance/payables',
    ...over,
  });

  it('classifica direção financeira pelo destino', () => {
    expect(groupOf(item({}))).toBe('payable');
    expect(groupOf(item({ href: '/app/finance/receivables' }))).toBe('receivable');
    expect(groupOf(item({ kind: 'production-end' }))).toBe('production');
    expect(groupOf(item({ kind: 'crm-reminder' }))).toBe('crm');
  });

  it('soma valores por grupo na ordem fixa e propaga o alarme', () => {
    const rollups = summarizeDay([
      item({ kind: 'crm-reminder' }),
      item({ amount: 100_000, tone: 'danger' }),
      item({ amount: 32_450 }),
      item({ href: '/app/finance/receivables', amount: 5_000 }),
    ]);
    expect(rollups.map((r) => r.group)).toEqual(['payable', 'receivable', 'crm']);
    expect(rollups[0]).toMatchObject({ count: 2, amount: 132_450, hasDanger: true });
    expect(rollups[1]).toMatchObject({ count: 1, amount: 5_000, hasDanger: false });
    expect(rollups[2].amount).toBeNull(); // CRM não tem valor
  });

  it('dia vazio → sem rollups', () => {
    expect(summarizeDay([])).toEqual([]);
  });
});

describe('compactBRL', () => {
  it('formata em escala executiva', () => {
    expect(compactBRL(132_450)).toBe('R$ 132,5 mil');
    expect(compactBRL(900)).toBe('R$ 900');
    expect(compactBRL(1_250_000)).toBe('R$ 1,3 mi');
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
