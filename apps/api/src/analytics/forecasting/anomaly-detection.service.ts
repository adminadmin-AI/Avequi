import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/filters/business-exception.filter';

export interface AnomalyResult {
  index: number;
  value: number;
  expected: number;
  deviation: number;
  type: 'HIGH' | 'LOW';
  method: 'Z_SCORE' | 'IQR';
}

export interface TimeSeriesAnomalyResult {
  anomalies: AnomalyResult[];
  data: number[];
  summary: {
    totalPoints: number;
    anomalyCount: number;
    highCount: number;
    lowCount: number;
  };
}

@Injectable()
export class AnomalyDetectionService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Z-Score method ──────────────────────────────────────────────────────────

  detectZScore(data: number[], threshold = 2.5): AnomalyResult[] {
    if (data.length < 3) return [];

    const mean = this.mean(data);
    const std = this.stdDev(data);

    if (std === 0) return [];

    const anomalies: AnomalyResult[] = [];
    for (let i = 0; i < data.length; i++) {
      const z = (data[i] - mean) / std;
      if (Math.abs(z) > threshold) {
        anomalies.push({
          index: i,
          value: data[i],
          expected: mean,
          deviation: Math.abs(z),
          type: data[i] > mean ? 'HIGH' : 'LOW',
          method: 'Z_SCORE',
        });
      }
    }

    return anomalies;
  }

  // ─── IQR method ─────────────────────────────────────────────────────────────

  detectIQR(data: number[], multiplier = 1.5): AnomalyResult[] {
    if (data.length < 4) return [];

    const sorted = [...data].sort((a, b) => a - b);
    const n = sorted.length;

    const q1 = this.percentile(sorted, 25);
    const q3 = this.percentile(sorted, 75);
    const iqr = q3 - q1;
    const median = this.percentile(sorted, 50);

    const lowerFence = q1 - multiplier * iqr;
    const upperFence = q3 + multiplier * iqr;

    const anomalies: AnomalyResult[] = [];
    for (let i = 0; i < data.length; i++) {
      if (data[i] < lowerFence || data[i] > upperFence) {
        anomalies.push({
          index: i,
          value: data[i],
          expected: median,
          deviation: Math.abs(data[i] - median) / (iqr || 1),
          type: data[i] > upperFence ? 'HIGH' : 'LOW',
          method: 'IQR',
        });
      }
    }

    return anomalies;
  }

  // ─── Combined time-series detection ─────────────────────────────────────────

  async detectInTimeSeries(
    companyId: string,
    dataSource: string,
    metric: string,
    windowDays = 90,
    filters?: { periodFrom?: string; periodTo?: string },
  ): Promise<TimeSeriesAnomalyResult> {
    const data = await this.queryMetricData(companyId, dataSource, metric, windowDays, filters);

    if (data.length === 0) {
      throw new BusinessException(
        `No data found for ${dataSource}.${metric}`,
        HttpStatus.NOT_FOUND,
      );
    }

    const zAnomalies = this.detectZScore(data);
    const iqrAnomalies = this.detectIQR(data);

    // Merge, deduplicating by index (prefer Z_SCORE if both detect same point)
    const seen = new Set<number>();
    const anomalies: AnomalyResult[] = [];
    for (const a of [...zAnomalies, ...iqrAnomalies]) {
      if (!seen.has(a.index)) {
        seen.add(a.index);
        anomalies.push(a);
      }
    }

    anomalies.sort((a, b) => a.index - b.index);

    return {
      anomalies,
      data,
      summary: {
        totalPoints: data.length,
        anomalyCount: anomalies.length,
        highCount: anomalies.filter((a) => a.type === 'HIGH').length,
        lowCount: anomalies.filter((a) => a.type === 'LOW').length,
      },
    };
  }

  // ─── Alert rule checking ─────────────────────────────────────────────────────

  async checkAlertRules(companyId: string): Promise<void> {
    const rules = await this.prisma.alertRule.findMany({
      where: { companyId, isActive: true },
    });

    for (const rule of rules) {
      try {
        await this.evaluateRule(companyId, rule);
      } catch {
        // Continue checking other rules even if one fails
      }
    }
  }

  private async evaluateRule(
    companyId: string,
    rule: {
      id: string;
      metric: string;
      dataSource: string;
      operator: string;
      threshold: unknown;
      windowDays: number;
    },
  ): Promise<void> {
    const data = await this.queryMetricData(
      companyId,
      rule.dataSource,
      rule.metric,
      rule.windowDays,
    );

    if (data.length === 0) return;

    const currentValue = data[data.length - 1];
    const threshold = rule.threshold !== null ? Number(rule.threshold) : null;

    let triggered = false;
    let message = '';

    if (rule.operator === 'ANOMALY') {
      const anomalies = this.detectZScore(data);
      const lastAnomaly = anomalies.find((a) => a.index === data.length - 1);
      if (lastAnomaly) {
        triggered = true;
        message = `Anomaly detected in ${rule.dataSource}.${rule.metric}: value=${currentValue.toFixed(2)}, deviation=${lastAnomaly.deviation.toFixed(2)}σ`;
      }
    } else if (threshold !== null) {
      switch (rule.operator) {
        case 'GT':
          triggered = currentValue > threshold;
          break;
        case 'GTE':
          triggered = currentValue >= threshold;
          break;
        case 'LT':
          triggered = currentValue < threshold;
          break;
        case 'LTE':
          triggered = currentValue <= threshold;
          break;
      }
      if (triggered) {
        message = `Alert: ${rule.dataSource}.${rule.metric} = ${currentValue.toFixed(2)} ${rule.operator} ${threshold}`;
      }
    }

    if (triggered) {
      await this.prisma.alertTrigger.create({
        data: {
          alertRuleId: rule.id,
          companyId,
          value: currentValue,
          threshold: threshold ?? undefined,
          message,
        },
      });
    }
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

  private percentile(sorted: number[], p: number): number {
    const idx = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
  }

  // ─── Data query ─────────────────────────────────────────────────────────────

  private async queryMetricData(
    companyId: string,
    dataSource: string,
    metric: string,
    windowDays: number,
    filters?: { periodFrom?: string; periodTo?: string },
  ): Promise<number[]> {
    const fromDate = filters?.periodFrom
      ? filters.periodFrom
      : new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0];
    const toDate = filters?.periodTo
      ? filters.periodTo
      : new Date().toISOString().split('T')[0];

    const periodFilter = { gte: fromDate, lte: toDate };

    switch (dataSource) {
      case 'sales': {
        const rows = await this.prisma.factSalesDaily.findMany({
          where: { companyId, period: periodFilter },
          orderBy: { period: 'asc' },
        });
        return rows.map((r) => Number((r as Record<string, unknown>)[metric] ?? 0));
      }
      case 'inventory': {
        const rows = await this.prisma.factInventoryDaily.findMany({
          where: { companyId, period: periodFilter },
          orderBy: { period: 'asc' },
        });
        return rows.map((r) => Number((r as Record<string, unknown>)[metric] ?? 0));
      }
      case 'production': {
        const rows = await this.prisma.factProductionDaily.findMany({
          where: { companyId, period: periodFilter },
          orderBy: { period: 'asc' },
        });
        return rows.map((r) => Number((r as Record<string, unknown>)[metric] ?? 0));
      }
      case 'financial': {
        const rows = await this.prisma.factFinancialDaily.findMany({
          where: { companyId, period: periodFilter },
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
