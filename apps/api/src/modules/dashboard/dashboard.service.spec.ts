import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  salesOrder: { groupBy: jest.fn(), findMany: jest.fn() },
  saleItem: { aggregate: jest.fn(), groupBy: jest.fn() },
  financialEntry: { groupBy: jest.fn(), aggregate: jest.fn(), findMany: jest.fn() },
  productionOrder: { groupBy: jest.fn(), findMany: jest.fn() },
  stockBalance: { groupBy: jest.fn(), count: jest.fn(), aggregate: jest.fn() },
  purchaseOrder: { groupBy: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  product: { findMany: jest.fn() },
  customer: { findMany: jest.fn() },
  supplier: { findMany: jest.fn() },
  warehouse: { findMany: jest.fn() },
};

describe('DashboardService', () => {
  let service: DashboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    jest.clearAllMocks();
  });

  // ─── getExecutive ────────────────────────────────────────────────────────

  describe('getExecutive', () => {
    it('retorna estrutura completa com KPIs', async () => {
      mockPrisma.salesOrder.groupBy.mockResolvedValue([
        { status: 'INVOICED', _count: { id: 10 } },
        { status: 'DRAFT', _count: { id: 3 } },
      ]);
      mockPrisma.saleItem.aggregate.mockResolvedValue({ _sum: { quantity: 5, unitPrice: 100 } });
      mockPrisma.financialEntry.aggregate.mockResolvedValue({ _sum: { amount: 5000 }, _count: { id: 2 } });
      mockPrisma.productionOrder.groupBy.mockResolvedValue([
        { status: 'IN_PROGRESS', _count: { id: 4 } },
      ]);
      mockPrisma.stockBalance.aggregate.mockResolvedValue({ _sum: { available: 1200 }, _count: { id: 80 } });
      mockPrisma.purchaseOrder.count.mockResolvedValue(5);

      const result = await service.getExecutive('c1');

      expect(result).toHaveProperty('sales');
      expect(result).toHaveProperty('finance');
      expect(result).toHaveProperty('production');
      expect(result).toHaveProperty('stock');
      expect(result).toHaveProperty('purchases');
      expect(result.sales.byStatus).toHaveProperty('INVOICED', 10);
      expect(result.production.byStatus).toHaveProperty('IN_PROGRESS', 4);
      expect(result.stock.totalPositions).toBe(80);
      expect(result.purchases.pendingOrders).toBe(5);
    });
  });

  // ─── getSales ────────────────────────────────────────────────────────────

  describe('getSales', () => {
    it('retorna breakdown por status, receita mensal e tops', async () => {
      mockPrisma.salesOrder.groupBy.mockResolvedValue([
        { status: 'INVOICED', _count: { id: 10 } },
      ]);
      mockPrisma.salesOrder.findMany.mockResolvedValue([]);
      mockPrisma.saleItem.groupBy.mockResolvedValue([
        { productId: 'p1', _sum: { quantity: 50 } },
      ]);
      mockPrisma.product.findMany.mockResolvedValue([{ id: 'p1', sku: 'SKU-01', name: 'Produto 1' }]);
      mockPrisma.customer.findMany.mockResolvedValue([]);
      // topCustomers groupBy
      mockPrisma.salesOrder.groupBy
        .mockResolvedValueOnce([{ status: 'INVOICED', _count: { id: 10 } }])
        .mockResolvedValueOnce([]);

      const result = await service.getSales('c1');

      expect(result).toHaveProperty('byStatus');
      expect(result).toHaveProperty('monthlyRevenue');
      expect(result.monthlyRevenue).toHaveLength(6);
      expect(result).toHaveProperty('topProducts');
      expect(result).toHaveProperty('topCustomers');
    });

    it('monthlyRevenue tem exatamente 6 meses', async () => {
      mockPrisma.salesOrder.groupBy.mockResolvedValue([]);
      mockPrisma.salesOrder.findMany.mockResolvedValue([]);
      mockPrisma.saleItem.groupBy.mockResolvedValue([]);
      mockPrisma.product.findMany.mockResolvedValue([]);
      mockPrisma.customer.findMany.mockResolvedValue([]);

      const result = await service.getSales('c1');
      expect(result.monthlyRevenue).toHaveLength(6);
    });
  });

  // ─── getFinance ──────────────────────────────────────────────────────────

  describe('getFinance', () => {
    it('retorna recebíveis, pagáveis, próximos 7 dias e fluxo mensal', async () => {
      mockPrisma.financialEntry.groupBy
        .mockResolvedValueOnce([{ status: 'OPEN', _sum: { amount: 10000 }, _count: { id: 5 } }])
        .mockResolvedValueOnce([{ status: 'OPEN', _sum: { amount: 3000 }, _count: { id: 2 } }]);
      mockPrisma.financialEntry.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 500 }, _count: { id: 1 } })
        .mockResolvedValueOnce({ _sum: { amount: 200 }, _count: { id: 1 } });
      mockPrisma.financialEntry.findMany.mockResolvedValue([]);

      const result = await service.getFinance('c1');

      expect(result).toHaveProperty('receivable');
      expect(result).toHaveProperty('payable');
      expect(result).toHaveProperty('upcoming7Days');
      expect(result).toHaveProperty('monthlyCashFlow');
      expect(result.monthlyCashFlow).toHaveLength(6);
      expect(result.upcoming7Days.receivable.amount).toBe(500);
    });
  });

  // ─── getProduction ───────────────────────────────────────────────────────

  describe('getProduction', () => {
    it('retorna byStatus, monthlyDone e topProducts', async () => {
      mockPrisma.productionOrder.groupBy.mockResolvedValue([
        { status: 'DONE', _count: { id: 20 } },
        { status: 'IN_PROGRESS', _count: { id: 3 } },
      ]);
      mockPrisma.productionOrder.findMany.mockResolvedValue([]);
      mockPrisma.productionOrder.groupBy
        .mockResolvedValueOnce([{ status: 'DONE', _count: { id: 20 } }])
        .mockResolvedValueOnce([{ productId: 'p1', _sum: { plannedQty: 100 } }]);
      mockPrisma.product.findMany.mockResolvedValue([{ id: 'p1', sku: 'SKU-01', name: 'Reboque' }]);

      const result = await service.getProduction('c1');

      expect(result).toHaveProperty('byStatus');
      expect(result).toHaveProperty('monthlyDone');
      expect(result.monthlyDone).toHaveLength(6);
      expect(result).toHaveProperty('topProducts');
    });
  });

  // ─── getStock ────────────────────────────────────────────────────────────

  describe('getStock', () => {
    it('retorna totais e breakdown por armazém', async () => {
      mockPrisma.stockBalance.groupBy.mockResolvedValue([
        { warehouseId: 'w1', _sum: { available: 500, reserved: 20 }, _count: { id: 40 } },
      ]);
      mockPrisma.stockBalance.count
        .mockResolvedValueOnce(5)   // zeroStock
        .mockResolvedValueOnce(10)  // lowStock
        .mockResolvedValueOnce(80); // totalSkus
      mockPrisma.warehouse.findMany.mockResolvedValue([{ id: 'w1', code: 'ALM', name: 'Almoxarifado' }]);

      const result = await service.getStock('c1');

      expect(result.totalSkus).toBe(80);
      expect(result.zeroStockSkus).toBe(5);
      expect(result.lowStockSkus).toBe(10);
      expect(result.byWarehouse).toHaveLength(1);
      expect(result.byWarehouse[0].totalAvailable).toBe(500);
    });
  });

  // ─── getPurchases ─────────────────────────────────────────────────────────

  describe('getPurchases', () => {
    it('retorna byStatus, valor mensal e top fornecedores', async () => {
      mockPrisma.purchaseOrder.groupBy
        .mockResolvedValueOnce([
          { status: 'APPROVED', _count: { id: 3 } },
          { status: 'RECEIVED', _count: { id: 10 } },
        ])
        .mockResolvedValueOnce([{ supplierId: 's1', _count: { id: 5 } }]);
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([]);
      mockPrisma.supplier.findMany.mockResolvedValue([{ id: 's1', name: 'Fornecedor A' }]);

      const result = await service.getPurchases('c1');

      expect(result).toHaveProperty('byStatus');
      expect(result.byStatus).toHaveProperty('APPROVED', 3);
      expect(result.monthlyValue).toHaveLength(6);
      expect((result.topSuppliers[0].supplier as any).name).toBe('Fornecedor A');
    });
  });
});
