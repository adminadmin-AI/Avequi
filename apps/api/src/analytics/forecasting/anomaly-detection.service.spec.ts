import { Test, TestingModule } from '@nestjs/testing';
import { AnomalyDetectionService } from './anomaly-detection.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/filters/business-exception.filter';

const mockPrisma = {
  factSalesDaily: { findMany: jest.fn() },
  factInventoryDaily: { findMany: jest.fn() },
  factProductionDaily: { findMany: jest.fn() },
  factFinancialDaily: { findMany: jest.fn() },
  alertRule: { findMany: jest.fn() },
  alertTrigger: { create: jest.fn() },
};

// Normal data with one obvious outlier
function makeDataWithOutlier(): number[] {
  const base = Array.from({ length: 29 }, () => 100 + Math.random() * 5);
  return [...base, 500]; // 500 is a clear outlier
}

describe('AnomalyDetectionService', () => {
  let service: AnomalyDetectionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnomalyDetectionService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AnomalyDetectionService>(AnomalyDetectionService);
    jest.clearAllMocks();
  });

  // ─── detectZScore() ────────────────────────────────────────────────────────

  describe('detectZScore()', () => {
    it('detects a clear high outlier', () => {
      const data = makeDataWithOutlier();
      const results = service.detectZScore(data);
      const lastIdx = data.length - 1;
      const outlier = results.find((a) => a.index === lastIdx);
      expect(outlier).toBeDefined();
      expect(outlier!.type).toBe('HIGH');
      expect(outlier!.method).toBe('Z_SCORE');
    });

    it('uses custom threshold', () => {
      // With threshold=10, the outlier should not be detected
      const data = makeDataWithOutlier();
      const results = service.detectZScore(data, 10);
      expect(results).toHaveLength(0);
    });

    it('returns empty array for normal data', () => {
      const data = Array.from({ length: 20 }, () => 100 + Math.random() * 2);
      const results = service.detectZScore(data, 2.5);
      expect(results.length).toBeLessThanOrEqual(1); // might have 1 on random edge
    });

    it('returns empty array for data < 3 points', () => {
      expect(service.detectZScore([1, 2])).toEqual([]);
    });

    it('returns empty array when std dev is 0 (all same values)', () => {
      const data = Array(10).fill(50);
      expect(service.detectZScore(data)).toEqual([]);
    });

    it('detects LOW anomaly for negative outlier', () => {
      const base = Array.from({ length: 29 }, () => 200 + Math.random() * 5);
      const data = [...base, -100];
      const results = service.detectZScore(data);
      const lowAnomalies = results.filter((a) => a.type === 'LOW');
      expect(lowAnomalies.length).toBeGreaterThan(0);
    });

    it('returns correct AnomalyResult shape', () => {
      const data = makeDataWithOutlier();
      const results = service.detectZScore(data);
      if (results.length > 0) {
        const a = results[0];
        expect(a).toHaveProperty('index');
        expect(a).toHaveProperty('value');
        expect(a).toHaveProperty('expected');
        expect(a).toHaveProperty('deviation');
        expect(a).toHaveProperty('type');
        expect(a).toHaveProperty('method');
        expect(['HIGH', 'LOW']).toContain(a.type);
        expect(a.method).toBe('Z_SCORE');
      }
    });
  });

  // ─── detectIQR() ───────────────────────────────────────────────────────────

  describe('detectIQR()', () => {
    it('detects a clear high outlier', () => {
      const data = makeDataWithOutlier();
      const results = service.detectIQR(data);
      const lastIdx = data.length - 1;
      const outlier = results.find((a) => a.index === lastIdx);
      expect(outlier).toBeDefined();
      expect(outlier!.type).toBe('HIGH');
      expect(outlier!.method).toBe('IQR');
    });

    it('detects a clear low outlier', () => {
      const base = Array.from({ length: 29 }, () => 200 + Math.random() * 5);
      const data = [1, ...base]; // 1 is a clear low outlier
      const results = service.detectIQR(data);
      const outlier = results.find((a) => a.index === 0);
      expect(outlier).toBeDefined();
      expect(outlier!.type).toBe('LOW');
    });

    it('uses custom multiplier — higher multiplier detects fewer outliers', () => {
      const data = makeDataWithOutlier();
      const resultsStrict = service.detectIQR(data, 1.5);
      const resultsLoose = service.detectIQR(data, 3.0);
      // A stricter multiplier should detect at least as many outliers as a looser one
      expect(resultsStrict.length).toBeGreaterThanOrEqual(resultsLoose.length);
    });

    it('returns empty for data < 4 points', () => {
      expect(service.detectIQR([1, 2, 3])).toEqual([]);
    });

    it('returns correct AnomalyResult shape', () => {
      const data = makeDataWithOutlier();
      const results = service.detectIQR(data);
      if (results.length > 0) {
        const a = results[0];
        expect(a.method).toBe('IQR');
        expect(['HIGH', 'LOW']).toContain(a.type);
        expect(typeof a.index).toBe('number');
        expect(typeof a.value).toBe('number');
        expect(typeof a.deviation).toBe('number');
      }
    });

    it('handles uniform data without crashing', () => {
      const data = Array(20).fill(100);
      expect(() => service.detectIQR(data)).not.toThrow();
    });
  });

  // ─── detectInTimeSeries() ──────────────────────────────────────────────────

  describe('detectInTimeSeries()', () => {
    it('returns summary with correct shape', async () => {
      const rows = makeDataWithOutlier().map((revenue, i) => ({
        id: `f${i}`,
        companyId: 'c1',
        period: `2026-01-${String(i + 1).padStart(2, '0')}`,
        revenue,
        quantity: 10,
        orderCount: 1,
        createdAt: new Date(),
      }));
      mockPrisma.factSalesDaily.findMany.mockResolvedValue(rows);

      const result = await service.detectInTimeSeries('c1', 'sales', 'revenue');
      expect(result).toHaveProperty('anomalies');
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('summary');
      expect(result.summary).toHaveProperty('totalPoints');
      expect(result.summary).toHaveProperty('anomalyCount');
      expect(result.summary).toHaveProperty('highCount');
      expect(result.summary).toHaveProperty('lowCount');
    });

    it('detects the outlier in data', async () => {
      const rows = makeDataWithOutlier().map((revenue, i) => ({
        id: `f${i}`,
        companyId: 'c1',
        period: `2026-01-${String(i + 1).padStart(2, '0')}`,
        revenue,
        quantity: 5,
        orderCount: 1,
        createdAt: new Date(),
      }));
      mockPrisma.factSalesDaily.findMany.mockResolvedValue(rows);

      const result = await service.detectInTimeSeries('c1', 'sales', 'revenue');
      expect(result.summary.anomalyCount).toBeGreaterThan(0);
    });

    it('throws NOT_FOUND when no data returned', async () => {
      mockPrisma.factSalesDaily.findMany.mockResolvedValue([]);
      await expect(
        service.detectInTimeSeries('c1', 'sales', 'revenue'),
      ).rejects.toThrow(BusinessException);
    });

    it('throws BAD_REQUEST for unknown dataSource', async () => {
      await expect(
        service.detectInTimeSeries('c1', 'unknown', 'revenue'),
      ).rejects.toThrow(BusinessException);
    });

    it('anomaly count equals highCount + lowCount', async () => {
      const rows = makeDataWithOutlier().map((revenue, i) => ({
        id: `f${i}`,
        companyId: 'c1',
        period: `2026-01-${String(i + 1).padStart(2, '0')}`,
        revenue,
        quantity: 5,
        orderCount: 1,
        createdAt: new Date(),
      }));
      mockPrisma.factSalesDaily.findMany.mockResolvedValue(rows);

      const result = await service.detectInTimeSeries('c1', 'sales', 'revenue');
      expect(result.summary.anomalyCount).toBe(
        result.summary.highCount + result.summary.lowCount,
      );
    });

    it('deduplicates anomalies detected by both methods', async () => {
      const rows = makeDataWithOutlier().map((revenue, i) => ({
        id: `f${i}`,
        companyId: 'c1',
        period: `2026-01-${String(i + 1).padStart(2, '0')}`,
        revenue,
        quantity: 5,
        orderCount: 1,
        createdAt: new Date(),
      }));
      mockPrisma.factSalesDaily.findMany.mockResolvedValue(rows);

      const result = await service.detectInTimeSeries('c1', 'sales', 'revenue');
      const indices = result.anomalies.map((a) => a.index);
      const uniqueIndices = new Set(indices);
      expect(indices.length).toBe(uniqueIndices.size);
    });
  });

  // ─── checkAlertRules() ─────────────────────────────────────────────────────

  describe('checkAlertRules()', () => {
    it('creates a trigger when GT rule is violated', async () => {
      const data = Array.from({ length: 10 }, (_, i) => (i === 9 ? 1000 : 100));
      mockPrisma.alertRule.findMany.mockResolvedValue([
        {
          id: 'rule-1',
          metric: 'revenue',
          dataSource: 'sales',
          operator: 'GT',
          threshold: 500,
          windowDays: 30,
        },
      ]);
      mockPrisma.factSalesDaily.findMany.mockResolvedValue(
        data.map((revenue, i) => ({
          id: `f${i}`,
          companyId: 'c1',
          period: `2026-01-${String(i + 1).padStart(2, '0')}`,
          revenue,
          quantity: 5,
          orderCount: 1,
          createdAt: new Date(),
        })),
      );
      mockPrisma.alertTrigger.create.mockResolvedValue({ id: 'trig-1' });

      await service.checkAlertRules('c1');

      expect(mockPrisma.alertTrigger.create).toHaveBeenCalledTimes(1);
      const call = mockPrisma.alertTrigger.create.mock.calls[0][0];
      expect(call.data.alertRuleId).toBe('rule-1');
    });

    it('does not create trigger when threshold not crossed', async () => {
      const data = Array(10).fill(100);
      mockPrisma.alertRule.findMany.mockResolvedValue([
        {
          id: 'rule-2',
          metric: 'revenue',
          dataSource: 'sales',
          operator: 'GT',
          threshold: 500,
          windowDays: 30,
        },
      ]);
      mockPrisma.factSalesDaily.findMany.mockResolvedValue(
        data.map((revenue, i) => ({
          id: `f${i}`,
          companyId: 'c1',
          period: `2026-01-${String(i + 1).padStart(2, '0')}`,
          revenue,
          quantity: 5,
          orderCount: 1,
          createdAt: new Date(),
        })),
      );

      await service.checkAlertRules('c1');
      expect(mockPrisma.alertTrigger.create).not.toHaveBeenCalled();
    });

    it('handles no active rules gracefully', async () => {
      mockPrisma.alertRule.findMany.mockResolvedValue([]);
      await expect(service.checkAlertRules('c1')).resolves.not.toThrow();
    });

    it('continues processing other rules when one fails', async () => {
      mockPrisma.alertRule.findMany.mockResolvedValue([
        {
          id: 'rule-bad',
          metric: 'revenue',
          dataSource: 'unknown_source',
          operator: 'GT',
          threshold: 100,
          windowDays: 30,
        },
        {
          id: 'rule-ok',
          metric: 'revenue',
          dataSource: 'sales',
          operator: 'GT',
          threshold: 50,
          windowDays: 30,
        },
      ]);
      mockPrisma.factSalesDaily.findMany.mockResolvedValue([
        {
          id: 'f1',
          companyId: 'c1',
          period: '2026-01-01',
          revenue: 200,
          quantity: 5,
          orderCount: 1,
          createdAt: new Date(),
        },
      ]);
      mockPrisma.alertTrigger.create.mockResolvedValue({ id: 'trig-1' });

      // Should not throw even though 'unknown_source' fails
      await expect(service.checkAlertRules('c1')).resolves.not.toThrow();
      // The good rule should still have fired
      expect(mockPrisma.alertTrigger.create).toHaveBeenCalledTimes(1);
    });
  });
});
