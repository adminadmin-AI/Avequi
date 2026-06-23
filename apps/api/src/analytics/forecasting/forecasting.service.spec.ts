import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { ForecastingService } from './forecasting.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/filters/business-exception.filter';

const mockPrisma = {
  factSalesDaily: { findMany: jest.fn() },
  factInventoryDaily: { findMany: jest.fn() },
  factProductionDaily: { findMany: jest.fn() },
  factFinancialDaily: { findMany: jest.fn() },
};

// Generate synthetic seasonal data
function makeSineSeries(n: number, period = 12, amplitude = 100, base = 500): number[] {
  return Array.from({ length: n }, (_, i) =>
    base + amplitude * Math.sin((2 * Math.PI * i) / period) + Math.random() * 5,
  );
}

describe('ForecastingService', () => {
  let service: ForecastingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ForecastingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ForecastingService>(ForecastingService);
    jest.clearAllMocks();
  });

  // ─── forecast() ────────────────────────────────────────────────────────────

  describe('forecast()', () => {
    it('returns the correct number of forecast points', () => {
      const data = makeSineSeries(36, 12);
      const result = service.forecast(data, 6, 12);
      expect(result.forecasts).toHaveLength(6);
    });

    it('returns ForecastResult shape', () => {
      const data = makeSineSeries(24, 12);
      const result = service.forecast(data, 3, 12);
      expect(result).toHaveProperty('forecasts');
      expect(result).toHaveProperty('decomposition');
      expect(result).toHaveProperty('parameters');
      expect(result.parameters).toEqual(
        expect.objectContaining({ alpha: 0.3, beta: 0.1, gamma: 0.1 }),
      );
    });

    it('each forecast point has required CI fields', () => {
      const data = makeSineSeries(24, 12);
      const result = service.forecast(data, 3, 12);
      for (const pt of result.forecasts) {
        expect(pt).toHaveProperty('period');
        expect(pt).toHaveProperty('value');
        expect(pt).toHaveProperty('lower80');
        expect(pt).toHaveProperty('upper80');
        expect(pt).toHaveProperty('lower95');
        expect(pt).toHaveProperty('upper95');
      }
    });

    it('80% CI is narrower than 95% CI', () => {
      const data = makeSineSeries(36, 12);
      const result = service.forecast(data, 6, 12);
      for (const pt of result.forecasts) {
        const width80 = pt.upper80 - pt.lower80;
        const width95 = pt.upper95 - pt.lower95;
        expect(width80).toBeLessThan(width95);
      }
    });

    it('CI widens over forecast horizon', () => {
      const data = makeSineSeries(36, 12);
      const result = service.forecast(data, 6, 12);
      const widths = result.forecasts.map((pt) => pt.upper95 - pt.lower95);
      // Check that each width is >= previous (non-decreasing)
      for (let i = 1; i < widths.length; i++) {
        expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1] - 1e-9);
      }
    });

    it('lower bounds are non-negative', () => {
      const data = makeSineSeries(24, 12, 50, 200);
      const result = service.forecast(data, 6, 12);
      for (const pt of result.forecasts) {
        expect(pt.lower80).toBeGreaterThanOrEqual(0);
        expect(pt.lower95).toBeGreaterThanOrEqual(0);
      }
    });

    it('auto-detects season length when not provided', () => {
      const data = makeSineSeries(36, 12);
      const result = service.forecast(data, 3);
      expect(result.parameters.seasonLength).toBeGreaterThan(0);
    });

    it('throws BusinessException for series shorter than 4 points', () => {
      expect(() => service.forecast([1, 2, 3], 3, 12)).toThrow(BusinessException);
    });

    it('handles exactly 4 data points (minimum)', () => {
      const result = service.forecast([10, 20, 15, 25], 2, 2);
      expect(result.forecasts).toHaveLength(2);
    });

    it('forecast values are finite numbers', () => {
      const data = makeSineSeries(24, 12);
      const result = service.forecast(data, 6, 12);
      for (const pt of result.forecasts) {
        expect(Number.isFinite(pt.value)).toBe(true);
        expect(Number.isFinite(pt.lower80)).toBe(true);
        expect(Number.isFinite(pt.upper80)).toBe(true);
      }
    });
  });

  // ─── decompose() ───────────────────────────────────────────────────────────

  describe('decompose()', () => {
    it('returns trend, seasonal, residual arrays of same length', () => {
      const data = makeSineSeries(36, 12);
      const result = service.decompose(data, 12);
      expect(result.trend).toHaveLength(data.length);
      expect(result.seasonal).toHaveLength(data.length);
      expect(result.residual).toHaveLength(data.length);
    });

    it('seasonal pattern repeats with seasonLength period', () => {
      const data = makeSineSeries(36, 12, 200, 1000);
      const result = service.decompose(data, 12);
      // Same position 12 apart should have same seasonal value
      expect(result.seasonal[0]).toBeCloseTo(result.seasonal[12], 5);
      expect(result.seasonal[1]).toBeCloseTo(result.seasonal[13], 5);
    });

    it('falls back gracefully when data is too short for proper decomposition', () => {
      const data = [10, 20, 15, 25, 30, 20];
      const result = service.decompose(data, 12); // seasonLength > data.length/2
      expect(result.trend).toHaveLength(6);
      expect(result.seasonal.every((v) => v === 0)).toBe(true);
    });

    it('residuals are small for clean sine series', () => {
      const data = Array.from({ length: 36 }, (_, i) =>
        1000 + 200 * Math.sin((2 * Math.PI * i) / 12),
      );
      const result = service.decompose(data, 12);
      const rms = Math.sqrt(
        result.residual.reduce((s, v) => s + v * v, 0) / result.residual.length,
      );
      // RMS of residuals should be small relative to amplitude
      expect(rms).toBeLessThan(100);
    });
  });

  // ─── forecastMetric() ──────────────────────────────────────────────────────

  describe('forecastMetric()', () => {
    it('calls prisma for sales data source', async () => {
      const rows = makeSineSeries(24, 12).map((revenue, i) => ({
        id: `f${i}`,
        companyId: 'c1',
        period: `2026-01-${String(i + 1).padStart(2, '0')}`,
        revenue,
        quantity: 10,
        orderCount: 1,
        createdAt: new Date(),
      }));
      mockPrisma.factSalesDaily.findMany.mockResolvedValue(rows);

      const result = await service.forecastMetric('c1', 'sales', 'revenue', 3);
      expect(mockPrisma.factSalesDaily.findMany).toHaveBeenCalled();
      expect(result.forecasts).toHaveLength(3);
    });

    it('throws NOT_FOUND when no data is returned', async () => {
      mockPrisma.factSalesDaily.findMany.mockResolvedValue([]);
      await expect(
        service.forecastMetric('c1', 'sales', 'revenue', 3),
      ).rejects.toThrow(BusinessException);
    });

    it('throws BAD_REQUEST for unknown dataSource', async () => {
      await expect(
        service.forecastMetric('c1', 'unknown_source', 'revenue', 3),
      ).rejects.toThrow(BusinessException);
    });

    it('passes filters to prisma query', async () => {
      const rows = makeSineSeries(12, 12).map((revenue, i) => ({
        id: `f${i}`,
        companyId: 'c1',
        period: `2026-0${(i % 9) + 1}-01`,
        revenue,
        quantity: 5,
        orderCount: 1,
        createdAt: new Date(),
      }));
      mockPrisma.factSalesDaily.findMany.mockResolvedValue(rows);

      await service.forecastMetric('c1', 'sales', 'revenue', 2, {
        periodFrom: '2026-01-01',
        periodTo: '2026-12-31',
      });

      const call = mockPrisma.factSalesDaily.findMany.mock.calls[0][0];
      expect(call.where).toMatchObject({ companyId: 'c1' });
    });
  });
});
