import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CapacityService } from './capacity.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  workCenter: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  productionOrder: { findMany: jest.fn() },
};

describe('CapacityService', () => {
  let service: CapacityService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CapacityService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<CapacityService>(CapacityService);
  });

  // ─── createWorkCenter ──────────────────────────────────────────────────────

  describe('createWorkCenter', () => {
    it('should create a work center successfully', async () => {
      mockPrisma.workCenter.findFirst.mockResolvedValue(null);
      const created = { id: 'wc1', companyId: 'c1', code: 'SOLDA', name: 'Solda MIG' };
      mockPrisma.workCenter.create.mockResolvedValue(created);

      const result = await service.createWorkCenter('c1', {
        code: 'SOLDA',
        name: 'Solda MIG',
      });

      expect(result).toEqual(created);
      expect(mockPrisma.workCenter.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ companyId: 'c1', code: 'SOLDA' }) }),
      );
    });

    it('should throw BadRequestException on duplicate code', async () => {
      mockPrisma.workCenter.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createWorkCenter('c1', { code: 'SOLDA', name: 'X' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── listWorkCenters ───────────────────────────────────────────────────────

  describe('listWorkCenters', () => {
    it('should return only active work centers by default', async () => {
      const active = [{ id: 'wc1', isActive: true }];
      mockPrisma.workCenter.findMany.mockResolvedValue(active);

      const result = await service.listWorkCenters('c1');

      expect(mockPrisma.workCenter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      );
      expect(result).toEqual(active);
    });

    it('should return all work centers when includeInactive is true', async () => {
      const all = [{ id: 'wc1', isActive: true }, { id: 'wc2', isActive: false }];
      mockPrisma.workCenter.findMany.mockResolvedValue(all);

      const result = await service.listWorkCenters('c1', true);

      expect(mockPrisma.workCenter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: 'c1' } }),
      );
      expect(result).toEqual(all);
    });
  });

  // ─── updateWorkCenter ──────────────────────────────────────────────────────

  describe('updateWorkCenter', () => {
    it('should update a work center successfully', async () => {
      const wc = { id: 'wc1', companyId: 'c1', code: 'SOLDA', name: 'Solda MIG' };
      mockPrisma.workCenter.findFirst
        .mockResolvedValueOnce(wc)  // getWorkCenter
        .mockResolvedValueOnce(null); // conflict check
      const updated = { ...wc, name: 'Solda TIG' };
      mockPrisma.workCenter.update.mockResolvedValue(updated);

      const result = await service.updateWorkCenter('wc1', 'c1', { name: 'Solda TIG' });

      expect(result).toEqual(updated);
      expect(mockPrisma.workCenter.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'wc1' } }),
      );
    });
  });

  // ─── getCapacityPlan ───────────────────────────────────────────────────────

  describe('getCapacityPlan', () => {
    const wcSolda = {
      id: 'wc1',
      code: 'SOLDA',
      name: 'Solda MIG',
      capacityHoursPerDay: 8,
      operatorsCount: 2,
      efficiencyPct: 100,
      isActive: true,
    };

    it('should calculate load hours correctly when orders match', async () => {
      mockPrisma.workCenter.findMany.mockResolvedValue([wcSolda]);
      mockPrisma.productionOrder.findMany.mockResolvedValue([
        {
          id: 'op1',
          plannedQty: 10,
          product: {
            sku: 'PROD-A',
            routingSteps: [
              { workCenter: 'SOLDA', setupTimeMin: 30, runTimeMin: 6 },
            ],
          },
        },
      ]);

      // period: 2026-06-01 to 2026-06-05 = 5 days
      const result = await service.getCapacityPlan('c1', {
        startDate: '2026-06-01',
        endDate: '2026-06-05',
      });

      // availableHours = 8 * 2 * (100/100) * 5 = 80
      // loadHours = (30 + 6 * 10) / 60 = 90/60 = 1.5
      expect(result.workCenters[0].availableHours).toBe(80);
      expect(result.workCenters[0].loadHours).toBe(1.5);
      expect(result.workCenters[0].utilizationPct).toBe(1.88);
      expect(result.workCenters[0].isBottleneck).toBe(false);
      expect(result.summary.totalWorkCenters).toBe(1);
    });

    it('should return zero load when no orders exist', async () => {
      mockPrisma.workCenter.findMany.mockResolvedValue([wcSolda]);
      mockPrisma.productionOrder.findMany.mockResolvedValue([]);

      const result = await service.getCapacityPlan('c1', {
        startDate: '2026-06-01',
        endDate: '2026-06-01',
      });

      expect(result.workCenters[0].loadHours).toBe(0);
      expect(result.workCenters[0].isBottleneck).toBe(false);
    });

    it('should detect bottleneck when load exceeds capacity', async () => {
      const smallWc = { ...wcSolda, capacityHoursPerDay: 1, operatorsCount: 1, efficiencyPct: 100 };
      mockPrisma.workCenter.findMany.mockResolvedValue([smallWc]);
      mockPrisma.productionOrder.findMany.mockResolvedValue([
        {
          id: 'op1',
          plannedQty: 1000,
          product: {
            sku: 'PROD-A',
            routingSteps: [
              { workCenter: 'SOLDA', setupTimeMin: 60, runTimeMin: 60 },
            ],
          },
        },
      ]);

      // period 1 day: available = 1h, load = (60 + 60*1000)/60 = 1010/60 ≈ 16.83h
      const result = await service.getCapacityPlan('c1', {
        startDate: '2026-06-01',
        endDate: '2026-06-01',
      });

      expect(result.workCenters[0].isBottleneck).toBe(true);
      expect(result.bottlenecks).toContain('SOLDA');
      expect(result.summary.bottleneckCount).toBe(1);
    });
  });

  // ─── getLoadByProduct ──────────────────────────────────────────────────────

  describe('getLoadByProduct', () => {
    it('should group load hours by product and work center', async () => {
      mockPrisma.productionOrder.findMany.mockResolvedValue([
        {
          id: 'op1',
          plannedQty: 10,
          product: {
            id: 'prod1',
            sku: 'PROD-A',
            routingSteps: [
              { workCenter: 'SOLDA', setupTimeMin: 30, runTimeMin: 6 },
              { workCenter: 'PINTURA', setupTimeMin: 15, runTimeMin: 3 },
            ],
          },
        },
      ]);

      const result = await service.getLoadByProduct('c1', '2026-06-01', '2026-06-30');

      expect(result).toHaveLength(1);
      expect(result[0].productSku).toBe('PROD-A');
      expect(result[0].loadByWorkCenter['SOLDA']).toBe(1.5);   // (30+60)/60
      expect(result[0].loadByWorkCenter['PINTURA']).toBe(0.75); // (15+30)/60
    });
  });

  // ─── getWorkCenterStats ────────────────────────────────────────────────────

  describe('getWorkCenterStats', () => {
    it('should return correct stats structure', async () => {
      mockPrisma.workCenter.findMany.mockResolvedValue([
        { id: 'wc1', isActive: true, efficiencyPct: 80, capacityHoursPerDay: 8 },
        { id: 'wc2', isActive: true, efficiencyPct: 90, capacityHoursPerDay: 8 },
        { id: 'wc3', isActive: false, efficiencyPct: 70, capacityHoursPerDay: 6 },
      ]);

      const result = await service.getWorkCenterStats('c1');

      expect(result.total).toBe(3);
      expect(result.active).toBe(2);
      expect(result.inactive).toBe(1);
      expect(result.avgEfficiencyPct).toBe(85);
      expect(result.avgCapacityHoursPerDay).toBe(8);
    });
  });
});
