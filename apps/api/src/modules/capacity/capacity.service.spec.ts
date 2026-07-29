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
  // #815 — guard de exclusão: nenhum roteiro pode ficar vinculado
  routingStep: { count: jest.fn() },
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

  // ─── #815: guard de exclusão de WorkCenter ─────────────────────────────────

  describe('deleteWorkCenter (#815)', () => {
    const WC = { id: 'wc-solda', code: 'SOLDA', companyId: 'c1' };

    beforeEach(() => {
      // mockReset e não mockClear: o teste de updateWorkCenter enfileira
      // mockResolvedValueOnce(null) e jest.clearAllMocks() não descarta
      // implementações "once" pendentes — elas vazariam para cá.
      mockPrisma.workCenter.findFirst.mockReset().mockResolvedValue(WC);
      mockPrisma.productionOrder.findMany.mockReset().mockResolvedValue([]);
      mockPrisma.routingStep.count.mockReset().mockResolvedValue(0);
      mockPrisma.workCenter.delete.mockReset().mockResolvedValue(WC);
    });

    it('bloqueia exclusão quando há OP ativa usando o centro', async () => {
      mockPrisma.productionOrder.findMany.mockResolvedValue([{ id: 'op-1' }]);

      await expect(service.deleteWorkCenter('wc-solda', 'c1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockPrisma.workCenter.delete).not.toHaveBeenCalled();
    });

    it('busca OP ativa pela FK, com fallback só para etapa sem FK', async () => {
      await service.deleteWorkCenter('wc-solda', 'c1');

      const where = mockPrisma.productionOrder.findMany.mock.calls[0][0].where;
      expect(where.product.routingSteps.some.OR).toEqual([
        { workCenterId: 'wc-solda' },
        { workCenterId: null, workCenter: 'SOLDA' },
      ]);
    });

    it('bloqueia exclusão quando algum roteiro ainda referencia o centro', async () => {
      mockPrisma.routingStep.count.mockResolvedValue(4);

      await expect(service.deleteWorkCenter('wc-solda', 'c1')).rejects.toThrow(/4 etapa/);
      expect(mockPrisma.workCenter.delete).not.toHaveBeenCalled();
    });

    it('permite exclusão quando não há OP ativa nem roteiro vinculado', async () => {
      await service.deleteWorkCenter('wc-solda', 'c1');

      expect(mockPrisma.workCenter.delete).toHaveBeenCalledWith({ where: { id: 'wc-solda' } });
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

    // ─── #815: resolução por FK ────────────────────────────────────────────
    it('#815: casa a etapa pela FK workCenterId, sem depender do texto', async () => {
      mockPrisma.workCenter.findMany.mockResolvedValue([{ ...wcSolda, id: 'wc-solda' }]);
      mockPrisma.productionOrder.findMany.mockResolvedValue([
        {
          id: 'op1',
          plannedQty: 10,
          product: {
            sku: 'PROD-A',
            routingSteps: [
              // Sem texto nenhum — só a FK
              { workCenterId: 'wc-solda', workCenter: null, setupTimeMin: 30, runTimeMin: 6 },
            ],
          },
        },
      ]);

      const result = await service.getCapacityPlan('c1', {
        startDate: '2026-06-01',
        endDate: '2026-06-05',
      });

      expect(result.workCenters[0].loadHours).toBe(1.5);
    });

    it('#815: FK tem prioridade — texto divergente não gera carga no centro errado', async () => {
      mockPrisma.workCenter.findMany.mockResolvedValue([{ ...wcSolda, id: 'wc-solda' }]);
      mockPrisma.productionOrder.findMany.mockResolvedValue([
        {
          id: 'op1',
          plannedQty: 10,
          product: {
            sku: 'PROD-A',
            routingSteps: [
              // FK aponta para OUTRO centro, mas o texto diz 'SOLDA'
              { workCenterId: 'wc-corte', workCenter: 'SOLDA', setupTimeMin: 30, runTimeMin: 6 },
            ],
          },
        },
      ]);

      const result = await service.getCapacityPlan('c1', {
        startDate: '2026-06-01',
        endDate: '2026-06-05',
      });

      // Não pode contar carga: a etapa é do Corte, não da Solda
      expect(result.workCenters[0].loadHours).toBe(0);
    });

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
