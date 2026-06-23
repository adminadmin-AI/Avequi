import { Injectable, HttpStatus } from '@nestjs/common';
import { BusinessException } from '../common/filters/business-exception.filter';
import { DashboardService } from './dashboard.service';
import { SalesCubeService } from './cubes/sales-cube.service';
import { InventoryCubeService } from './cubes/inventory-cube.service';
import { ProductionCubeService } from './cubes/production-cube.service';
import { FinancialCubeService } from './cubes/financial-cube.service';
import { WidgetType } from './dto/create-widget.dto';

export interface WidgetConfig {
  dataSource: 'sales' | 'inventory' | 'production' | 'financial';
  metric: string; // 'revenue' | 'quantity' | 'value' | 'cost' | 'balance' | etc.
  filters?: Record<string, any>;
  period?: { start: string; end: string };
  groupBy?: string;
  limit?: number;
  comparison?: 'yoy' | 'mom';
  // Gauge-specific
  target?: number;
  min?: number;
  max?: number;
}

export interface WidgetDataRequest {
  type: WidgetType;
  config: WidgetConfig;
}

export interface KpiResult {
  value: number;
  label: string;
  comparison?: { value: number; variation: number; variationPct: number; trend: 'UP' | 'DOWN' | 'STABLE' };
}

export interface ChartDataPoint {
  key: string;
  value: number;
  [extra: string]: unknown;
}

export interface TableResult {
  rows: Record<string, unknown>[];
  total: number;
}

export interface GaugeResult {
  value: number;
  min: number;
  max: number;
  target?: number;
  pct: number;
}

@Injectable()
export class WidgetDataService {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly salesCube: SalesCubeService,
    private readonly inventoryCube: InventoryCubeService,
    private readonly productionCube: ProductionCubeService,
    private readonly financialCube: FinancialCubeService,
  ) {}

  // ─── Public resolvers ────────────────────────────────────────────────────────

  async resolveWidget(companyId: string, widget: { type: string; config: Record<string, any> }) {
    const type = widget.type as WidgetType;
    const config = widget.config as WidgetConfig;

    switch (type) {
      case WidgetType.KPI_CARD:
        return this.resolveKpiCard(companyId, config);
      case WidgetType.LINE_CHART:
      case WidgetType.BAR_CHART:
      case WidgetType.PIE_CHART:
        return this.resolveChart(companyId, config);
      case WidgetType.TABLE:
        return this.resolveTable(companyId, config);
      case WidgetType.GAUGE:
        return this.resolveGauge(companyId, config);
      default:
        throw new BusinessException(`Unknown widget type: ${type}`, HttpStatus.BAD_REQUEST);
    }
  }

  /** Resolve all widgets in a dashboard in parallel. */
  async resolveDashboard(companyId: string, dashboardId: string, userId?: string) {
    const dashboard = await this.dashboardService.findOne(companyId, dashboardId, userId);

    const results = await Promise.allSettled(
      dashboard.widgets.map(async (widget) => ({
        widgetId: widget.id,
        title: widget.title,
        type: widget.type,
        data: await this.resolveWidget(companyId, {
          type: widget.type,
          config: widget.config as Record<string, any>,
        }),
      })),
    );

    return results.map((r) => {
      if (r.status === 'fulfilled') return r.value;
      return { error: (r.reason as Error)?.message ?? 'Unknown error' };
    });
  }

  async resolveKpiCard(companyId: string, config: WidgetConfig): Promise<KpiResult> {
    const filters = this.buildFilters(config);

    const currentValue = await this.fetchMetric(companyId, config, filters);

    let comparison: KpiResult['comparison'] | undefined;

    if (config.comparison) {
      const prevFilters = this.buildComparisonFilters(config);
      const prevValue = await this.fetchMetric(companyId, config, prevFilters);
      const variation = currentValue - prevValue;
      const variationPct = prevValue !== 0 ? (variation / prevValue) * 100 : 0;
      comparison = {
        value: prevValue,
        variation,
        variationPct,
        trend: variation > 0 ? 'UP' : variation < 0 ? 'DOWN' : 'STABLE',
      };
    }

    return {
      value: currentValue,
      label: this.metricLabel(config.metric),
      ...(comparison && { comparison }),
    };
  }

  async resolveChart(companyId: string, config: WidgetConfig): Promise<ChartDataPoint[]> {
    const filters = this.buildFilters(config);

    switch (config.dataSource) {
      case 'sales': {
        const data = await this.salesCube.query(companyId, filters);
        if (config.groupBy) {
          return this.salesCube
            .topN(companyId, config.groupBy as 'product' | 'customer' | 'region', config.limit ?? 100, filters)
            .then((rows) =>
              rows.map((r) => ({ key: r.key, value: this.pickSalesMetric(r, config.metric) })),
            );
        }
        return data.rows.map((r) => ({
          key: r.period,
          value: this.pickSalesMetric(r as any, config.metric),
        }));
      }

      case 'inventory': {
        const data = await this.inventoryCube.query(companyId, filters);
        return data.rows.map((r) => ({
          key: r.period,
          value: config.metric === 'quantity' ? Number(r.quantity) : Number(r.value),
        }));
      }

      case 'production': {
        const data = await this.productionCube.query(companyId, filters);
        return data.rows.map((r) => ({
          key: r.period,
          value: this.pickProductionMetric(r as any, config.metric),
        }));
      }

      case 'financial': {
        const data = await this.financialCube.cashFlow(companyId, filters);
        return data.map((r) => ({
          key: r.period,
          value: this.pickFinancialMetric(r, config.metric),
        }));
      }

      default:
        throw new BusinessException(`Unknown dataSource: ${config.dataSource}`, HttpStatus.BAD_REQUEST);
    }
  }

  async resolveTable(companyId: string, config: WidgetConfig): Promise<TableResult> {
    const filters = this.buildFilters(config);
    const limit = config.limit ?? 50;

    switch (config.dataSource) {
      case 'sales': {
        const data = await this.salesCube.query(companyId, filters);
        const rows = data.rows.slice(0, limit) as unknown as Record<string, unknown>[];
        return { rows, total: data.rows.length };
      }
      case 'inventory': {
        const data = await this.inventoryCube.query(companyId, filters);
        const rows = data.rows.slice(0, limit) as unknown as Record<string, unknown>[];
        return { rows, total: data.rows.length };
      }
      case 'production': {
        const data = await this.productionCube.query(companyId, filters);
        const rows = data.rows.slice(0, limit) as unknown as Record<string, unknown>[];
        return { rows, total: data.rows.length };
      }
      case 'financial': {
        const data = await this.financialCube.query(companyId, filters);
        const rows = data.rows.slice(0, limit) as unknown as Record<string, unknown>[];
        return { rows, total: data.rows.length };
      }
      default:
        throw new BusinessException(`Unknown dataSource: ${config.dataSource}`, HttpStatus.BAD_REQUEST);
    }
  }

  async resolveGauge(companyId: string, config: WidgetConfig): Promise<GaugeResult> {
    const filters = this.buildFilters(config);
    const value = await this.fetchMetric(companyId, config, filters);

    const min = config.min ?? 0;
    const max = config.max ?? (value * 1.5 || 100);
    const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;

    return {
      value,
      min,
      max,
      ...(config.target !== undefined && { target: config.target }),
      pct: Math.max(0, Math.min(100, pct)),
    };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async fetchMetric(companyId: string, config: WidgetConfig, filters: Record<string, any>) {
    switch (config.dataSource) {
      case 'sales': {
        const data = await this.salesCube.query(companyId, filters);
        return this.pickSalesMetric(data, config.metric);
      }
      case 'inventory': {
        const data = await this.inventoryCube.query(companyId, filters);
        return config.metric === 'quantity' ? data.quantity : data.value;
      }
      case 'production': {
        const data = await this.productionCube.query(companyId, filters);
        return this.pickProductionMetric(data, config.metric);
      }
      case 'financial': {
        const data = await this.financialCube.query(companyId, filters);
        return this.pickFinancialMetric(data, config.metric);
      }
      default:
        throw new BusinessException(`Unknown dataSource: ${config.dataSource}`, HttpStatus.BAD_REQUEST);
    }
  }

  private buildFilters(config: WidgetConfig): Record<string, any> {
    const filters: Record<string, any> = {};
    if (config.period?.start) filters.periodFrom = config.period.start;
    if (config.period?.end) filters.periodTo = config.period.end;
    if (config.filters) Object.assign(filters, config.filters);
    return filters;
  }

  private buildComparisonFilters(config: WidgetConfig): Record<string, any> {
    const filters: Record<string, any> = {};
    if (config.filters) Object.assign(filters, config.filters);

    if (!config.period?.start || !config.period?.end) return filters;

    const start = new Date(config.period.start);
    const end = new Date(config.period.end);

    if (config.comparison === 'yoy') {
      const prevStart = new Date(start);
      prevStart.setFullYear(prevStart.getFullYear() - 1);
      const prevEnd = new Date(end);
      prevEnd.setFullYear(prevEnd.getFullYear() - 1);
      filters.periodFrom = prevStart.toISOString().slice(0, 10);
      filters.periodTo = prevEnd.toISOString().slice(0, 10);
    } else if (config.comparison === 'mom') {
      const diffMs = end.getTime() - start.getTime();
      const prevEnd = new Date(start.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - diffMs);
      filters.periodFrom = prevStart.toISOString().slice(0, 10);
      filters.periodTo = prevEnd.toISOString().slice(0, 10);
    }

    return filters;
  }

  private pickSalesMetric(data: Record<string, any>, metric: string): number {
    switch (metric) {
      case 'quantity':
        return Number(data.quantity ?? 0);
      case 'orderCount':
        return Number(data.orderCount ?? 0);
      case 'avgTicket':
        return Number(data.avgTicket ?? 0);
      case 'revenue':
      default:
        return Number(data.revenue ?? 0);
    }
  }

  private pickProductionMetric(data: Record<string, any>, metric: string): number {
    switch (metric) {
      case 'materialCost':
        return Number(data.materialCost ?? 0);
      case 'laborCost':
        return Number(data.laborCost ?? 0);
      case 'quantity':
        return Number(data.quantity ?? 0);
      case 'orderCount':
        return Number(data.orderCount ?? 0);
      case 'cost':
      case 'totalCost':
      default:
        return Number(data.totalCost ?? 0);
    }
  }

  private pickFinancialMetric(data: Record<string, any>, metric: string): number {
    switch (metric) {
      case 'revenue':
        return Number(data.revenue ?? 0);
      case 'expense':
        return Number(data.expense ?? 0);
      case 'balance':
      default:
        return Number(data.balance ?? 0);
    }
  }

  private metricLabel(metric: string): string {
    const labels: Record<string, string> = {
      revenue: 'Receita',
      quantity: 'Quantidade',
      orderCount: 'Pedidos',
      avgTicket: 'Ticket Médio',
      value: 'Valor em Estoque',
      cost: 'Custo Total',
      totalCost: 'Custo Total',
      materialCost: 'Custo de Material',
      laborCost: 'Custo de Mão de Obra',
      balance: 'Saldo',
      expense: 'Despesa',
    };
    return labels[metric] ?? metric;
  }
}
