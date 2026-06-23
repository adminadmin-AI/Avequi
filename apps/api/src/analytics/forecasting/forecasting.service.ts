import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/filters/business-exception.filter';

export interface ForecastPoint {
  period: string;
  value: number;
  lower80: number;
  upper80: number;
  lower95: number;
  upper95: number;
}

export interface ForecastResult {
  forecasts: ForecastPoint[];
  decomposition: {
    trend: number[];
    seasonal: number[];
    residual: number[];
  };
  parameters: { alpha: number; beta: number; gamma: number; seasonLength: number };
}

export interface DecompositionResult {
  trend: number[];
  seasonal: number[];
  residual: number[];
}

@Injectable()
export class ForecastingService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Public API ─────────────────────────────────────────────────────────────

  forecast(
    data: number[],
    periods: number,
    seasonLength?: number,
  ): ForecastResult {
    if (data.length < 4) {
      throw new BusinessException(
        'Series too short for forecasting (min 4 points)',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const sl = seasonLength ?? this.detectSeasonLength(data);
    const alpha = 0.3;
    const beta = 0.1;
    const gamma = 0.1;

    const { level, trend, seasonal, fitted } = this.holtsWinters(
      data,
      alpha,
      beta,
      gamma,
      sl,
    );

    // Compute residuals for CI
    const residuals = data.map((v, i) => v - fitted[i]);
    const stdErr = this.stdDev(residuals);

    // Generate forecast points
    const forecasts: ForecastPoint[] = [];
    for (let h = 1; h <= periods; h++) {
      const seasonIdx = (data.length - sl + ((h - 1) % sl)) % sl;
      const value = (level + trend * h) + seasonal[seasonIdx];
      const z80 = 1.28;
      const z95 = 1.96;
      const margin80 = z80 * stdErr * Math.sqrt(h);
      const margin95 = z95 * stdErr * Math.sqrt(h);
      forecasts.push({
        period: `T+${h}`,
        value: Math.max(0, value),
        lower80: Math.max(0, value - margin80),
        upper80: value + margin80,
        lower95: Math.max(0, value - margin95),
        upper95: value + margin95,
      });
    }

    // Decomposition of original data
    const decomp = this.decompose(data, sl);

    return {
      forecasts,
      decomposition: decomp,
      parameters: { alpha, beta, gamma, seasonLength: sl },
    };
  }

  decompose(data: number[], seasonLength: number): DecompositionResult {
    if (data.length < seasonLength * 2) {
      // fallback: trivial decomposition
      const mean = data.reduce((a, b) => a + b, 0) / data.length;
      const trend = data.map(() => mean);
      const seasonal = data.map(() => 0);
      const residual = data.map((v) => v - mean);
      return { trend, seasonal, residual };
    }

    const n = data.length;

    // 1. Centered moving average for trend
    const trend = this.centeredMovingAverage(data, seasonLength);

    // 2. Detrend
    const detrended = data.map((v, i) =>
      trend[i] !== null ? v - (trend[i] as number) : NaN,
    );

    // 3. Average seasonal pattern
    const seasonalAvg = new Array(seasonLength).fill(0);
    const counts = new Array(seasonLength).fill(0);
    for (let i = 0; i < n; i++) {
      if (!isNaN(detrended[i])) {
        seasonalAvg[i % seasonLength] += detrended[i];
        counts[i % seasonLength]++;
      }
    }
    const seasonalPattern = seasonalAvg.map((s, i) =>
      counts[i] > 0 ? s / counts[i] : 0,
    );

    // Center seasonal components
    const seasonMean =
      seasonalPattern.reduce((a, b) => a + b, 0) / seasonLength;
    const centered = seasonalPattern.map((s) => s - seasonMean);

    // 4. Expand seasonal to full length
    const seasonal = data.map((_, i) => centered[i % seasonLength]);

    // 5. Residual
    const residual = data.map((v, i) => {
      const t = trend[i];
      return t !== null ? v - (t as number) - seasonal[i] : 0;
    });

    return { trend: trend.map((t) => (t ?? 0) as number), seasonal, residual };
  }

  async forecastMetric(
    companyId: string,
    dataSource: string,
    metric: string,
    periods: number,
    filters?: { periodFrom?: string; periodTo?: string },
  ): Promise<ForecastResult> {
    const data = await this.queryMetricData(companyId, dataSource, metric, filters);
    if (data.length === 0) {
      throw new BusinessException(
        `No data found for ${dataSource}.${metric}`,
        HttpStatus.NOT_FOUND,
      );
    }
    return this.forecast(data, periods);
  }

  async decomposeMetric(
    companyId: string,
    dataSource: string,
    metric: string,
    seasonLength: number,
    filters?: { periodFrom?: string; periodTo?: string },
  ): Promise<DecompositionResult> {
    const data = await this.queryMetricData(companyId, dataSource, metric, filters);
    if (data.length === 0) {
      throw new BusinessException(
        `No data found for ${dataSource}.${metric}`,
        HttpStatus.NOT_FOUND,
      );
    }
    return this.decompose(data, seasonLength);
  }

  // ─── Holt-Winters additive model ────────────────────────────────────────────

  private holtsWinters(
    data: number[],
    alpha: number,
    beta: number,
    gamma: number,
    seasonLength: number,
  ): { level: number; trend: number; seasonal: number[]; fitted: number[] } {
    const n = data.length;
    const sl = seasonLength;

    // Initialization
    // Level: average of first season
    let level = 0;
    for (let i = 0; i < Math.min(sl, n); i++) level += data[i];
    level /= Math.min(sl, n);

    // Trend: average change across first two seasons (if available)
    let trendVal = 0;
    if (n >= sl * 2) {
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < sl; i++) s1 += data[i];
      for (let i = sl; i < sl * 2; i++) s2 += data[i];
      trendVal = (s2 - s1) / (sl * sl);
    }

    // Seasonal: initialize with sl slots
    const seasonal = new Array(sl).fill(0);
    for (let i = 0; i < Math.min(sl, n); i++) {
      seasonal[i] = data[i] - level;
    }

    const fitted: number[] = [];

    // Smoothing
    for (let i = 0; i < n; i++) {
      const s = i % sl;
      const prevLevel = level;
      const prevTrend = trendVal;
      const prevSeasonal = seasonal[s];
      const value = data[i];

      level = alpha * (value - prevSeasonal) + (1 - alpha) * (prevLevel + prevTrend);
      trendVal = beta * (level - prevLevel) + (1 - beta) * prevTrend;
      seasonal[s] = gamma * (value - level) + (1 - gamma) * prevSeasonal;

      fitted.push(prevLevel + prevTrend + prevSeasonal);
    }

    return { level, trend: trendVal, seasonal, fitted };
  }

  // ─── Season detection ────────────────────────────────────────────────────────

  private detectSeasonLength(data: number[]): number {
    const candidates = [7, 12, 30];
    let bestSl = 12;
    let bestScore = Infinity;

    for (const sl of candidates) {
      if (data.length < sl * 2) continue;
      // Score = variance of seasonal residuals
      const pattern = new Array(sl).fill(0);
      const counts = new Array(sl).fill(0);
      for (let i = 0; i < data.length; i++) {
        pattern[i % sl] += data[i];
        counts[i % sl]++;
      }
      const avg = pattern.map((p, i) => (counts[i] > 0 ? p / counts[i] : 0));
      const residuals = data.map((v, i) => v - avg[i % sl]);
      const variance = this.variance(residuals);
      if (variance < bestScore) {
        bestScore = variance;
        bestSl = sl;
      }
    }

    return bestSl;
  }

  // ─── Centered moving average ─────────────────────────────────────────────────

  private centeredMovingAverage(
    data: number[],
    windowSize: number,
  ): (number | null)[] {
    const n = data.length;
    const result: (number | null)[] = new Array(n).fill(null);
    const half = Math.floor(windowSize / 2);

    for (let i = half; i < n - half; i++) {
      let sum = 0;
      for (let j = i - half; j <= i + half; j++) {
        sum += data[j];
      }
      result[i] = sum / (windowSize % 2 === 0 ? windowSize + 1 : windowSize);
    }

    return result;
  }

  // ─── Statistics helpers ──────────────────────────────────────────────────────

  private mean(arr: number[]): number {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  private variance(arr: number[]): number {
    const m = this.mean(arr);
    return arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
  }

  private stdDev(arr: number[]): number {
    return Math.sqrt(this.variance(arr));
  }

  // ─── Data query ─────────────────────────────────────────────────────────────

  private async queryMetricData(
    companyId: string,
    dataSource: string,
    metric: string,
    filters?: { periodFrom?: string; periodTo?: string },
  ): Promise<number[]> {
    const periodWhere: Record<string, string> = {};
    if (filters?.periodFrom) periodWhere['gte'] = filters.periodFrom;
    if (filters?.periodTo) periodWhere['lte'] = filters.periodTo;
    const periodFilter = Object.keys(periodWhere).length > 0 ? periodWhere : undefined;

    switch (dataSource) {
      case 'sales': {
        const rows = await this.prisma.factSalesDaily.findMany({
          where: { companyId, ...(periodFilter ? { period: periodFilter } : {}) },
          orderBy: { period: 'asc' },
        });
        return rows.map((r) => Number((r as Record<string, unknown>)[metric] ?? 0));
      }
      case 'inventory': {
        const rows = await this.prisma.factInventoryDaily.findMany({
          where: { companyId, ...(periodFilter ? { period: periodFilter } : {}) },
          orderBy: { period: 'asc' },
        });
        return rows.map((r) => Number((r as Record<string, unknown>)[metric] ?? 0));
      }
      case 'production': {
        const rows = await this.prisma.factProductionDaily.findMany({
          where: { companyId, ...(periodFilter ? { period: periodFilter } : {}) },
          orderBy: { period: 'asc' },
        });
        return rows.map((r) => Number((r as Record<string, unknown>)[metric] ?? 0));
      }
      case 'financial': {
        const rows = await this.prisma.factFinancialDaily.findMany({
          where: { companyId, ...(periodFilter ? { period: periodFilter } : {}) },
          orderBy: { period: 'asc' },
        });
        return rows.map((r) => Number((r as Record<string, unknown>)[metric] ?? 0));
      }
      default:
        throw new BusinessException(
          `Unknown dataSource: ${dataSource}`,
          HttpStatus.BAD_REQUEST,
        );
    }
  }
}
