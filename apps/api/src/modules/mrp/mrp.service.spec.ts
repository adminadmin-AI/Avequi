import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MrpService } from './mrp.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  systemParameter: { findUnique: jest.fn() },
  mrpRun: { create: jest.fn(), update: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
  mrpSuggestion: { createMany: jest.fn() },
  demandForecast: { findMany: jest.fn() },
  bomVersion: { findMany: jest.fn() },
  stockBalance: { findMany: jest.fn() },
};

// Produtos base
const pFinished = { id: 'p-finished', type: 'FINISHED_GOOD' };
const pSemiFinished = { id: 'p-semi', type: 'SEMI_FINISHED' };
const pRaw = { id: 'p-raw', type: 'RAW_MATERIAL' };

// BOM: Finished → Semi (2 un) → Raw (3 un)
const boms = [
  {
    id: 'bom-1',
    productId: 'p-finished',
    isActive: true,
    items: [
      {
        componentId: 'p-semi',
        quantity: '2',
        scrapPct: '0',
        component: pSemiFinished,
      },
    ],
  },
  {
    id: 'bom-2',
    productId: 'p-semi',
    isActive: true,
    items: [
      {
        componentId: 'p-raw',
        quantity: '3',
        scrapPct: '10', // 10% de perda
        component: pRaw,
      },
    ],
  },
];

describe('MrpService', () => {
  let service: MrpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MrpService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<MrpService>(MrpService);
    jest.clearAllMocks();
  });

  // ─── run ─────────────────────────────────────────────────────────────────

  describe('run', () => {
    it('deve criar MrpRun com status RUNNING e retornar runId', async () => {
      mockPrisma.systemParameter.findUnique.mockResolvedValue({ value: '30' });
      mockPrisma.mrpRun.create.mockResolvedValue({ id: 'run-1' });
      mockPrisma.demandForecast.findMany.mockResolvedValue([]);
      mockPrisma.bomVersion.findMany.mockResolvedValue([]);
      mockPrisma.stockBalance.findMany.mockResolvedValue([]);
      mockPrisma.mrpSuggestion.createMany.mockResolvedValue({ count: 0 });
      mockPrisma.mrpRun.update.mockResolvedValue({});

      const result = await service.run('co-1', 'u-1');

      expect(result).toEqual({ runId: 'run-1' });
      expect(mockPrisma.mrpRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ companyId: 'co-1', horizonDays: 30, status: 'RUNNING' }),
        }),
      );
    });

    it('deve usar horizonte padrão de 30 dias quando SystemParameter não existe', async () => {
      mockPrisma.systemParameter.findUnique.mockResolvedValue(null);
      mockPrisma.mrpRun.create.mockResolvedValue({ id: 'run-2' });
      mockPrisma.demandForecast.findMany.mockResolvedValue([]);
      mockPrisma.bomVersion.findMany.mockResolvedValue([]);
      mockPrisma.stockBalance.findMany.mockResolvedValue([]);
      mockPrisma.mrpRun.update.mockResolvedValue({});

      await service.run('co-1');

      expect(mockPrisma.mrpRun.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ horizonDays: 30 }) }),
      );
    });
  });

  // ─── calculateRequirements — explosão de BOM ─────────────────────────────

  describe('calculateRequirements', () => {
    it('deve retornar lista vazia quando não há previsões', async () => {
      mockPrisma.demandForecast.findMany.mockResolvedValue([]);
      mockPrisma.bomVersion.findMany.mockResolvedValue([]);
      mockPrisma.stockBalance.findMany.mockResolvedValue([]);

      const result = await service.calculateRequirements('co-1', 30);
      expect(result).toHaveLength(0);
    });

    it('deve explodir BOM multinível e agregar necessidades de componentes', async () => {
      // Demanda: 10 unidades do produto final
      mockPrisma.demandForecast.findMany.mockResolvedValue([
        { productId: 'p-finished', quantity: '10', product: pFinished },
      ]);
      mockPrisma.bomVersion.findMany.mockResolvedValue(boms);
      mockPrisma.stockBalance.findMany.mockResolvedValue([]);

      const result = await service.calculateRequirements('co-1', 30);

      // Espera sugestões para: p-finished (PRODUCTION), p-semi (PRODUCTION), p-raw (PURCHASE)
      expect(result.length).toBe(3);

      const finishedSug = result.find((r) => r.productId === 'p-finished');
      expect(finishedSug?.type).toBe('PRODUCTION');
      expect(Number(finishedSug?.grossQty)).toBe(10);
      expect(finishedSug?.bomLevel).toBe(0);

      const semiSug = result.find((r) => r.productId === 'p-semi');
      expect(semiSug?.type).toBe('PRODUCTION');
      expect(Number(semiSug?.grossQty)).toBe(20); // 10 × 2
      expect(semiSug?.bomLevel).toBe(1);

      // p-raw: 10 × 2 × 3 × 1.10 (scrap 10%) = 66
      const rawSug = result.find((r) => r.productId === 'p-raw');
      expect(rawSug?.type).toBe('PURCHASE');
      expect(Number(rawSug?.grossQty)).toBeCloseTo(66, 2);
      expect(rawSug?.bomLevel).toBe(2);
    });

    it('deve calcular necessidade líquida descontando estoque disponível', async () => {
      mockPrisma.demandForecast.findMany.mockResolvedValue([
        { productId: 'p-finished', quantity: '10', product: pFinished },
      ]);
      mockPrisma.bomVersion.findMany.mockResolvedValue(boms);
      // Estoque: 5 unidades do produto final disponíveis
      mockPrisma.stockBalance.findMany.mockResolvedValue([
        { productId: 'p-finished', available: '5' },
      ]);

      const result = await service.calculateRequirements('co-1', 30);

      const finishedSug = result.find((r) => r.productId === 'p-finished');
      expect(Number(finishedSug?.stockOnHand)).toBe(5);
      expect(Number(finishedSug?.netQty)).toBe(5); // 10 - 5 = 5
    });

    it('deve manter netQty = 0 quando estoque cobre a demanda', async () => {
      mockPrisma.demandForecast.findMany.mockResolvedValue([
        { productId: 'p-finished', quantity: '10', product: pFinished },
      ]);
      mockPrisma.bomVersion.findMany.mockResolvedValue([boms[0]]); // só BOM do finished
      mockPrisma.stockBalance.findMany.mockResolvedValue([
        { productId: 'p-finished', available: '15' }, // sobra estoque
      ]);

      const result = await service.calculateRequirements('co-1', 30);

      const finishedSug = result.find((r) => r.productId === 'p-finished');
      expect(Number(finishedSug?.netQty)).toBe(0);
      expect(finishedSug?.notes).toBe('Estoque cobre a demanda');
    });

    it('deve agregar estoque de múltiplos armazéns', async () => {
      mockPrisma.demandForecast.findMany.mockResolvedValue([
        { productId: 'p-raw', quantity: '100', product: pRaw },
      ]);
      mockPrisma.bomVersion.findMany.mockResolvedValue([]);
      // Estoque em 2 armazéns
      mockPrisma.stockBalance.findMany.mockResolvedValue([
        { productId: 'p-raw', available: '40' },
        { productId: 'p-raw', available: '30' },
      ]);

      const result = await service.calculateRequirements('co-1', 30);

      const rawSug = result.find((r) => r.productId === 'p-raw');
      expect(Number(rawSug?.stockOnHand)).toBe(70); // 40 + 30
      expect(Number(rawSug?.netQty)).toBe(30); // 100 - 70
    });

    it('produto sem BOM deve receber tipo PURCHASE', async () => {
      mockPrisma.demandForecast.findMany.mockResolvedValue([
        { productId: 'p-raw', quantity: '50', product: pRaw },
      ]);
      mockPrisma.bomVersion.findMany.mockResolvedValue([]); // sem BOM
      mockPrisma.stockBalance.findMany.mockResolvedValue([]);

      const result = await service.calculateRequirements('co-1', 30);

      expect(result[0]?.type).toBe('PURCHASE');
    });

    it('deve proteger contra BOM circular (não travar em loop)', async () => {
      // BOM circular: A → B → A
      const circularBoms = [
        { id: 'bom-a', productId: 'p-a', isActive: true, items: [{ componentId: 'p-b', quantity: '1', scrapPct: '0', component: { id: 'p-b', type: 'SEMI_FINISHED' } }] },
        { id: 'bom-b', productId: 'p-b', isActive: true, items: [{ componentId: 'p-a', quantity: '1', scrapPct: '0', component: { id: 'p-a', type: 'SEMI_FINISHED' } }] },
      ];
      mockPrisma.demandForecast.findMany.mockResolvedValue([
        { productId: 'p-a', quantity: '5', product: { id: 'p-a', type: 'SEMI_FINISHED' } },
      ]);
      mockPrisma.bomVersion.findMany.mockResolvedValue(circularBoms);
      mockPrisma.stockBalance.findMany.mockResolvedValue([]);

      // Não deve lançar erro nem loop infinito
      await expect(service.calculateRequirements('co-1', 30)).resolves.toBeDefined();
    });
  });

  // ─── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('deve listar rodadas MRP da empresa', async () => {
      mockPrisma.mrpRun.findMany.mockResolvedValue([
        { id: 'run-1', status: 'DONE', horizonDays: 30, _count: { suggestions: 5 } },
      ]);

      const result = await service.findAll('co-1');

      expect(mockPrisma.mrpRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: 'co-1' } }),
      );
      expect(result).toHaveLength(1);
    });
  });

  // ─── findOne ──────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('deve retornar run com sugestões', async () => {
      mockPrisma.mrpRun.findFirst.mockResolvedValue({
        id: 'run-1',
        companyId: 'co-1',
        status: 'DONE',
        suggestions: [],
      });

      const result = await service.findOne('run-1', 'co-1');
      expect(result.id).toBe('run-1');
    });

    it('deve lançar NotFoundException para run de outra empresa', async () => {
      mockPrisma.mrpRun.findFirst.mockResolvedValue(null);
      await expect(service.findOne('run-x', 'co-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── findGaps ─────────────────────────────────────────────────────────────

  describe('findGaps', () => {
    it('deve retornar apenas sugestões com netQty > 0', async () => {
      mockPrisma.mrpRun.findFirst.mockResolvedValue({
        id: 'run-1',
        companyId: 'co-1',
        status: 'DONE',
        suggestions: [
          { productId: 'p-1', netQty: '10', bomLevel: 0, product: { name: 'A' } },
          { productId: 'p-2', netQty: '0', bomLevel: 1, product: { name: 'B' } },
          { productId: 'p-3', netQty: '5', bomLevel: 1, product: { name: 'C' } },
        ],
      });

      const result = await service.findGaps('run-1', 'co-1');
      expect(result.suggestions).toHaveLength(2);
      expect(result.suggestions.every((s) => Number(s.netQty) > 0)).toBe(true);
    });
  });
});
