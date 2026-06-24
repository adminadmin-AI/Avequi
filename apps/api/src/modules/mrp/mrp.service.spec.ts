import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MrpService } from './mrp.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  systemParameter: { findUnique: jest.fn() },
  mrpRun: { create: jest.fn(), update: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
  mrpSuggestion: { createMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  demandForecast: { findMany: jest.fn() },
  bomVersion: { findMany: jest.fn(), findFirst: jest.fn() },
  stockBalance: { findMany: jest.fn() },
  product: { findMany: jest.fn() },
  salesOrder: { findMany: jest.fn() },
  pOItem: { findMany: jest.fn() },
  purchaseOrder: { create: jest.fn() },
  productionOrder: { create: jest.fn() },
  warehouse: { findFirst: jest.fn() },
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
    // Defaults para novos queries (#181, #183)
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.salesOrder.findMany.mockResolvedValue([]);
    mockPrisma.pOItem.findMany.mockResolvedValue([]);
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

  // ─── calculateRequirements — lote mínimo e múltiplo (#181) ────────────────

  describe('calculateRequirements — lot sizing (#181)', () => {
    it('deve arredondar netQty ao múltiplo mais próximo (necessidade 7, múltiplo 10 → 10)', async () => {
      mockPrisma.demandForecast.findMany.mockResolvedValue([
        {
          productId: 'p-raw',
          quantity: '12',
          product: { id: 'p-raw', type: 'RAW_MATERIAL', minOrderQty: null, orderMultiple: '10', minProductionQty: null, productionMultiple: null },
        },
      ]);
      mockPrisma.bomVersion.findMany.mockResolvedValue([]);
      // Estoque de 5 → netQty bruto = 7
      mockPrisma.stockBalance.findMany.mockResolvedValue([
        { productId: 'p-raw', available: '5' },
      ]);

      const result = await service.calculateRequirements('co-1', 30);
      const raw = result.find((r) => r.productId === 'p-raw');
      expect(Number(raw?.netQty)).toBe(10); // arredondado de 7 para 10
    });

    it('deve respeitar lote mínimo (necessidade 3, mínimo 50 → 50)', async () => {
      mockPrisma.demandForecast.findMany.mockResolvedValue([
        {
          productId: 'p-raw',
          quantity: '3',
          product: { id: 'p-raw', type: 'RAW_MATERIAL', minOrderQty: '50', orderMultiple: null, minProductionQty: null, productionMultiple: null },
        },
      ]);
      mockPrisma.bomVersion.findMany.mockResolvedValue([]);
      mockPrisma.stockBalance.findMany.mockResolvedValue([]);

      const result = await service.calculateRequirements('co-1', 30);
      const raw = result.find((r) => r.productId === 'p-raw');
      expect(Number(raw?.netQty)).toBe(50); // mínimo de compra
    });

    it('deve combinar mínimo + múltiplo (necessidade 3, mínimo 50, múltiplo 25 → 50)', async () => {
      mockPrisma.demandForecast.findMany.mockResolvedValue([
        {
          productId: 'p-raw',
          quantity: '3',
          product: { id: 'p-raw', type: 'RAW_MATERIAL', minOrderQty: '50', orderMultiple: '25', minProductionQty: null, productionMultiple: null },
        },
      ]);
      mockPrisma.bomVersion.findMany.mockResolvedValue([]);
      mockPrisma.stockBalance.findMany.mockResolvedValue([]);

      const result = await service.calculateRequirements('co-1', 30);
      const raw = result.find((r) => r.productId === 'p-raw');
      expect(Number(raw?.netQty)).toBe(50); // mínimo 50, já é múltiplo de 25
    });

    it('deve usar minProductionQty para tipo PRODUCTION', async () => {
      mockPrisma.demandForecast.findMany.mockResolvedValue([
        {
          productId: 'p-semi',
          quantity: '5',
          product: { id: 'p-semi', type: 'SEMI_FINISHED', minOrderQty: null, orderMultiple: null, minProductionQty: '20', productionMultiple: '10' },
        },
      ]);
      // Tem BOM → tipo PRODUCTION
      mockPrisma.bomVersion.findMany.mockResolvedValue([
        { id: 'bom-s', productId: 'p-semi', isActive: true, items: [] },
      ]);
      mockPrisma.stockBalance.findMany.mockResolvedValue([]);

      const result = await service.calculateRequirements('co-1', 30);
      const semi = result.find((r) => r.productId === 'p-semi');
      expect(semi?.type).toBe('PRODUCTION');
      expect(Number(semi?.netQty)).toBe(20); // mínimo produção = 20
    });

    it('deve aplicar lotização em componentes (explodidos via BOM)', async () => {
      mockPrisma.demandForecast.findMany.mockResolvedValue([
        {
          productId: 'p-finished',
          quantity: '1',
          product: { id: 'p-finished', type: 'FINISHED_GOOD', minOrderQty: null, orderMultiple: null, minProductionQty: null, productionMultiple: null },
        },
      ]);
      // BOM: finished → raw (qty: 3)
      mockPrisma.bomVersion.findMany.mockResolvedValue([
        {
          id: 'bom-f', productId: 'p-finished', isActive: true,
          items: [{ componentId: 'p-raw', quantity: '3', scrapPct: '0', component: { id: 'p-raw', type: 'RAW_MATERIAL' } }],
        },
      ]);
      mockPrisma.stockBalance.findMany.mockResolvedValue([]);
      // Componente raw tem múltiplo de compra = 100
      mockPrisma.product.findMany.mockResolvedValue([
        { id: 'p-raw', minOrderQty: null, orderMultiple: '100', minProductionQty: null, productionMultiple: null },
      ]);

      const result = await service.calculateRequirements('co-1', 30);
      const raw = result.find((r) => r.productId === 'p-raw');
      expect(Number(raw?.netQty)).toBe(100); // 3 arredondado para 100
    });

    it('não deve ajustar quando netQty é 0 (estoque cobre)', async () => {
      mockPrisma.demandForecast.findMany.mockResolvedValue([
        {
          productId: 'p-raw',
          quantity: '5',
          product: { id: 'p-raw', type: 'RAW_MATERIAL', minOrderQty: '100', orderMultiple: '50', minProductionQty: null, productionMultiple: null },
        },
      ]);
      mockPrisma.bomVersion.findMany.mockResolvedValue([]);
      mockPrisma.stockBalance.findMany.mockResolvedValue([
        { productId: 'p-raw', available: '10' }, // cobre toda a demanda
      ]);

      const result = await service.calculateRequirements('co-1', 30);
      const raw = result.find((r) => r.productId === 'p-raw');
      expect(Number(raw?.netQty)).toBe(0); // sem ajuste, estoque suficiente
    });
  });

  // ─── calculateRequirements — pedidos firmes + lead time (#183) ────────────

  describe('calculateRequirements — firm orders & lead time (#183)', () => {
    it('deve incluir SalesOrders CONFIRMED como demanda firme', async () => {
      // Sem forecasts mas com pedido firme
      mockPrisma.demandForecast.findMany.mockResolvedValue([]);
      mockPrisma.salesOrder.findMany.mockResolvedValue([
        {
          id: 'so-1',
          status: 'CONFIRMED',
          items: [{ productId: 'p-raw', quantity: '15' }],
        },
      ]);
      mockPrisma.bomVersion.findMany.mockResolvedValue([]);
      mockPrisma.stockBalance.findMany.mockResolvedValue([]);

      const result = await service.calculateRequirements('co-1', 30);
      const raw = result.find((r) => r.productId === 'p-raw');
      expect(Number(raw?.grossQty)).toBe(15);
      expect(Number(raw?.netQty)).toBe(15);
    });

    it('deve somar demanda de forecast + pedidos firmes', async () => {
      mockPrisma.demandForecast.findMany.mockResolvedValue([
        { productId: 'p-raw', quantity: '10', product: { id: 'p-raw', type: 'RAW_MATERIAL', minOrderQty: null, orderMultiple: null, minProductionQty: null, productionMultiple: null, leadTimeDays: 0 } },
      ]);
      mockPrisma.salesOrder.findMany.mockResolvedValue([
        { id: 'so-1', status: 'CONFIRMED', items: [{ productId: 'p-raw', quantity: '5' }] },
      ]);
      mockPrisma.bomVersion.findMany.mockResolvedValue([]);
      mockPrisma.stockBalance.findMany.mockResolvedValue([]);

      const result = await service.calculateRequirements('co-1', 30);
      const raw = result.find((r) => r.productId === 'p-raw');
      expect(Number(raw?.grossQty)).toBe(15); // 10 + 5
    });

    it('PO pendente deve reduzir necessidade líquida', async () => {
      mockPrisma.demandForecast.findMany.mockResolvedValue([
        { productId: 'p-raw', quantity: '100', product: { id: 'p-raw', type: 'RAW_MATERIAL', minOrderQty: null, orderMultiple: null, minProductionQty: null, productionMultiple: null, leadTimeDays: 0 } },
      ]);
      mockPrisma.salesOrder.findMany.mockResolvedValue([]);
      mockPrisma.bomVersion.findMany.mockResolvedValue([]);
      mockPrisma.stockBalance.findMany.mockResolvedValue([
        { productId: 'p-raw', available: '20', inTransit: '10' },
      ]);
      // PO pendente com 30 unidades
      mockPrisma.pOItem.findMany.mockResolvedValue([
        { productId: 'p-raw', quantity: '30' },
      ]);

      const result = await service.calculateRequirements('co-1', 30);
      const raw = result.find((r) => r.productId === 'p-raw');
      // supply = 20 (available) + 10 (inTransit) + 30 (PO) = 60
      expect(Number(raw?.netQty)).toBe(40); // 100 - 60
    });

    it('lead time offset: suggestedDate deve antecipar pela leadTimeDays', async () => {
      mockPrisma.demandForecast.findMany.mockResolvedValue([
        { productId: 'p-raw', quantity: '10', product: { id: 'p-raw', type: 'RAW_MATERIAL', minOrderQty: null, orderMultiple: null, minProductionQty: null, productionMultiple: null, leadTimeDays: 10 } },
      ]);
      mockPrisma.salesOrder.findMany.mockResolvedValue([]);
      mockPrisma.bomVersion.findMany.mockResolvedValue([]);
      mockPrisma.stockBalance.findMany.mockResolvedValue([]);

      const result = await service.calculateRequirements('co-1', 30);
      const raw = result.find((r) => r.productId === 'p-raw');

      // suggestedDate deve ser ~20 dias no futuro (30 - 10)
      const now = new Date();
      const expectedDate = new Date();
      expectedDate.setDate(now.getDate() + 20); // 30 horizonte - 10 lead time
      const diffDays = Math.round((raw!.suggestedDate!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(20);
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

  // ─── convertSuggestion (#179) ─────────────────────────────────────────────

  describe('convertSuggestion', () => {
    const baseSuggestion = {
      id: 'sug-1',
      productId: 'p-1',
      netQty: '50',
      suggestedDate: new Date('2026-07-01'),
      mrpRun: { companyId: 'co-1' },
      product: { id: 'p-1', name: 'Parafuso M10', supplierId: 'sup-1' },
      type: 'PURCHASE',
      status: 'PENDING',
    };

    it('deve converter sugestão PURCHASE em PurchaseOrder DRAFT', async () => {
      mockPrisma.mrpSuggestion.findFirst.mockResolvedValue({ ...baseSuggestion });
      mockPrisma.purchaseOrder.create.mockResolvedValue({
        id: 'po-1',
        supplierId: 'sup-1',
        status: 'DRAFT',
        items: [{ productId: 'p-1', quantity: '50' }],
        supplier: { id: 'sup-1', name: 'Fornecedor X' },
      });
      mockPrisma.mrpSuggestion.update.mockResolvedValue({});

      const result = await service.convertSuggestion('sug-1', 'co-1');

      expect(result.type).toBe('PURCHASE');
      expect(result.purchaseOrderId).toBe('po-1');
      expect(mockPrisma.purchaseOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: 'co-1',
            supplierId: 'sup-1',
            status: 'DRAFT',
          }),
        }),
      );
      expect(mockPrisma.mrpSuggestion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sug-1' },
          data: expect.objectContaining({ status: 'CONVERTED', convertedPoId: 'po-1' }),
        }),
      );
    });

    it('deve converter sugestão PRODUCTION em ProductionOrder DRAFT com itens de BOM', async () => {
      const prodSuggestion = {
        ...baseSuggestion,
        id: 'sug-2',
        type: 'PRODUCTION',
        product: { id: 'p-1', name: 'Reboque 5T', supplierId: null },
      };
      mockPrisma.mrpSuggestion.findFirst.mockResolvedValue(prodSuggestion);
      mockPrisma.bomVersion.findFirst.mockResolvedValue({
        id: 'bom-1',
        items: [
          { componentId: 'c-1', quantity: '2' },
          { componentId: 'c-2', quantity: '5' },
        ],
      });
      mockPrisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-1' });
      mockPrisma.productionOrder.create.mockResolvedValue({
        id: 'op-1',
        status: 'DRAFT',
        items: [],
        product: { id: 'p-1', name: 'Reboque 5T' },
      });
      mockPrisma.mrpSuggestion.update.mockResolvedValue({});

      const result = await service.convertSuggestion('sug-2', 'co-1');

      expect(result.type).toBe('PRODUCTION');
      expect(result.productionOrderId).toBe('op-1');
      expect(mockPrisma.productionOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: 'co-1',
            productId: 'p-1',
            warehouseId: 'wh-1',
            status: 'DRAFT',
          }),
        }),
      );
    });

    it('deve lançar NotFoundException para sugestão inexistente', async () => {
      mockPrisma.mrpSuggestion.findFirst.mockResolvedValue(null);

      await expect(service.convertSuggestion('sug-x', 'co-1')).rejects.toThrow(NotFoundException);
    });

    it('deve lançar BadRequestException para sugestão já convertida', async () => {
      mockPrisma.mrpSuggestion.findFirst.mockResolvedValue({
        ...baseSuggestion,
        status: 'CONVERTED',
      });

      await expect(service.convertSuggestion('sug-1', 'co-1')).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException quando PURCHASE sem fornecedor', async () => {
      mockPrisma.mrpSuggestion.findFirst.mockResolvedValue({
        ...baseSuggestion,
        product: { id: 'p-1', name: 'Sem Fornecedor', supplierId: null },
      });

      await expect(service.convertSuggestion('sug-1', 'co-1')).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException quando netQty <= 0', async () => {
      mockPrisma.mrpSuggestion.findFirst.mockResolvedValue({
        ...baseSuggestion,
        netQty: '0',
      });

      await expect(service.convertSuggestion('sug-1', 'co-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── convertBatch (#179) ──────────────────────────────────────────────────

  describe('convertBatch', () => {
    it('deve converter múltiplas sugestões e coletar erros', async () => {
      // sug-ok: converte com sucesso
      mockPrisma.mrpSuggestion.findFirst
        .mockResolvedValueOnce({
          id: 'sug-ok',
          productId: 'p-1',
          netQty: '10',
          type: 'PURCHASE',
          status: 'PENDING',
          suggestedDate: null,
          mrpRun: { companyId: 'co-1' },
          product: { id: 'p-1', name: 'Prod A', supplierId: 'sup-1' },
        })
        // sug-fail: não encontrada
        .mockResolvedValueOnce(null);

      mockPrisma.purchaseOrder.create.mockResolvedValue({
        id: 'po-1',
        items: [],
        supplier: { id: 'sup-1' },
      });
      mockPrisma.mrpSuggestion.update.mockResolvedValue({});

      const result = await service.convertBatch(['sug-ok', 'sug-fail'], 'co-1');

      expect(result.total).toBe(2);
      expect(result.successCount).toBe(1);
      expect(result.converted).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].suggestionId).toBe('sug-fail');
    });
  });
});
