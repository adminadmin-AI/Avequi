import { Test, TestingModule } from '@nestjs/testing';
import { QueryAuditService } from './query-audit.service';
import { PrismaService } from '../../prisma/prisma.service';

const COMPANY = 'company-1';
const USER_ID = 'user-1';

const makeLog = (endpoint: string, duration: number, cached = false) => ({
  id: `log-${Math.random()}`,
  companyId: COMPANY,
  userId: USER_ID,
  endpoint,
  params: null,
  duration,
  cached,
  createdAt: new Date(),
});

const mockPrisma = {
  analyticsQueryLog: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
};

describe('QueryAuditService', () => {
  let service: QueryAuditService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryAuditService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<QueryAuditService>(QueryAuditService);
    jest.clearAllMocks();
  });

  // ─── log ───────────────────────────────────────────────────────────────────

  describe('log()', () => {
    it('creates a query log entry', async () => {
      const entry = makeLog('/analytics/sales-cube', 120, false);
      mockPrisma.analyticsQueryLog.create.mockResolvedValue(entry);

      const result = await service.log(
        COMPANY,
        USER_ID,
        '/analytics/sales-cube',
        { from: '2026-01' },
        120,
        false,
      );

      expect(mockPrisma.analyticsQueryLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: COMPANY,
            userId: USER_ID,
            endpoint: '/analytics/sales-cube',
            duration: 120,
            cached: false,
          }),
        }),
      );
      expect(result.duration).toBe(120);
    });

    it('logs cached queries', async () => {
      const entry = makeLog('/analytics/sales-cube', 5, true);
      mockPrisma.analyticsQueryLog.create.mockResolvedValue(entry);

      const result = await service.log(COMPANY, USER_ID, '/analytics/sales-cube', null, 5, true);
      expect(result.cached).toBe(true);
    });

    it('handles null params', async () => {
      const entry = makeLog('/analytics/comparison', 50, false);
      mockPrisma.analyticsQueryLog.create.mockResolvedValue(entry);

      await service.log(COMPANY, USER_ID, '/analytics/comparison', null, 50, false);

      const call = mockPrisma.analyticsQueryLog.create.mock.calls[0][0];
      expect(call.data.params).toBeUndefined();
    });
  });

  // ─── getQueryStats ─────────────────────────────────────────────────────────

  describe('getQueryStats()', () => {
    it('returns zero stats when no logs', async () => {
      mockPrisma.analyticsQueryLog.findMany.mockResolvedValue([]);

      const stats = await service.getQueryStats(COMPANY);
      expect(stats.totalQueries).toBe(0);
      expect(stats.avgDurationMs).toBe(0);
      expect(stats.cacheHitRate).toBe(0);
      expect(stats.topEndpoints).toHaveLength(0);
    });

    it('calculates correct totalQueries', async () => {
      const logs = [
        makeLog('/sales', 100),
        makeLog('/inventory', 200),
        makeLog('/sales', 150),
      ];
      mockPrisma.analyticsQueryLog.findMany.mockResolvedValue(logs);

      const stats = await service.getQueryStats(COMPANY);
      expect(stats.totalQueries).toBe(3);
    });

    it('calculates correct avgDurationMs', async () => {
      const logs = [makeLog('/sales', 100), makeLog('/sales', 200)];
      mockPrisma.analyticsQueryLog.findMany.mockResolvedValue(logs);

      const stats = await service.getQueryStats(COMPANY);
      expect(stats.avgDurationMs).toBe(150);
    });

    it('calculates correct cacheHitRate', async () => {
      const logs = [
        makeLog('/sales', 5, true),
        makeLog('/sales', 100, false),
        makeLog('/inv', 200, false),
        makeLog('/inv', 6, true),
      ];
      mockPrisma.analyticsQueryLog.findMany.mockResolvedValue(logs);

      const stats = await service.getQueryStats(COMPANY);
      expect(stats.cacheHitRate).toBe(0.5);
    });

    it('returns topEndpoints sorted by count descending', async () => {
      const logs = [
        makeLog('/sales', 100),
        makeLog('/sales', 110),
        makeLog('/sales', 90),
        makeLog('/inventory', 200),
        makeLog('/inventory', 150),
        makeLog('/financial', 300),
      ];
      mockPrisma.analyticsQueryLog.findMany.mockResolvedValue(logs);

      const stats = await service.getQueryStats(COMPANY);
      expect(stats.topEndpoints[0].endpoint).toBe('/sales');
      expect(stats.topEndpoints[0].count).toBe(3);
    });

    it('passes date filters to Prisma', async () => {
      mockPrisma.analyticsQueryLog.findMany.mockResolvedValue([]);
      const start = new Date('2026-01-01');
      const end = new Date('2026-06-30');

      await service.getQueryStats(COMPANY, start, end);

      const call = mockPrisma.analyticsQueryLog.findMany.mock.calls[0][0];
      expect(call.where.createdAt?.gte).toEqual(start);
      expect(call.where.createdAt?.lte).toEqual(end);
    });

    it('does not include date filter when not provided', async () => {
      mockPrisma.analyticsQueryLog.findMany.mockResolvedValue([]);

      await service.getQueryStats(COMPANY);

      const call = mockPrisma.analyticsQueryLog.findMany.mock.calls[0][0];
      expect(call.where.createdAt).toBeUndefined();
    });
  });

  // ─── getSlowQueries ────────────────────────────────────────────────────────

  describe('getSlowQueries()', () => {
    it('returns queries slower than default threshold (1000ms)', async () => {
      const slow = [makeLog('/sales', 1500), makeLog('/inventory', 2000)];
      mockPrisma.analyticsQueryLog.findMany.mockResolvedValue(slow);

      const result = await service.getSlowQueries(COMPANY);

      expect(mockPrisma.analyticsQueryLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: COMPANY,
            duration: { gte: 1000 },
          }),
          orderBy: { duration: 'desc' },
        }),
      );
      expect(result).toHaveLength(2);
    });

    it('uses custom threshold', async () => {
      mockPrisma.analyticsQueryLog.findMany.mockResolvedValue([]);

      await service.getSlowQueries(COMPANY, 500);

      const call = mockPrisma.analyticsQueryLog.findMany.mock.calls[0][0];
      expect(call.where.duration.gte).toBe(500);
    });

    it('passes date filters to Prisma', async () => {
      mockPrisma.analyticsQueryLog.findMany.mockResolvedValue([]);
      const start = new Date('2026-01-01');
      const end = new Date('2026-06-30');

      await service.getSlowQueries(COMPANY, 1000, start, end);

      const call = mockPrisma.analyticsQueryLog.findMany.mock.calls[0][0];
      expect(call.where.createdAt?.gte).toEqual(start);
      expect(call.where.createdAt?.lte).toEqual(end);
    });

    it('returns at most 50 entries', async () => {
      mockPrisma.analyticsQueryLog.findMany.mockResolvedValue([]);

      await service.getSlowQueries(COMPANY);

      const call = mockPrisma.analyticsQueryLog.findMany.mock.calls[0][0];
      expect(call.take).toBe(50);
    });
  });
});
