import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DemandService } from './demand.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  demandForecast: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
};

const baseForecast = {
  id: 'df-1',
  companyId: 'co-1',
  productId: 'p-1',
  period: '2026-05',
  quantity: '100',
  notes: null,
  product: { id: 'p-1', name: 'Bolsa Premium', sku: 'BP001', unit: 'UN' },
  company: { id: 'co-1', name: 'GDR Loja Centro' },
};

describe('DemandService', () => {
  let service: DemandService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DemandService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DemandService>(DemandService);
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  // ─── upsert ───────────────────────────────────────────────────────────────

  describe('upsert', () => {
    const dto = { companyId: 'co-1', productId: 'p-1', period: '2026-05', quantity: 100 };

    it('deve criar nova previsão quando não existe', async () => {
      mockPrisma.demandForecast.findUnique.mockResolvedValue(null);
      mockPrisma.demandForecast.upsert.mockResolvedValue(baseForecast);

      const result = await service.upsert(dto, 'u-1');

      expect(mockPrisma.demandForecast.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            companyId: 'co-1',
            productId: 'p-1',
            period: '2026-05',
            quantity: 100,
          }),
        }),
      );
      expect(result.id).toBe('df-1');
    });

    it('deve atualizar previsão existente e registrar quantidade anterior no audit', async () => {
      mockPrisma.demandForecast.findUnique.mockResolvedValue({ ...baseForecast, quantity: '80' });
      mockPrisma.demandForecast.upsert.mockResolvedValue({ ...baseForecast, quantity: '100' });

      await service.upsert(dto, 'u-1');

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'UPDATE',
            payload: expect.objectContaining({ previousQty: 80, newQty: 100 }),
          }),
        }),
      );
    });

    it('deve registrar action CREATE no audit quando é novo', async () => {
      mockPrisma.demandForecast.findUnique.mockResolvedValue(null);
      mockPrisma.demandForecast.upsert.mockResolvedValue(baseForecast);

      await service.upsert(dto, 'u-1');

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'CREATE' }),
        }),
      );
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('deve excluir previsão existente', async () => {
      mockPrisma.demandForecast.findFirst.mockResolvedValue(baseForecast);
      mockPrisma.demandForecast.delete.mockResolvedValue(baseForecast);

      await service.remove('df-1', 'co-1', 'u-1');

      expect(mockPrisma.demandForecast.delete).toHaveBeenCalledWith({ where: { id: 'df-1' } });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'DELETE' }) }),
      );
    });

    it('deve lançar NotFoundException para previsão inexistente', async () => {
      mockPrisma.demandForecast.findFirst.mockResolvedValue(null);
      await expect(service.remove('df-x', 'co-1', 'u-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('deve listar previsões filtrando por companyId', async () => {
      mockPrisma.demandForecast.findMany.mockResolvedValue([baseForecast]);

      const result = await service.findAll('co-1');

      expect(mockPrisma.demandForecast.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ companyId: 'co-1' }) }),
      );
      expect(result).toHaveLength(1);
    });

    it('deve aplicar filtro por period e productId', async () => {
      mockPrisma.demandForecast.findMany.mockResolvedValue([]);

      await service.findAll('co-1', { period: '2026-05', productId: 'p-1' });

      expect(mockPrisma.demandForecast.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ period: '2026-05', productId: 'p-1' }),
        }),
      );
    });
  });

  // ─── getConsolidated ──────────────────────────────────────────────────────

  describe('getConsolidated', () => {
    it('deve consolidar demanda somando todas as filiais por produto/período', async () => {
      mockPrisma.demandForecast.findMany.mockResolvedValue([
        { ...baseForecast, companyId: 'co-1', quantity: '100', product: { id: 'p-1', name: 'Bolsa', sku: 'BP001' } },
        { ...baseForecast, id: 'df-2', companyId: 'co-2', quantity: '80', product: { id: 'p-1', name: 'Bolsa', sku: 'BP001' } },
        { ...baseForecast, id: 'df-3', companyId: 'co-1', period: '2026-06', quantity: '120', product: { id: 'p-1', name: 'Bolsa', sku: 'BP001' } },
      ]);

      const result = await service.getConsolidated({ period: '2026-05' });

      expect(result).toHaveLength(2); // 2026-05 e 2026-06
      const may = result.find((r) => r.period === '2026-05');
      expect(may?.totalQty).toBe(180); // 100 + 80
      expect(may?.entries).toBe(2);
    });

    it('deve retornar lista vazia quando não há previsões', async () => {
      mockPrisma.demandForecast.findMany.mockResolvedValue([]);
      const result = await service.getConsolidated();
      expect(result).toHaveLength(0);
    });
  });

  // ─── isolamento por filial ────────────────────────────────────────────────

  describe('isolamento por companyId', () => {
    it('findAll não retorna dados de outra empresa', async () => {
      mockPrisma.demandForecast.findMany.mockResolvedValue([]);

      await service.findAll('co-1');

      const call = mockPrisma.demandForecast.findMany.mock.calls[0][0];
      expect(call.where.companyId).toBe('co-1');
    });
  });
});
