import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

export type Metric = 'revenue' | 'quantity' | 'orderCount' | 'productionCost' | 'financialBalance';

export interface ComparisonResult {
  current: { period: string; value: number };
  comparison: { period: string; value: number };
  variation: number;
  variationPct: number;
  trend: 'UP' | 'DOWN' | 'STABLE';
}

export interface MetricFilters {
  productId?: string;
  customerId?: string;
  warehouseId?: string;
}

@Injectable()
export class ComparisonService {
  constructor(private readonly prisma: PrismaService) {}

  async compare(
    companyId: string,
    metric: Metric,
    currentPeriod: string,
    comparisonPeriod: string,
    filters: MetricFilters = {},
  ): Promise<ComparisonResult> {
    const [currentValue, comparisonValue] = await Promise.all([
      this.getMetricValue(companyId, metric, currentPeriod, currentPeriod, filters),
      this.getMetricValue(companyId, metric, comparisonPeriod, comparisonPeriod, filters),
    ]);

    return this.buildResult(currentPeriod, currentValue, comparisonPeriod, comparisonValue);
  }

  /** Year-over-year: compare each month of `year` against same month of `year - 1` */
  async yoy(companyId: string, metric: Metric, year: number, filters: MetricFilters = {}) {
    const results: Array<{ month: string } & ComparisonResult> = [];

    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      const currentFrom = `${year}-${mm}-01`;
      const currentTo = this.lastDayOfMonth(year, m);
      const prevFrom = `${year - 1}-${mm}-01`;
      const prevTo = this.lastDayOfMonth(year - 1, m);

      const [current, prev] = await Promise.all([
        this.getMetricValue(companyId, metric, currentFrom, currentTo, filters),
        this.getMetricValue(companyId, metric, prevFrom, prevTo, filters),
      ]);

      results.push({
        month: `${year}-${mm}`,
        ...this.buildResult(currentFrom, current, prevFrom, prev),
      });
    }

    return results;
  }

  /** Month-over-month: compare `month` (YYYY-MM) against the previous month */
  async mom(companyId: string, metric: Metric, month: string, filters: MetricFilters = {}) {
    const [year, m] = month.split('-').map(Number);
    const prevYear = m === 1 ? year - 1 : year;
    const prevMonth = m === 1 ? 12 : m - 1;
    const prevMM = String(prevMonth).padStart(2, '0');
    const mm = String(m).padStart(2, '0');

    const currentFrom = `${year}-${mm}-01`;
    const currentTo = this.lastDayOfMonth(year, m);
    const prevFrom = `${prevYear}-${prevMM}-01`;
    const prevTo = this.lastDayOfMonth(prevYear, prevMonth);

    const [current, prev] = await Promise.all([
      this.getMetricValue(companyId, metric, currentFrom, currentTo, filters),
      this.getMetricValue(companyId, metric, prevFrom, prevTo, filters),
    ]);

    return this.buildResult(currentFrom, current, prevFrom, prev);
  }

  /** Year-to-date accumulation: cumulative value from Jan 1 to each month of `year` */
  async ytd(companyId: string, metric: Metric, year: number, filters: MetricFilters = {}) {
    const results: Array<{ throughMonth: string; cumulative: number }> = [];
    let cumulative = 0;

    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      const from = `${year}-${mm}-01`;
      const to = this.lastDayOfMonth(year, m);

      const value = await this.getMetricValue(companyId, metric, from, to, filters);
      cumulative += value;

      results.push({ throughMonth: `${year}-${mm}`, cumulative });
    }

    return results;
  }

  /** Month-to-date: return daily values from the 1st of `month` to today */
  async mtd(companyId: string, metric: Metric, month: string, filters: MetricFilters = {}) {
    const [year, m] = month.split('-').map(Number);
    const mm = String(m).padStart(2, '0');
    const today = new Date().toISOString().slice(0, 10);
    const from = `${year}-${mm}-01`;
    const to = today < this.lastDayOfMonth(year, m) ? today : this.lastDayOfMonth(year, m);

    const value = await this.getMetricValue(companyId, metric, from, to, filters);
    return { month, from, to, value };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async getMetricValue(
    companyId: string,
    metric: Metric,
    periodFrom: string,
    periodTo: string,
    filters: MetricFilters,
  ): Promise<number> {
    const periodWhere = { gte: periodFrom, lte: periodTo };

    switch (metric) {
      case 'revenue': {
        const rows = await this.prisma.factSalesDaily.findMany({
          where: {
            companyId,
            period: periodWhere,
            ...(filters.productId ? { productId: filters.productId } : {}),
            ...(filters.customerId ? { customerId: filters.customerId } : {}),
          },
        });
        return rows.reduce((acc, r) => acc + Number(r.revenue), 0);
      }

      case 'quantity': {
        const rows = await this.prisma.factSalesDaily.findMany({
          where: {
            companyId,
            period: periodWhere,
            ...(filters.productId ? { productId: filters.productId } : {}),
          },
        });
        return rows.reduce((acc, r) => acc + Number(r.quantity), 0);
      }

      case 'orderCount': {
        const rows = await this.prisma.factSalesDaily.findMany({
          where: { companyId, period: periodWhere },
        });
        return rows.reduce((acc, r) => acc + r.orderCount, 0);
      }

      case 'productionCost': {
        const rows = await this.prisma.factProductionDaily.findMany({
          where: {
            companyId,
            period: periodWhere,
            ...(filters.productId ? { productId: filters.productId } : {}),
          },
        });
        return rows.reduce((acc, r) => acc + Number(r.totalCost), 0);
      }

      case 'financialBalance': {
        const rows = await this.prisma.factFinancialDaily.findMany({
          where: {
            companyId,
            period: periodWhere,
            ...(filters.warehouseId ? {} : {}),
          },
        });
        return rows.reduce(
          (acc, r) => acc + (r.type === 'REVENUE' ? Number(r.amount) : -Number(r.amount)),
          0,
        );
      }

      default:
        throw new BusinessException(`Unknown metric: ${metric as string}`, HttpStatus.BAD_REQUEST);
    }
  }

  private buildResult(
    currentPeriod: string,
    currentValue: number,
    comparisonPeriod: string,
    comparisonValue: number,
  ): ComparisonResult {
    const variation = currentValue - comparisonValue;
    const variationPct = comparisonValue !== 0 ? (variation / Math.abs(comparisonValue)) * 100 : 0;
    const trend: 'UP' | 'DOWN' | 'STABLE' =
      Math.abs(variationPct) < 1 ? 'STABLE' : variationPct > 0 ? 'UP' : 'DOWN';

    return {
      current: { period: currentPeriod, value: currentValue },
      comparison: { period: comparisonPeriod, value: comparisonValue },
      variation,
      variationPct,
      trend,
    };
  }

  private lastDayOfMonth(year: number, month: number): string {
    const d = new Date(year, month, 0); // day 0 of next month = last day of this month
    return d.toISOString().slice(0, 10);
  }
}
