/**
 * Motor de previsão de demanda — Média Móvel Ponderada + Sazonalidade
 *
 * WMA: peso crescente para meses mais recentes.
 *   weights[0]=1 (mais antigo) … weights[N-1]=N (mais recente)
 *   WMA = Σ(weight_i × value_i) / Σ(weights_i)
 *
 * Índice sazonal (SI): calculado quando há ≥12 meses de histórico.
 *   Para cada mês do calendário (1–12), SI = média_do_mês / média_global
 *   forecast_final = WMA × SI_do_mes_alvo
 */

export interface MonthlySale {
  period: string; // YYYY-MM
  qty: number;
}

export interface ForecastResult {
  wma: number;
  seasonalIndex: number;
  forecast: number; // wma × seasonalIndex, arredondado para 2 casas
  windowMonths: number;
  periodsUsed: string[];
  hasSeasonality: boolean;
}

export interface BacktestPoint {
  period: string;       // mês testado (real conhecido)
  actual: number;
  predicted: number;
  absPercentError: number; // |actual - predicted| / actual × 100
}

export interface BacktestResult {
  productId: string;
  points: BacktestPoint[];
  mape: number | null; // null se não houver dados suficientes
  accuracy: number | null; // 100 - mape
}

// ─── WMA ─────────────────────────────────────────────────────────────────────

export function computeWma(
  history: MonthlySale[],
  targetPeriod: string,
  windowMonths: number,
): ForecastResult {
  // ordena cronologicamente e pega os N meses ANTES do target
  const sorted = [...history]
    .filter((h) => h.period < targetPeriod)
    .sort((a, b) => a.period.localeCompare(b.period));

  const window = sorted.slice(-windowMonths);

  if (window.length === 0) {
    return {
      wma: 0,
      seasonalIndex: 1,
      forecast: 0,
      windowMonths,
      periodsUsed: [],
      hasSeasonality: false,
    };
  }

  // WMA — peso 1 ao mais antigo, N ao mais recente
  let weightedSum = 0;
  let weightTotal = 0;
  window.forEach((m, i) => {
    const weight = i + 1;
    weightedSum += weight * m.qty;
    weightTotal += weight;
  });
  const wma = weightTotal > 0 ? weightedSum / weightTotal : 0;

  // Sazonalidade — precisa de ≥12 meses
  const hasSeasonality = sorted.length >= 12;
  let seasonalIndex = 1;

  if (hasSeasonality) {
    const targetMonth = parseInt(targetPeriod.split('-')[1], 10);
    const globalAvg =
      sorted.reduce((s, m) => s + m.qty, 0) / sorted.length;

    const sameMonthValues = sorted.filter(
      (m) => parseInt(m.period.split('-')[1], 10) === targetMonth,
    );

    if (sameMonthValues.length > 0 && globalAvg > 0) {
      const monthAvg =
        sameMonthValues.reduce((s, m) => s + m.qty, 0) /
        sameMonthValues.length;
      seasonalIndex = monthAvg / globalAvg;
    }
  }

  const forecast = Math.round(wma * seasonalIndex * 100) / 100;

  return {
    wma: Math.round(wma * 100) / 100,
    seasonalIndex: Math.round(seasonalIndex * 10000) / 10000,
    forecast,
    windowMonths: window.length,
    periodsUsed: window.map((m) => m.period),
    hasSeasonality,
  };
}

// ─── Backtest ─────────────────────────────────────────────────────────────────

export function backtest(
  productId: string,
  history: MonthlySale[],
  testMonths: number,
  windowMonths: number,
): BacktestResult {
  if (history.length < windowMonths + 1) {
    return { productId, points: [], mape: null, accuracy: null };
  }

  const sorted = [...history].sort((a, b) =>
    a.period.localeCompare(b.period),
  );

  // testa os últimos N meses disponíveis
  const testPeriods = sorted.slice(-testMonths);

  const points: BacktestPoint[] = [];

  for (const target of testPeriods) {
    // histórico disponível até o mês ANTERIOR ao target
    const pastOnly = sorted.filter((m) => m.period < target.period);
    if (pastOnly.length < windowMonths) continue;

    const { forecast } = computeWma(pastOnly, target.period, windowMonths);
    const actual = target.qty;

    // ignora períodos com venda zero para não distorcer MAPE
    if (actual === 0) continue;

    const absPercentError =
      (Math.abs(actual - forecast) / actual) * 100;

    points.push({
      period: target.period,
      actual,
      predicted: forecast,
      absPercentError: Math.round(absPercentError * 100) / 100,
    });
  }

  if (points.length === 0) {
    return { productId, points, mape: null, accuracy: null };
  }

  const mape =
    Math.round(
      (points.reduce((s, p) => s + p.absPercentError, 0) / points.length) *
        100,
    ) / 100;

  return {
    productId,
    points,
    mape,
    accuracy: Math.round((100 - mape) * 100) / 100,
  };
}

// ─── Utilitários de período ───────────────────────────────────────────────────

export function nextPeriod(period?: string): string {
  const base = period ?? currentPeriod();
  const [year, month] = base.split('-').map(Number);
  const next = new Date(year, month, 1); // month é 0-based, então month (1-based) = next month
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

export function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function periodRange(fromPeriod: string, count: number): string[] {
  const periods: string[] = [];
  let [year, month] = fromPeriod.split('-').map(Number);
  for (let i = 0; i < count; i++) {
    periods.push(
      `${year}-${String(month).padStart(2, '0')}`,
    );
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return periods;
}
