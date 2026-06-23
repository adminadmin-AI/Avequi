import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { WidgetDataService } from './widget-data.service';
import { DashboardService } from './dashboard.service';
import { SalesCubeService } from './cubes/sales-cube.service';
import { InventoryCubeService } from './cubes/inventory-cube.service';
import { ProductionCubeService } from './cubes/production-cube.service';
import { FinancialCubeService } from './cubes/financial-cube.service';
import { BusinessException } from '../common/filters/business-exception.filter';
import { WidgetType } from './dto/create-widget.dto';

const COMPANY = 'company-1';
const DASH_ID = 'dash-1';
const USER_A = 'user-a';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDashboardService = {
  findOne: jest.fn(),
  findWidgets: jest.fn(),
};

const mockSalesCube = {
  query: jest.fn(),
  topN: jest.fn(),
};

const mockInventoryCube = {
  query: jest.fn(),
};

const mockProductionCube = {
  query: jest.fn(),
};

const mockFinancialCube = {
  query: jest.fn(),
  cashFlow: jest.fn(),
};

// ─── Sample data ─────────────────────────────────────────────────────────────

const salesData = {
  revenue: 50000,
  quantity: 100,
  orderCount: 10,
  avgTicket: 5000,
  rows: [
    { period: '2026-01-01', revenue: 30000, quantity: 60, orderCount: 6 },
    { period: '2026-01-02', revenue: 20000, quantity: 40, orderCount: 4 },
  ],
};

const inventoryData = {
  quantity: 500,
  value: 75000,
  rows: [
    { period: '2026-01-01', quantity: 500, value: 75000 },
  ],
};

const productionData = {
  quantity: 200,
  materialCost: 15000,
  laborCost: 5000,
  totalCost: 20000,
  orderCount: 8,
  rows: [
    { period: '2026-01-01', quantity: 200, materialCost: 15000, laborCost: 5000, totalCost: 20000, orderCount: 8 },
  ],
};

const financialData = {
  revenue: 80000,
  expense: 30000,
  balance: 50000,
  count: 20,
  rows: [
    { period: '2026-01-01', type: 'REVENUE', amount: 80000, count: 15 },
    { period: '2026-01-01', type: 'EXPENSE', amount: 30000, count: 5 },
  ],
};

const cashFlowData = [
  { period: '2026-01-01', revenue: 80000, expense: 30000, balance: 50000 },
];

describe('WidgetDataService', () => {
  let service: WidgetDataService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WidgetDataService,
        { provide: DashboardService, useValue: mockDashboardService },
        { provide: SalesCubeService, useValue: mockSalesCube },
        { provide: InventoryCubeService, useValue: mockInventoryCube },
        { provide: ProductionCubeService, useValue: mockProductionCube },
        { provide: FinancialCubeService, useValue: mockFinancialCube },
      ],
    }).compile();

    service = module.get<WidgetDataService>(WidgetDataService);
    jest.clearAllMocks();

    // Default happy-path mocks
    mockSalesCube.query.mockResolvedValue(salesData);
    mockSalesCube.topN.mockResolvedValue([{ key: 'prod-1', revenue: 30000, quantity: 60, orderCount: 6 }]);
    mockInventoryCube.query.mockResolvedValue(inventoryData);
    mockProductionCube.query.mockResolvedValue(productionData);
    mockFinancialCube.query.mockResolvedValue(financialData);
    mockFinancialCube.cashFlow.mockResolvedValue(cashFlowData);
  });

  // ─── resolveKpiCard ────────────────────────────────────────────────────────

  describe('resolveKpiCard', () => {
    it('returns revenue KPI from sales data source', async () => {
      const result = await service.resolveKpiCard(COMPANY, {
        dataSource: 'sales',
        metric: 'revenue',
        period: { start: '2026-01-01', end: '2026-01-31' },
      });

      expect(result.value).toBe(50000);
      expect(result.label).toBe('Receita');
      expect(result.comparison).toBeUndefined();
    });

    it('returns quantity KPI from inventory', async () => {
      const result = await service.resolveKpiCard(COMPANY, {
        dataSource: 'inventory',
        metric: 'quantity',
      });

      expect(result.value).toBe(500);
    });

    it('returns value KPI from inventory', async () => {
      const result = await service.resolveKpiCard(COMPANY, {
        dataSource: 'inventory',
        metric: 'value',
      });

      expect(result.value).toBe(75000);
    });

    it('returns totalCost KPI from production', async () => {
      const result = await service.resolveKpiCard(COMPANY, {
        dataSource: 'production',
        metric: 'totalCost',
      });

      expect(result.value).toBe(20000);
    });

    it('returns balance KPI from financial', async () => {
      const result = await service.resolveKpiCard(COMPANY, {
        dataSource: 'financial',
        metric: 'balance',
      });

      expect(result.value).toBe(50000);
    });

    it('includes YoY comparison when requested', async () => {
      // First call = current, second = comparison
      mockSalesCube.query
        .mockResolvedValueOnce({ ...salesData, revenue: 50000 })
        .mockResolvedValueOnce({ ...salesData, revenue: 40000 });

      const result = await service.resolveKpiCard(COMPANY, {
        dataSource: 'sales',
        metric: 'revenue',
        period: { start: '2026-01-01', end: '2026-01-31' },
        comparison: 'yoy',
      });

      expect(result.value).toBe(50000);
      expect(result.comparison).toBeDefined();
      expect(result.comparison!.value).toBe(40000);
      expect(result.comparison!.variation).toBe(10000);
      expect(result.comparison!.trend).toBe('UP');
    });

    it('marks trend as DOWN when current < previous', async () => {
      mockSalesCube.query
        .mockResolvedValueOnce({ ...salesData, revenue: 30000 })
        .mockResolvedValueOnce({ ...salesData, revenue: 50000 });

      const result = await service.resolveKpiCard(COMPANY, {
        dataSource: 'sales',
        metric: 'revenue',
        period: { start: '2026-01-01', end: '2026-01-31' },
        comparison: 'mom',
      });

      expect(result.comparison!.trend).toBe('DOWN');
    });

    it('marks trend as STABLE when values are equal', async () => {
      mockSalesCube.query.mockResolvedValue({ ...salesData, revenue: 50000 });

      const result = await service.resolveKpiCard(COMPANY, {
        dataSource: 'sales',
        metric: 'revenue',
        period: { start: '2026-01-01', end: '2026-01-31' },
        comparison: 'yoy',
      });

      expect(result.comparison!.trend).toBe('STABLE');
    });
  });

  // ─── resolveChart ──────────────────────────────────────────────────────────

  describe('resolveChart', () => {
    it('returns time-series chart data for sales', async () => {
      const result = await service.resolveChart(COMPANY, {
        dataSource: 'sales',
        metric: 'revenue',
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ key: '2026-01-01', value: 30000 });
    });

    it('returns topN grouped data when groupBy is set', async () => {
      const result = await service.resolveChart(COMPANY, {
        dataSource: 'sales',
        metric: 'revenue',
        groupBy: 'product',
        limit: 5,
      });

      expect(mockSalesCube.topN).toHaveBeenCalledWith(COMPANY, 'product', 5, expect.any(Object));
      expect(result[0]).toMatchObject({ key: 'prod-1', value: 30000 });
    });

    it('returns chart data for inventory', async () => {
      const result = await service.resolveChart(COMPANY, {
        dataSource: 'inventory',
        metric: 'value',
      });

      expect(result[0]).toMatchObject({ key: '2026-01-01', value: 75000 });
    });

    it('returns chart data for production totalCost', async () => {
      const result = await service.resolveChart(COMPANY, {
        dataSource: 'production',
        metric: 'totalCost',
      });

      expect(result[0]).toMatchObject({ key: '2026-01-01', value: 20000 });
    });

    it('returns cash-flow chart for financial balance', async () => {
      const result = await service.resolveChart(COMPANY, {
        dataSource: 'financial',
        metric: 'balance',
      });

      expect(result[0]).toMatchObject({ key: '2026-01-01', value: 50000 });
    });

    it('throws BusinessException for unknown dataSource', async () => {
      await expect(
        service.resolveChart(COMPANY, { dataSource: 'unknown' as any, metric: 'revenue' }),
      ).rejects.toThrow(BusinessException);
    });
  });

  // ─── resolveTable ──────────────────────────────────────────────────────────

  describe('resolveTable', () => {
    it('returns paginated rows for sales', async () => {
      const result = await service.resolveTable(COMPANY, {
        dataSource: 'sales',
        metric: 'revenue',
        limit: 10,
      });

      expect(result.rows).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('respects limit parameter', async () => {
      const manyRows = Array.from({ length: 100 }, (_, i) => ({
        period: `2026-01-${String(i + 1).padStart(2, '0')}`,
        revenue: 1000,
        quantity: 10,
        orderCount: 1,
      }));
      mockSalesCube.query.mockResolvedValue({ ...salesData, rows: manyRows });

      const result = await service.resolveTable(COMPANY, {
        dataSource: 'sales',
        metric: 'revenue',
        limit: 5,
      });

      expect(result.rows).toHaveLength(5);
      expect(result.total).toBe(100);
    });

    it('returns table for inventory', async () => {
      const result = await service.resolveTable(COMPANY, {
        dataSource: 'inventory',
        metric: 'value',
      });

      expect(result.rows).toHaveLength(1);
    });

    it('returns table for production', async () => {
      const result = await service.resolveTable(COMPANY, {
        dataSource: 'production',
        metric: 'totalCost',
      });

      expect(result.rows).toHaveLength(1);
    });

    it('returns table for financial', async () => {
      const result = await service.resolveTable(COMPANY, {
        dataSource: 'financial',
        metric: 'balance',
      });

      expect(result.rows).toHaveLength(2);
    });
  });

  // ─── resolveGauge ──────────────────────────────────────────────────────────

  describe('resolveGauge', () => {
    it('calculates pct correctly', async () => {
      const result = await service.resolveGauge(COMPANY, {
        dataSource: 'sales',
        metric: 'revenue',
        min: 0,
        max: 100000,
        target: 60000,
      });

      expect(result.value).toBe(50000);
      expect(result.min).toBe(0);
      expect(result.max).toBe(100000);
      expect(result.target).toBe(60000);
      expect(result.pct).toBe(50);
    });

    it('clamps pct to 0-100 range', async () => {
      mockSalesCube.query.mockResolvedValue({ ...salesData, revenue: 200000 });

      const result = await service.resolveGauge(COMPANY, {
        dataSource: 'sales',
        metric: 'revenue',
        min: 0,
        max: 100000,
      });

      expect(result.pct).toBe(100);
    });

    it('uses 1.5x value as default max when max not provided', async () => {
      const result = await service.resolveGauge(COMPANY, {
        dataSource: 'sales',
        metric: 'revenue',
      });

      expect(result.max).toBe(75000); // 50000 * 1.5
      expect(result.pct).toBeCloseTo(66.67, 1);
    });
  });

  // ─── resolveWidget dispatch ────────────────────────────────────────────────

  describe('resolveWidget', () => {
    it('dispatches to resolveKpiCard for KPI_CARD', async () => {
      const spy = jest.spyOn(service, 'resolveKpiCard');
      mockSalesCube.query.mockResolvedValue(salesData);

      await service.resolveWidget(COMPANY, {
        type: WidgetType.KPI_CARD,
        config: { dataSource: 'sales', metric: 'revenue' } as any,
      });

      expect(spy).toHaveBeenCalled();
    });

    it('dispatches to resolveChart for LINE_CHART', async () => {
      const spy = jest.spyOn(service, 'resolveChart');

      await service.resolveWidget(COMPANY, {
        type: WidgetType.LINE_CHART,
        config: { dataSource: 'sales', metric: 'revenue' } as any,
      });

      expect(spy).toHaveBeenCalled();
    });

    it('dispatches to resolveChart for BAR_CHART', async () => {
      const spy = jest.spyOn(service, 'resolveChart');

      await service.resolveWidget(COMPANY, {
        type: WidgetType.BAR_CHART,
        config: { dataSource: 'financial', metric: 'balance' } as any,
      });

      expect(spy).toHaveBeenCalled();
    });

    it('dispatches to resolveChart for PIE_CHART', async () => {
      const spy = jest.spyOn(service, 'resolveChart');

      await service.resolveWidget(COMPANY, {
        type: WidgetType.PIE_CHART,
        config: { dataSource: 'sales', metric: 'quantity' } as any,
      });

      expect(spy).toHaveBeenCalled();
    });

    it('dispatches to resolveTable for TABLE', async () => {
      const spy = jest.spyOn(service, 'resolveTable');

      await service.resolveWidget(COMPANY, {
        type: WidgetType.TABLE,
        config: { dataSource: 'sales', metric: 'revenue' } as any,
      });

      expect(spy).toHaveBeenCalled();
    });

    it('dispatches to resolveGauge for GAUGE', async () => {
      const spy = jest.spyOn(service, 'resolveGauge');

      await service.resolveWidget(COMPANY, {
        type: WidgetType.GAUGE,
        config: { dataSource: 'sales', metric: 'revenue', min: 0, max: 100000 } as any,
      });

      expect(spy).toHaveBeenCalled();
    });

    it('throws BusinessException for unknown widget type', async () => {
      await expect(
        service.resolveWidget(COMPANY, { type: 'UNKNOWN' as any, config: {} as any }),
      ).rejects.toThrow(BusinessException);
    });
  });

  // ─── resolveDashboard ──────────────────────────────────────────────────────

  describe('resolveDashboard', () => {
    it('resolves all widgets in parallel and returns results', async () => {
      const dashboard = {
        id: DASH_ID,
        companyId: COMPANY,
        userId: USER_A,
        name: 'Test',
        isShared: false,
        widgets: [
          {
            id: 'w1',
            type: 'KPI_CARD',
            title: 'Receita',
            config: { dataSource: 'sales', metric: 'revenue' },
          },
          {
            id: 'w2',
            type: 'TABLE',
            title: 'Detalhes',
            config: { dataSource: 'inventory', metric: 'value' },
          },
        ],
      };
      mockDashboardService.findOne.mockResolvedValue(dashboard);

      const results = await service.resolveDashboard(COMPANY, DASH_ID, USER_A);

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ widgetId: 'w1', title: 'Receita', type: 'KPI_CARD' });
      expect(results[1]).toMatchObject({ widgetId: 'w2', title: 'Detalhes', type: 'TABLE' });
    });

    it('returns error objects for failed widgets without crashing', async () => {
      const dashboard = {
        id: DASH_ID,
        companyId: COMPANY,
        userId: USER_A,
        name: 'Test',
        isShared: false,
        widgets: [
          {
            id: 'w-bad',
            type: 'KPI_CARD',
            title: 'Quebrado',
            config: { dataSource: 'unknown', metric: 'revenue' },
          },
        ],
      };
      mockDashboardService.findOne.mockResolvedValue(dashboard);

      const results = await service.resolveDashboard(COMPANY, DASH_ID, USER_A);

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ error: expect.any(String) });
    });
  });
});
