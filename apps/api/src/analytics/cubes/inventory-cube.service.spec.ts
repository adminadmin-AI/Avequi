import { Test, TestingModule } from '@nestjs/testing';
import { InventoryCubeService } from './inventory-cube.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  factInventoryDaily: { findMany: jest.fn() },
};

describe('InventoryCubeService', () => {
  let service: InventoryCubeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryCubeService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<InventoryCubeService>(InventoryCubeService);
    jest.clearAllMocks();
  });

  // ─── query ────────────────────────────────────────────────────────────────

  describe('query', () => {
    it('returns aggregated totals', async () => {
      mockPrisma.factInventoryDaily.findMany.mockResolvedValue([
        { productId: 'p1', warehouseId: 'wh1', period: '2025-01-01', quantity: 10, value: 500, avgCost: 50 },
        { productId: 'p2', warehouseId: 'wh1', period: '2025-01-01', quantity: 5, value: 250, avgCost: 50 },
      ]);

      const result = await service.query('c1', {});

      expect(result.quantity).toBe(15);
      expect(result.value).toBe(750);
      expect(result.rows).toHaveLength(2);
    });

    it('filters by warehouseId', async () => {
      mockPrisma.factInventoryDaily.findMany.mockResolvedValue([]);

      await service.query('c1', { warehouseId: 'wh-specific' });

      expect(mockPrisma.factInventoryDaily.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ warehouseId: 'wh-specific' }),
        }),
      );
    });

    it('filters by period range', async () => {
      mockPrisma.factInventoryDaily.findMany.mockResolvedValue([]);

      await service.query('c1', { periodFrom: '2025-01-01', periodTo: '2025-01-31' });

      expect(mockPrisma.factInventoryDaily.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            period: { gte: '2025-01-01', lte: '2025-01-31' },
          }),
        }),
      );
    });
  });

  // ─── aging ────────────────────────────────────────────────────────────────

  describe('aging', () => {
    it('categorises into buckets based on days since earliest period', async () => {
      const today = new Date();
      const daysAgo = (n: number) => {
        const d = new Date(today);
        d.setDate(d.getDate() - n);
        return d.toISOString().slice(0, 10);
      };

      const rows = [
        // product p1/wh1: 10 days old → 0-30 bucket
        { productId: 'p1', warehouseId: 'wh1', period: daysAgo(10), quantity: 5, value: 100, avgCost: 20 },
        { productId: 'p1', warehouseId: 'wh1', period: daysAgo(5), quantity: 8, value: 160, avgCost: 20 }, // latest

        // product p2/wh1: 45 days old → 31-60 bucket
        { productId: 'p2', warehouseId: 'wh1', period: daysAgo(45), quantity: 3, value: 300, avgCost: 100 },

        // product p3/wh1: 80 days old → 61-90 bucket
        { productId: 'p3', warehouseId: 'wh1', period: daysAgo(80), quantity: 2, value: 200, avgCost: 100 },

        // product p4/wh1: 120 days old → 90+ bucket
        { productId: 'p4', warehouseId: 'wh1', period: daysAgo(120), quantity: 10, value: 1000, avgCost: 100 },
      ];

      // Sort by period asc (simulate DB ordering)
      rows.sort((a, b) => a.period.localeCompare(b.period));
      mockPrisma.factInventoryDaily.findMany.mockResolvedValue(rows);

      const result = await service.aging('c1');

      expect(result.quantity['0-30']).toBe(8); // latest snapshot for p1/wh1
      expect(result.quantity['31-60']).toBe(3);
      expect(result.quantity['61-90']).toBe(2);
      expect(result.quantity['90+']).toBe(10);
    });

    it('passes warehouseId filter', async () => {
      mockPrisma.factInventoryDaily.findMany.mockResolvedValue([]);

      await service.aging('c1', 'wh-filter');

      expect(mockPrisma.factInventoryDaily.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ warehouseId: 'wh-filter' }),
        }),
      );
    });

    it('passes categoryId filter', async () => {
      mockPrisma.factInventoryDaily.findMany.mockResolvedValue([]);

      await service.aging('c1', undefined, 'cat-filter');

      expect(mockPrisma.factInventoryDaily.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ categoryId: 'cat-filter' }),
        }),
      );
    });

    it('returns zero buckets for empty data', async () => {
      mockPrisma.factInventoryDaily.findMany.mockResolvedValue([]);

      const result = await service.aging('c1');

      expect(result.quantity['0-30']).toBe(0);
      expect(result.quantity['31-60']).toBe(0);
      expect(result.quantity['61-90']).toBe(0);
      expect(result.quantity['90+']).toBe(0);
    });
  });

  // ─── drillDown ────────────────────────────────────────────────────────────

  describe('drillDown', () => {
    it('drills down by warehouse', async () => {
      mockPrisma.factInventoryDaily.findMany.mockResolvedValue([]);

      await service.drillDown('c1', 'warehouse', 'wh-1', {});

      expect(mockPrisma.factInventoryDaily.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ warehouseId: 'wh-1' }),
        }),
      );
    });

    it('drills down by product', async () => {
      mockPrisma.factInventoryDaily.findMany.mockResolvedValue([]);

      await service.drillDown('c1', 'product', 'prod-1', {});

      expect(mockPrisma.factInventoryDaily.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ productId: 'prod-1' }),
        }),
      );
    });
  });
});
