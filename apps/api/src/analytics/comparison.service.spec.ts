import { Test, TestingModule } from '@nestjs/testing';
import { ComparisonService } from './comparison.service';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

const mockPrisma = {
  factSalesDaily: { findMany: jest.fn() },
  factProductionDaily: { findMany: jest.fn() },
  factFinancialDaily: { findMany: jest.fn() },
};

describe('ComparisonService', () => {
  let service: ComparisonService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComparisonService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ComparisonService>(ComparisonService);
    jest.clearAllMocks();
  });

  // ─── compare ──────────────────────────────────────────────────────────────

  describe('compare', () => {
    it('calculates variation and trend correctly (UP)', async () => {
      // current period: 1000, comparison: 800
      mockPrisma.factSalesDaily.findMany
        .mockResolvedValueOnce([{ revenue: 1000, quantity: 10, orderCount: 2 }]) // current
        .mockResolvedValueOnce([{ revenue: 800, quantity: 8, orderCount: 1 }]); // comparison

      const result = await service.compare('c1', 'revenue', '2025-02-01', '2025-01-01');

      expect(result.current.value).toBe(1000);
      expect(result.comparison.value).toBe(800);
      expect(result.variation).toBe(200);
      expect(result.variationPct).toBeCloseTo(25);
      expect(result.trend).toBe('UP');
    });

    it('calculates trend DOWN', async () => {
      mockPrisma.factSalesDaily.findMany
        .mockResolvedValueOnce([{ revenue: 700, quantity: 7, orderCount: 1 }])
        .mockResolvedValueOnce([{ revenue: 1000, quantity: 10, orderCount: 2 }]);

      const result = await service.compare('c1', 'revenue', '2025-02-01', '2025-01-01');

      expect(result.trend).toBe('DOWN');
      expect(result.variation).toBe(-300);
      expect(result.variationPct).toBeCloseTo(-30);
    });

    it('returns STABLE when change < 1%', async () => {
      mockPrisma.factSalesDaily.findMany
        .mockResolvedValueOnce([{ revenue: 1000, quantity: 10, orderCount: 1 }])
        .mockResolvedValueOnce([{ revenue: 1005, quantity: 10, orderCount: 1 }]);

      const result = await service.compare('c1', 'revenue', '2025-02-01', '2025-01-01');

      expect(result.trend).toBe('STABLE');
    });

    it('handles zero comparison value without division error', async () => {
      mockPrisma.factSalesDaily.findMany
        .mockResolvedValueOnce([{ revenue: 500, quantity: 5, orderCount: 1 }])
        .mockResolvedValueOnce([]);

      const result = await service.compare('c1', 'revenue', '2025-02-01', '2025-01-01');

      expect(result.comparison.value).toBe(0);
      expect(result.variationPct).toBe(0);
    });

    it('works for quantity metric', async () => {
      mockPrisma.factSalesDaily.findMany
        .mockResolvedValueOnce([{ revenue: 0, quantity: 20, orderCount: 1 }])
        .mockResolvedValueOnce([{ revenue: 0, quantity: 10, orderCount: 1 }]);

      const result = await service.compare('c1', 'quantity', '2025-02-01', '2025-01-01');

      expect(result.current.value).toBe(20);
      expect(result.variation).toBe(10);
    });

    it('works for orderCount metric', async () => {
      mockPrisma.factSalesDaily.findMany
        .mockResolvedValueOnce([{ revenue: 0, quantity: 0, orderCount: 5 }])
        .mockResolvedValueOnce([{ revenue: 0, quantity: 0, orderCount: 3 }]);

      const result = await service.compare('c1', 'orderCount', '2025-02-01', '2025-01-01');

      expect(result.current.value).toBe(5);
      expect(result.comparison.value).toBe(3);
    });

    it('works for productionCost metric', async () => {
      mockPrisma.factProductionDaily.findMany
        .mockResolvedValueOnce([{ totalCost: 5000 }])
        .mockResolvedValueOnce([{ totalCost: 4000 }]);

      const result = await service.compare('c1', 'productionCost', '2025-02-01', '2025-01-01');

      expect(result.current.value).toBe(5000);
      expect(result.trend).toBe('UP');
    });

    it('works for financialBalance metric', async () => {
      mockPrisma.factFinancialDaily.findMany
        .mockResolvedValueOnce([
          { type: 'REVENUE', amount: 10000 },
          { type: 'EXPENSE', amount: 3000 },
        ])
        .mockResolvedValueOnce([
          { type: 'REVENUE', amount: 8000 },
          { type: 'EXPENSE', amount: 4000 },
        ]);

      const result = await service.compare('c1', 'financialBalance', '2025-02-01', '2025-01-01');

      expect(result.current.value).toBe(7000); // 10000 - 3000
      expect(result.comparison.value).toBe(4000); // 8000 - 4000
    });
  });

  // ─── yoy ──────────────────────────────────────────────────────────────────

  describe('yoy', () => {
    it('returns 12 months of comparison data', async () => {
      // Mock 24 calls (12 months * 2 periods each)
      mockPrisma.factSalesDaily.findMany.mockResolvedValue([{ revenue: 1000, quantity: 10, orderCount: 1 }]);

      const result = await service.yoy('c1', 'revenue', 2025);

      expect(result).toHaveLength(12);
      expect(result[0].month).toBe('2025-01');
      expect(result[11].month).toBe('2025-12');
    });

    it('includes variation data for each month', async () => {
      mockPrisma.factSalesDaily.findMany
        .mockResolvedValueOnce([{ revenue: 1200, quantity: 12, orderCount: 2 }]) // 2025-01 current
        .mockResolvedValueOnce([{ revenue: 1000, quantity: 10, orderCount: 1 }]) // 2024-01 comparison
        .mockResolvedValue([{ revenue: 0, quantity: 0, orderCount: 0 }]);

      const result = await service.yoy('c1', 'revenue', 2025);

      expect(result[0].current.value).toBe(1200);
      expect(result[0].comparison.value).toBe(1000);
      expect(result[0].variation).toBe(200);
    });
  });

  // ─── mom ──────────────────────────────────────────────────────────────────

  describe('mom', () => {
    it('compares current month against previous month', async () => {
      mockPrisma.factSalesDaily.findMany
        .mockResolvedValueOnce([{ revenue: 1500, quantity: 15, orderCount: 3 }]) // Feb 2025
        .mockResolvedValueOnce([{ revenue: 1000, quantity: 10, orderCount: 2 }]); // Jan 2025

      const result = await service.mom('c1', 'revenue', '2025-02');

      expect(result.current.value).toBe(1500);
      expect(result.comparison.value).toBe(1000);
      expect(result.trend).toBe('UP');
    });

    it('wraps around to previous year for January', async () => {
      mockPrisma.factSalesDaily.findMany
        .mockResolvedValueOnce([{ revenue: 500, quantity: 5, orderCount: 1 }])
        .mockResolvedValueOnce([{ revenue: 600, quantity: 6, orderCount: 1 }]);

      const result = await service.mom('c1', 'revenue', '2025-01');

      // Comparison period should be Dec 2024
      expect(result.comparison.period).toMatch(/^2024-12/);
    });
  });

  // ─── ytd ──────────────────────────────────────────────────────────────────

  describe('ytd', () => {
    it('returns cumulative totals per month', async () => {
      // 12 months * 1 call each
      mockPrisma.factSalesDaily.findMany.mockResolvedValue([{ revenue: 1000, quantity: 10, orderCount: 1 }]);

      const result = await service.ytd('c1', 'revenue', 2025);

      expect(result).toHaveLength(12);
      expect(result[0].cumulative).toBe(1000);
      expect(result[1].cumulative).toBe(2000);
      expect(result[11].cumulative).toBe(12000);
    });
  });

  // ─── mtd ──────────────────────────────────────────────────────────────────

  describe('mtd', () => {
    it('returns value for current month range', async () => {
      mockPrisma.factSalesDaily.findMany.mockResolvedValue([{ revenue: 3000, quantity: 30, orderCount: 6 }]);

      const result = await service.mtd('c1', 'revenue', '2025-01');

      expect(result.month).toBe('2025-01');
      expect(result.from).toBe('2025-01-01');
      expect(result.value).toBe(3000);
    });
  });
});
