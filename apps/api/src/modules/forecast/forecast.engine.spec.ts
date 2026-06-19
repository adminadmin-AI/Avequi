import {
  computeWma,
  backtest,
  nextPeriod,
  currentPeriod,
  periodRange,
  MonthlySale,
} from './forecast.engine';

// ─── helpers de fixture ───────────────────────────────────────────────────────

function sales(entries: [string, number][]): MonthlySale[] {
  return entries.map(([period, qty]) => ({ period, qty }));
}

// ─── nextPeriod / currentPeriod / periodRange ─────────────────────────────────

describe('nextPeriod', () => {
  it('avança um mês simples', () => {
    expect(nextPeriod('2026-03')).toBe('2026-04');
  });
  it('vira o ano em dezembro', () => {
    expect(nextPeriod('2026-12')).toBe('2027-01');
  });
  it('retorna próximo mês quando sem argumento', () => {
    const now = new Date();
    const expected = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const result = nextPeriod();
    expect(result).toBe(
      `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}`,
    );
  });
});

describe('currentPeriod', () => {
  it('retorna YYYY-MM do mês corrente', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    expect(currentPeriod()).toBe(expected);
  });
});

describe('periodRange', () => {
  it('gera sequência de períodos', () => {
    expect(periodRange('2026-01', 3)).toEqual(['2026-01', '2026-02', '2026-03']);
  });
  it('cruza o ano corretamente', () => {
    expect(periodRange('2026-11', 3)).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

// ─── computeWma ──────────────────────────────────────────────────────────────

describe('computeWma', () => {
  it('retorna 0 quando não há histórico anterior ao target', () => {
    const result = computeWma([], '2026-04', 3);
    expect(result.forecast).toBe(0);
    expect(result.periodsUsed).toHaveLength(0);
  });

  it('WMA básico com janela 3 meses', () => {
    // pesos: 1×100 + 2×200 + 3×300 = 100+400+900 = 1400 / (1+2+3)=6 = 233.33
    const history = sales([
      ['2026-01', 100],
      ['2026-02', 200],
      ['2026-03', 300],
    ]);
    const result = computeWma(history, '2026-04', 3);
    expect(result.wma).toBeCloseTo(233.33, 1);
    expect(result.forecast).toBeCloseTo(233.33, 1);
    expect(result.periodsUsed).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(result.hasSeasonality).toBe(false);
  });

  it('usa apenas os N meses mais recentes quando histórico maior', () => {
    const history = sales([
      ['2025-10', 999], // deve ser ignorado (fora da janela de 3)
      ['2025-11', 999],
      ['2026-01', 100],
      ['2026-02', 200],
      ['2026-03', 300],
    ]);
    const result = computeWma(history, '2026-04', 3);
    expect(result.periodsUsed).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('não usa períodos ≥ target', () => {
    const history = sales([
      ['2026-02', 200],
      ['2026-03', 300],
      ['2026-04', 999], // target — deve ser excluído
    ]);
    const result = computeWma(history, '2026-04', 3);
    expect(result.periodsUsed).not.toContain('2026-04');
  });

  it('aplica índice sazonal quando há ≥12 meses de histórico', () => {
    // 24 meses com sazonalidade: meses de abril consistentemente altos
    const history: MonthlySale[] = [];
    for (let m = 1; m <= 12; m++) {
      history.push({ period: `2024-${String(m).padStart(2, '0')}`, qty: m === 4 ? 400 : 100 });
    }
    for (let m = 1; m <= 12; m++) {
      history.push({ period: `2025-${String(m).padStart(2, '0')}`, qty: m === 4 ? 400 : 100 });
    }
    // target: abril 2026
    const result = computeWma(history, '2026-04', 3);
    expect(result.hasSeasonality).toBe(true);
    // índice sazonal de abril deve ser > 1 (abril vende mais que a média)
    expect(result.seasonalIndex).toBeGreaterThan(1);
    expect(result.forecast).toBeGreaterThan(result.wma);
  });

  it('windowMonths maior que histórico usa o que tem', () => {
    const history = sales([
      ['2026-01', 100],
      ['2026-02', 200],
    ]);
    const result = computeWma(history, '2026-04', 6);
    expect(result.periodsUsed).toHaveLength(2);
    expect(result.forecast).toBeGreaterThan(0);
  });
});

// ─── backtest ────────────────────────────────────────────────────────────────

describe('backtest', () => {
  it('retorna mape null quando histórico insuficiente', () => {
    const history = sales([
      ['2026-01', 100],
      ['2026-02', 200],
    ]);
    const result = backtest('p1', history, 3, 3);
    expect(result.mape).toBeNull();
    expect(result.accuracy).toBeNull();
  });

  it('calcula MAPE para série com dados suficientes', () => {
    // série estável: 100 todo mês — WMA deve prever 100, real é 100 → MAPE=0
    const history: MonthlySale[] = [];
    for (let m = 1; m <= 9; m++) {
      history.push({ period: `2026-${String(m).padStart(2, '0')}`, qty: 100 });
    }
    const result = backtest('p1', history, 3, 3);
    expect(result.mape).toBe(0);
    expect(result.accuracy).toBe(100);
    expect(result.points).toHaveLength(3);
  });

  it('ignora meses com venda zero no cálculo do MAPE', () => {
    const history = sales([
      ['2026-01', 100],
      ['2026-02', 200],
      ['2026-03', 150],
      ['2026-04', 0],   // zero — deve ser ignorado
      ['2026-05', 120],
      ['2026-06', 110],
    ]);
    const result = backtest('p1', history, 3, 3);
    // meses testados: 04, 05, 06. Abril zerado é ignorado.
    const zeroPeriod = result.points.find((p) => p.period === '2026-04');
    expect(zeroPeriod).toBeUndefined();
  });

  it('calcula erro proporcional corretamente', () => {
    // histórico: 100,100,100 → WMA prediz 100 → real 150 → erro 33.33%
    const history = sales([
      ['2026-01', 100],
      ['2026-02', 100],
      ['2026-03', 100],
      ['2026-04', 150],
    ]);
    const result = backtest('p1', history, 1, 3);
    expect(result.points).toHaveLength(1);
    expect(result.points[0].period).toBe('2026-04');
    expect(result.points[0].predicted).toBeCloseTo(100, 0);
    expect(result.points[0].actual).toBe(150);
    expect(result.points[0].absPercentError).toBeCloseTo(33.33, 0);
  });

  it('accuracy = 100 - mape', () => {
    const history: MonthlySale[] = [];
    for (let m = 1; m <= 6; m++) {
      history.push({ period: `2026-${String(m).padStart(2, '0')}`, qty: 100 });
    }
    const result = backtest('p1', history, 3, 3);
    expect(result.accuracy).toBe(100 - result.mape!);
  });
});
