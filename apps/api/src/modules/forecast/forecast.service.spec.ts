import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ForecastService } from './forecast.service';
import { PrismaService } from '../../prisma/prisma.service';

const COMPANY = 'comp-1';
const USER = 'user-1';

// ─── helpers ──────────────────────────────────────────────────────────────────

function invoicedSaleItems(
  entries: Array<{ productId: string; qty: number; invoicedAt: Date }>,
) {
  return entries.map((e) => ({
    productId: e.productId,
    quantity: e.qty,
    product: { id: e.productId, sku: `SKU-${e.productId}`, name: `Prod ${e.productId}` },
    salesOrder: { invoicedAt: e.invoicedAt },
  }));
}

// ─── mock Prisma ──────────────────────────────────────────────────────────────

const mockPrisma = {
  saleItem: { findMany: jest.fn() },
  product: { findMany: jest.fn() },
  demandForecast: {
    upsert: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  auditLog: { create: jest.fn() },
};

describe('ForecastService', () => {
  let service: ForecastService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ForecastService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ForecastService>(ForecastService);
    jest.clearAllMocks();
  });

  // ─── getSalesHistory ───────────────────────────────────────────────────────

  describe('getSalesHistory', () => {
    it('agrega vendas por período YYYY-MM', async () => {
      const jan = new Date('2026-01-15');
      const fev = new Date('2026-02-10');
      mockPrisma.saleItem.findMany.mockResolvedValue(
        invoicedSaleItems([
          { productId: 'p1', qty: 50, invoicedAt: jan },
          { productId: 'p1', qty: 30, invoicedAt: jan },  // mesmo mês → soma
          { productId: 'p1', qty: 20, invoicedAt: fev },
        ]),
      );

      const result = await service.getSalesHistory(COMPANY, 'p1');
      expect(result).toHaveLength(2);
      expect(result.find((r) => r.period === '2026-01')?.qty).toBe(80);
      expect(result.find((r) => r.period === '2026-02')?.qty).toBe(20);
    });

    it('retorna array vazio quando não há vendas', async () => {
      mockPrisma.saleItem.findMany.mockResolvedValue([]);
      const result = await service.getSalesHistory(COMPANY, 'p1');
      expect(result).toHaveLength(0);
    });

    it('ignora itens sem invoicedAt', async () => {
      mockPrisma.saleItem.findMany.mockResolvedValue([
        { productId: 'p1', quantity: 10, salesOrder: { invoicedAt: null }, product: {} },
      ]);
      const result = await service.getSalesHistory(COMPANY, 'p1');
      expect(result).toHaveLength(0);
    });
  });

  // ─── generateForecasts ─────────────────────────────────────────────────────

  describe('generateForecasts', () => {
    it('gera previsão para produto com histórico suficiente', async () => {
      mockPrisma.product.findMany.mockResolvedValue([
        { id: 'p1', sku: 'SKU-001', name: 'Produto A' },
      ]);

      // histórico: jan=100, fev=200, mar=300
      const items = [
        { productId: 'p1', qty: 100, invoicedAt: new Date('2026-01-10') },
        { productId: 'p1', qty: 200, invoicedAt: new Date('2026-02-10') },
        { productId: 'p1', qty: 300, invoicedAt: new Date('2026-03-10') },
      ];
      mockPrisma.saleItem.findMany.mockResolvedValue(invoicedSaleItems(items));

      const mockDf = {
        id: 'df-1',
        quantity: 233,
        notes: 'Auto-gerado: WMA 3m',
      };
      mockPrisma.demandForecast.upsert.mockResolvedValue(mockDf);

      const result = await service.generateForecasts(
        { companyId: COMPANY, targetPeriod: '2026-04' },
        USER,
      );

      expect(result.generated).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.targetPeriod).toBe('2026-04');
      expect(result.results[0].forecast.wma).toBeGreaterThan(0);
      expect(mockPrisma.demandForecast.upsert).toHaveBeenCalledTimes(1);
    });

    it('pula produto com histórico insuficiente (< 3 meses)', async () => {
      mockPrisma.product.findMany.mockResolvedValue([
        { id: 'p1', sku: 'SKU-001', name: 'Produto A' },
      ]);
      // apenas 2 meses de histórico
      mockPrisma.saleItem.findMany.mockResolvedValue(
        invoicedSaleItems([
          { productId: 'p1', qty: 100, invoicedAt: new Date('2026-01-10') },
          { productId: 'p1', qty: 200, invoicedAt: new Date('2026-02-10') },
        ]),
      );

      const result = await service.generateForecasts(
        { companyId: COMPANY, targetPeriod: '2026-04' },
        USER,
      );

      expect(result.generated).toBe(0);
      expect(result.skipped).toBe(1);
      expect(mockPrisma.demandForecast.upsert).not.toHaveBeenCalled();
    });

    it('pula produto quando previsão é zero ou negativa', async () => {
      mockPrisma.product.findMany.mockResolvedValue([
        { id: 'p1', sku: 'SKU-001', name: 'Produto A' },
      ]);
      // histórico com zeros
      mockPrisma.saleItem.findMany.mockResolvedValue(
        invoicedSaleItems([
          { productId: 'p1', qty: 0, invoicedAt: new Date('2026-01-10') },
          { productId: 'p1', qty: 0, invoicedAt: new Date('2026-02-10') },
          { productId: 'p1', qty: 0, invoicedAt: new Date('2026-03-10') },
        ]),
      );

      const result = await service.generateForecasts(
        { companyId: COMPANY, targetPeriod: '2026-04' },
        USER,
      );

      expect(result.generated).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('usa windowMonths customizado', async () => {
      mockPrisma.product.findMany.mockResolvedValue([
        { id: 'p1', sku: 'SKU-001', name: 'Produto A' },
      ]);
      const items = [];
      for (let m = 1; m <= 6; m++) {
        items.push({
          productId: 'p1',
          qty: 100,
          invoicedAt: new Date(`2026-${String(m).padStart(2, '0')}-10`),
        });
      }
      mockPrisma.saleItem.findMany.mockResolvedValue(invoicedSaleItems(items));
      mockPrisma.demandForecast.upsert.mockResolvedValue({ id: 'df-1', quantity: 100 });

      const result = await service.generateForecasts(
        { companyId: COMPANY, targetPeriod: '2026-07', windowMonths: 6 },
        USER,
      );

      expect(result.generated).toBe(1);
      expect(result.results[0].forecast.windowMonths).toBe(6);
    });
  });

  // ─── adjustForecast ────────────────────────────────────────────────────────

  describe('adjustForecast', () => {
    it('atualiza quantidade e registra audit log', async () => {
      const existing = {
        id: 'df-1',
        companyId: COMPANY,
        productId: 'p1',
        period: '2026-04',
        quantity: 233,
        notes: 'Auto-gerado',
      };
      mockPrisma.demandForecast.findFirst.mockResolvedValue(existing);
      mockPrisma.demandForecast.update.mockResolvedValue({
        ...existing,
        quantity: 280,
        product: { id: 'p1', sku: 'SKU-001', name: 'Prod A', unit: 'UN' },
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.adjustForecast(
        'df-1',
        COMPANY,
        { quantity: 280, notes: 'Promoção prevista' },
        USER,
      );

      expect(result.quantity).toBe(280);
      expect(mockPrisma.demandForecast.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'df-1' },
          data: expect.objectContaining({ quantity: 280 }),
        }),
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'UPDATE', entity: 'DemandForecast' }),
        }),
      );
    });

    it('lança NotFoundException quando previsão não existe', async () => {
      mockPrisma.demandForecast.findFirst.mockResolvedValue(null);
      await expect(
        service.adjustForecast('nao-existe', COMPANY, { quantity: 100 }, USER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── runBacktest ───────────────────────────────────────────────────────────

  describe('runBacktest', () => {
    it('retorna summary com productsWithData=0 quando sem vendas', async () => {
      mockPrisma.saleItem.findMany.mockResolvedValue([]);
      const result = await service.runBacktest(COMPANY);
      expect(result.summary.totalProducts).toBe(0);
      expect(result.summary.productsWithData).toBe(0);
      expect(result.summary.avgMape).toBeNull();
    });

    it('calcula MAPE para série estável', async () => {
      // 9 meses de 100 unidades para p1
      const items: Array<{ productId: string; qty: number; invoicedAt: Date }> = [];
      for (let m = 1; m <= 9; m++) {
        items.push({
          productId: 'p1',
          qty: 100,
          invoicedAt: new Date(`2026-${String(m).padStart(2, '0')}-10`),
        });
      }
      mockPrisma.saleItem.findMany.mockResolvedValue(
        invoicedSaleItems(items).map((i) => ({
          ...i,
          product: { id: 'p1', sku: 'SKU-001', name: 'Prod A' },
        })),
      );

      const result = await service.runBacktest(COMPANY, {
        testMonths: 3,
        windowMonths: 3,
      });

      expect(result.summary.productsWithData).toBe(1);
      expect(result.summary.avgMape).toBe(0);
      expect(result.summary.avgAccuracy).toBe(100);
      expect(result.summary.meetsTarget).toBe(true); // MAPE < 30%
    });

    it('meetsTarget=false quando MAPE >= 30', async () => {
      // alterna 100 e 300 para gerar erro alto
      const items: Array<{ productId: string; qty: number; invoicedAt: Date }> = [];
      for (let m = 1; m <= 9; m++) {
        items.push({
          productId: 'p1',
          qty: m % 2 === 0 ? 300 : 100,
          invoicedAt: new Date(`2026-${String(m).padStart(2, '0')}-10`),
        });
      }
      mockPrisma.saleItem.findMany.mockResolvedValue(
        invoicedSaleItems(items).map((i) => ({
          ...i,
          product: { id: 'p1', sku: 'SKU-001', name: 'Prod A' },
        })),
      );

      const result = await service.runBacktest(COMPANY, {
        testMonths: 3,
        windowMonths: 3,
      });

      // Com alta variabilidade MAPE deve ser elevado
      expect(result.summary.avgMape).toBeGreaterThan(0);
    });
  });

  // ─── listForecasts ─────────────────────────────────────────────────────────

  describe('listForecasts', () => {
    it('retorna previsões para o período solicitado', async () => {
      mockPrisma.demandForecast.findMany.mockResolvedValue([
        {
          id: 'df-1',
          period: '2026-04',
          quantity: 233,
          product: { id: 'p1', sku: 'SKU-001', name: 'Prod A', unit: 'UN' },
        },
      ]);

      const result = await service.listForecasts(COMPANY, '2026-04');
      expect(result).toHaveLength(1);
      expect(mockPrisma.demandForecast.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: COMPANY, period: '2026-04' } }),
      );
    });
  });
});
