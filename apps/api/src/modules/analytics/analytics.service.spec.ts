import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  salesOrder: { aggregate: jest.fn(), count: jest.fn() },
  saleItem: { aggregate: jest.fn() },
  stockBalance: { aggregate: jest.fn(), count: jest.fn() },
  productionOrder: { aggregate: jest.fn(), count: jest.fn() },
  productionCost: { aggregate: jest.fn() },
  nonConformance: { aggregate: jest.fn(), count: jest.fn() },
  $queryRaw: jest.fn(),
};

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  // ─── getOlapSummary ─────────────────────────────────────────────────────

  describe('getOlapSummary', () => {
    it('should return combined KPIs for all cubes', async () => {
      mockPrisma.salesOrder.aggregate.mockResolvedValue({ _count: { id: 10 } });
      mockPrisma.saleItem.aggregate.mockResolvedValue({
        _sum: { quantity: 100, unitPrice: 50 },
      });
      mockPrisma.stockBalance.count
        .mockResolvedValueOnce(25)  // totalSkus
        .mockResolvedValueOnce(3);  // slowMovingCount
      mockPrisma.stockBalance.aggregate.mockResolvedValue({
        _sum: { available: 500 },
      });
      mockPrisma.productionOrder.aggregate.mockResolvedValue({
        _count: { id: 5 },
        _sum: { producedQty: 100 },
      });
      mockPrisma.productionCost.aggregate.mockResolvedValue({
        _avg: { costPerUnit: 120.5 },
      });
      mockPrisma.nonConformance.count
        .mockResolvedValueOnce(8)  // totalNcrs
        .mockResolvedValueOnce(4)  // openNcrs
        .mockResolvedValueOnce(1); // criticalNcrs
      mockPrisma.$queryRaw.mockResolvedValue([{ total: '50000' }]);

      const result = await service.getOlapSummary('company-1');

      expect(result).toMatchObject({
        sales: {
          totalRevenue: 50000,
          totalOrders: 10,
          avgTicket: 5000,
        },
        inventory: {
          totalSkus: 25,
          slowMovingCount: 3,
        },
        production: {
          totalOrders: 5,
          totalProduced: 100,
          avgCostPerUnit: 120.5,
        },
        quality: {
          totalNcrs: 8,
          openNcrs: 4,
          criticalNcrs: 1,
        },
      });
    });

    it('should return zero avgTicket when totalOrders is 0', async () => {
      mockPrisma.salesOrder.aggregate.mockResolvedValue({ _count: { id: 0 } });
      mockPrisma.saleItem.aggregate.mockResolvedValue({ _sum: { quantity: 0, unitPrice: 0 } });
      mockPrisma.stockBalance.count.mockResolvedValue(0);
      mockPrisma.stockBalance.aggregate.mockResolvedValue({ _sum: { available: 0 } });
      mockPrisma.productionOrder.aggregate.mockResolvedValue({ _count: { id: 0 }, _sum: { producedQty: 0 } });
      mockPrisma.productionCost.aggregate.mockResolvedValue({ _avg: { costPerUnit: null } });
      mockPrisma.nonConformance.count.mockResolvedValue(0);
      mockPrisma.$queryRaw.mockResolvedValue([{ total: '0' }]);

      const result = await service.getOlapSummary('company-empty');
      expect(result.sales.avgTicket).toBe(0);
      expect(result.sales.totalRevenue).toBe(0);
    });
  });

  // ─── salesCube ───────────────────────────────────────────────────────────

  describe('salesCube', () => {
    it('should return sales cube rows mapped correctly', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          period: '2026-01',
          product_sku: 'REB-001',
          product_name: 'Reboque Basculante',
          customer_name: 'Fazenda São João',
          status: 'INVOICED',
          total_qty: '5',
          total_revenue: '75000',
          order_count: 2,
        },
      ]);

      const result = await service.salesCube('company-1', {
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        period: '2026-01',
        productSku: 'REB-001',
        productName: 'Reboque Basculante',
        customerName: 'Fazenda São João',
        status: 'INVOICED',
        totalQty: 5,
        totalRevenue: 75000,
        orderCount: 2,
      });
    });

    it('should work without optional dates', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);
      const result = await service.salesCube('company-1', {});
      expect(result).toEqual([]);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  // ─── inventoryAging ───────────────────────────────────────────────────────

  describe('inventoryAging', () => {
    it('should classify aging buckets correctly', async () => {
      const now = new Date();
      const daysAgo = (d: number) => {
        const dt = new Date(now);
        dt.setDate(dt.getDate() - d);
        return dt;
      };

      mockPrisma.$queryRaw.mockResolvedValue([
        {
          sku: 'MAT-001',
          name: 'Chapa de Aço',
          available: '100',
          avg_cost: '50',
          last_movement_date: daysAgo(10),
        },
        {
          sku: 'MAT-002',
          name: 'Vergalhão',
          available: '200',
          avg_cost: '30',
          last_movement_date: daysAgo(60),
        },
        {
          sku: 'MAT-003',
          name: 'Parafuso',
          available: '500',
          avg_cost: '2',
          last_movement_date: daysAgo(150),
        },
        {
          sku: 'MAT-004',
          name: 'Tinta',
          available: '50',
          avg_cost: '80',
          last_movement_date: daysAgo(200),
        },
        {
          sku: 'MAT-005',
          name: 'Sem Movimento',
          available: '10',
          avg_cost: '10',
          last_movement_date: null,
        },
      ]);

      const result = await service.inventoryAging('company-1');

      expect(result).toHaveLength(5);
      expect(result[0].agingBucket).toBe('0-30');
      expect(result[1].agingBucket).toBe('31-90');
      expect(result[2].agingBucket).toBe('91-180');
      expect(result[3].agingBucket).toBe('180+');
      expect(result[4].agingBucket).toBe('180+'); // null → 9999 days
    });

    it('should compute inventoryValue as available * avgCost', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          sku: 'P-001',
          name: 'Produto X',
          available: '100',
          avg_cost: '25.5',
          last_movement_date: new Date(),
        },
      ]);

      const result = await service.inventoryAging('company-1');
      expect(result[0].inventoryValue).toBeCloseTo(2550, 1);
    });
  });

  // ─── productionCostAnalysis ───────────────────────────────────────────────

  describe('productionCostAnalysis', () => {
    it('should return production cost rows with avgCostPerUnit', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          sku: 'REB-001',
          product_name: 'Reboque Basculante',
          orders_count: 3,
          total_produced: '30',
          total_material_cost: '9000',
          total_labor_cost: '3000',
          total_cost: '12000',
        },
      ]);

      const result = await service.productionCostAnalysis('company-1', {
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        sku: 'REB-001',
        productName: 'Reboque Basculante',
        ordersCount: 3,
        totalProduced: 30,
        totalMaterialCost: 9000,
        totalLaborCost: 3000,
        totalCost: 12000,
        avgCostPerUnit: 400,
      });
    });

    it('should return avgCostPerUnit = 0 when totalProduced is 0', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          sku: 'REB-002',
          product_name: 'Produto Y',
          orders_count: 1,
          total_produced: '0',
          total_material_cost: '0',
          total_labor_cost: '0',
          total_cost: '0',
        },
      ]);

      const result = await service.productionCostAnalysis('company-1', {
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      });

      expect(result[0].avgCostPerUnit).toBe(0);
    });
  });

  // ─── purchaseAnalysis ─────────────────────────────────────────────────────

  describe('purchaseAnalysis', () => {
    it('should return purchase analysis rows', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          supplier_name: 'Aço Brasil',
          product_sku: 'MAT-001',
          product_name: 'Chapa de Aço',
          total_orders: 5,
          total_qty: '250',
          total_value: '12500',
          avg_unit_cost: '50',
        },
      ]);

      const result = await service.purchaseAnalysis('company-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        supplierName: 'Aço Brasil',
        productSku: 'MAT-001',
        productName: 'Chapa de Aço',
        totalOrders: 5,
        totalQty: 250,
        totalValue: 12500,
        avgUnitCost: 50,
      });
    });

    it('should accept optional date range', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);
      await service.purchaseAnalysis('company-1', '2026-01-01', '2026-06-30');
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  // ─── stockTurnover ────────────────────────────────────────────────────────

  describe('stockTurnover', () => {
    it('should compute turnoverRatio and daysOnHand', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          sku: 'MAT-001',
          name: 'Chapa de Aço',
          available: '100',
          total_consumed: '300', // consumed 300 in 3 months (90 days)
        },
        {
          sku: 'MAT-002',
          name: 'Tinta',
          available: '50',
          total_consumed: '0', // no consumption
        },
      ]);

      const result = await service.stockTurnover('company-1', 3);

      // sorted by turnoverRatio DESC
      expect(result[0].sku).toBe('MAT-001');
      expect(result[0].turnoverRatio).toBeCloseTo(3, 2); // 300/100 = 3
      // daysOnHand = available / (totalConsumed / periodDays) = 100 / (300/90) ≈ 30
      expect(result[0].daysOnHand).toBeCloseTo(30, 0);

      expect(result[1].sku).toBe('MAT-002');
      expect(result[1].turnoverRatio).toBe(0);
      expect(result[1].daysOnHand).toBe(0); // Infinity → 0
    });

    it('should default to 3 months', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);
      await service.stockTurnover('company-1');
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  // ─── supplierRanking ─────────────────────────────────────────────────────

  describe('supplierRanking', () => {
    it('should compute onTimeDeliveryPct correctly', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          supplier_name: 'Aço Brasil',
          total_orders: 10,
          total_value: '50000',
          total_gr_count: 8,
          on_time_count: 6,
          avg_lead_time_days: '5.5',
        },
      ]);

      const result = await service.supplierRanking('company-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        supplierName: 'Aço Brasil',
        totalOrders: 10,
        totalValue: 50000,
        avgLeadTimeDays: 5.5,
      });
      expect(result[0].onTimeDeliveryPct).toBeCloseTo(75, 1); // 6/8 * 100
    });

    it('should return 0% onTimeDeliveryPct when no goods receipts', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          supplier_name: 'Fornecedor Novo',
          total_orders: 2,
          total_value: '1000',
          total_gr_count: 0,
          on_time_count: 0,
          avg_lead_time_days: '0',
        },
      ]);

      const result = await service.supplierRanking('company-1');
      expect(result[0].onTimeDeliveryPct).toBe(0);
    });
  });

  // ─── ncRateBySupplier ─────────────────────────────────────────────────────

  describe('ncRateBySupplier', () => {
    it('should return NC rate rows grouped by supplier', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          supplier_name: 'Aço Brasil',
          total_ncrs: 5,
          minor_count: 2,
          major_count: 2,
          critical_count: 1,
        },
      ]);

      const result = await service.ncRateBySupplier('company-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        supplierName: 'Aço Brasil',
        totalNcrs: 5,
        minorCount: 2,
        majorCount: 2,
        criticalCount: 1,
      });
    });

    it('should return empty array when no NCRs', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);
      const result = await service.ncRateBySupplier('company-1');
      expect(result).toEqual([]);
    });
  });
});
