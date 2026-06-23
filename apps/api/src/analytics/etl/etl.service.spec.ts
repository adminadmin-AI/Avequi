import { Test, TestingModule } from '@nestjs/testing';
import { EtlService } from './etl.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  salesOrder: { findMany: jest.fn() },
  stockBalance: { findMany: jest.fn() },
  productionOrder: { findMany: jest.fn() },
  receivable: { findMany: jest.fn() },
  payable: { findMany: jest.fn() },
  factSalesDaily: { upsert: jest.fn() },
  factInventoryDaily: { upsert: jest.fn() },
  factProductionDaily: { upsert: jest.fn() },
  factFinancialDaily: { upsert: jest.fn() },
  company: { findMany: jest.fn() },
};

describe('EtlService', () => {
  let service: EtlService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EtlService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<EtlService>(EtlService);
    jest.clearAllMocks();
  });

  // ─── date handling ────────────────────────────────────────────────────────

  describe('runDailySnapshot', () => {
    it('defaults to yesterday when no date is provided', async () => {
      mockPrisma.salesOrder.findMany.mockResolvedValue([]);
      mockPrisma.stockBalance.findMany.mockResolvedValue([]);
      mockPrisma.productionOrder.findMany.mockResolvedValue([]);
      mockPrisma.receivable.findMany.mockResolvedValue([]);
      mockPrisma.payable.findMany.mockResolvedValue([]);

      await service.runDailySnapshot('company-1');

      // Snapshot methods are called with a date string that is yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const expectedDate = yesterday.toISOString().slice(0, 10);

      expect(mockPrisma.salesOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: 'company-1' }),
        }),
      );
      // Verify date range includes yesterday
      const callArg = mockPrisma.salesOrder.findMany.mock.calls[0][0];
      expect(callArg.where.confirmedAt.gte.toISOString().slice(0, 10)).toBe(expectedDate);
    });

    it('uses provided date', async () => {
      mockPrisma.salesOrder.findMany.mockResolvedValue([]);
      mockPrisma.stockBalance.findMany.mockResolvedValue([]);
      mockPrisma.productionOrder.findMany.mockResolvedValue([]);
      mockPrisma.receivable.findMany.mockResolvedValue([]);
      mockPrisma.payable.findMany.mockResolvedValue([]);

      await service.runDailySnapshot('company-1', '2025-01-15');

      const callArg = mockPrisma.salesOrder.findMany.mock.calls[0][0];
      expect(callArg.where.confirmedAt.gte.toISOString().slice(0, 10)).toBe('2025-01-15');
    });
  });

  // ─── snapshotSales ────────────────────────────────────────────────────────

  describe('snapshotSales', () => {
    it('groups items by productId + customerId and upserts', async () => {
      const order = {
        id: 'order-1',
        companyId: 'company-1',
        customerId: 'customer-1',
        status: 'CONFIRMED',
        confirmedAt: new Date('2025-01-15T12:00:00Z'),
        items: [
          { productId: 'prod-1', quantity: 2, unitPrice: 100 },
          { productId: 'prod-1', quantity: 3, unitPrice: 100 },
        ],
      };

      mockPrisma.salesOrder.findMany.mockResolvedValue([order]);
      mockPrisma.factSalesDaily.upsert.mockResolvedValue({});

      await service.snapshotSales('company-1', '2025-01-15');

      expect(mockPrisma.factSalesDaily.upsert).toHaveBeenCalledTimes(1);
      const upsertCall = mockPrisma.factSalesDaily.upsert.mock.calls[0][0];
      expect(upsertCall.create.revenue).toBe(500); // (2+3) * 100
      expect(upsertCall.create.quantity).toBe(5);
      expect(upsertCall.create.orderCount).toBe(1);
      expect(upsertCall.create.productId).toBe('prod-1');
      expect(upsertCall.create.customerId).toBe('customer-1');
    });

    it('aggregates multiple orders for the same product+customer', async () => {
      const orders = [
        {
          id: 'order-1',
          customerId: 'customer-1',
          items: [{ productId: 'prod-1', quantity: 2, unitPrice: 50 }],
        },
        {
          id: 'order-2',
          customerId: 'customer-1',
          items: [{ productId: 'prod-1', quantity: 3, unitPrice: 50 }],
        },
      ];

      mockPrisma.salesOrder.findMany.mockResolvedValue(orders);
      mockPrisma.factSalesDaily.upsert.mockResolvedValue({});

      await service.snapshotSales('company-1', '2025-01-15');

      expect(mockPrisma.factSalesDaily.upsert).toHaveBeenCalledTimes(1);
      const upsertCall = mockPrisma.factSalesDaily.upsert.mock.calls[0][0];
      expect(upsertCall.create.revenue).toBe(250); // 5 * 50
      expect(upsertCall.create.quantity).toBe(5);
      expect(upsertCall.create.orderCount).toBe(2);
      expect(upsertCall.create.avgTicket).toBeCloseTo(125); // 250 / 2
    });

    it('handles orders with no items', async () => {
      mockPrisma.salesOrder.findMany.mockResolvedValue([
        { id: 'order-1', customerId: null, items: [] },
      ]);

      await service.snapshotSales('company-1', '2025-01-15');

      expect(mockPrisma.factSalesDaily.upsert).not.toHaveBeenCalled();
    });
  });

  // ─── snapshotInventory ────────────────────────────────────────────────────

  describe('snapshotInventory', () => {
    it('snapshots each stock balance as a fact row', async () => {
      const balances = [
        {
          productId: 'prod-1',
          warehouseId: 'wh-1',
          available: 10,
          reserved: 2,
          inTransit: 1,
          avgCost: 50,
        },
      ];

      mockPrisma.stockBalance.findMany.mockResolvedValue(balances);
      mockPrisma.factInventoryDaily.upsert.mockResolvedValue({});

      await service.snapshotInventory('company-1', '2025-01-15');

      expect(mockPrisma.factInventoryDaily.upsert).toHaveBeenCalledTimes(1);
      const call = mockPrisma.factInventoryDaily.upsert.mock.calls[0][0];
      expect(call.create.quantity).toBe(13); // 10+2+1
      expect(call.create.value).toBe(650); // 13 * 50
      expect(call.create.avgCost).toBe(50);
    });

    it('handles null avgCost', async () => {
      mockPrisma.stockBalance.findMany.mockResolvedValue([
        { productId: 'prod-1', warehouseId: 'wh-1', available: 5, reserved: 0, inTransit: 0, avgCost: null },
      ]);
      mockPrisma.factInventoryDaily.upsert.mockResolvedValue({});

      await service.snapshotInventory('company-1', '2025-01-15');

      const call = mockPrisma.factInventoryDaily.upsert.mock.calls[0][0];
      expect(call.create.value).toBe(0);
      expect(call.create.avgCost).toBeNull();
    });
  });

  // ─── snapshotProduction ───────────────────────────────────────────────────

  describe('snapshotProduction', () => {
    it('aggregates completed production orders by product', async () => {
      const orders = [
        {
          id: 'po-1',
          productId: 'prod-1',
          quantity: 10,
          status: 'COMPLETED',
          completedAt: new Date('2025-01-15T12:00:00Z'),
          items: [
            { qtyConsumed: 5 },
            { qtyConsumed: 3 },
          ],
        },
        {
          id: 'po-2',
          productId: 'prod-1',
          quantity: 5,
          status: 'COMPLETED',
          completedAt: new Date('2025-01-15T14:00:00Z'),
          items: [{ qtyConsumed: 2 }],
        },
      ];

      mockPrisma.productionOrder.findMany.mockResolvedValue(orders);
      mockPrisma.factProductionDaily.upsert.mockResolvedValue({});

      await service.snapshotProduction('company-1', '2025-01-15');

      expect(mockPrisma.factProductionDaily.upsert).toHaveBeenCalledTimes(1);
      const call = mockPrisma.factProductionDaily.upsert.mock.calls[0][0];
      expect(call.create.quantity).toBe(15); // 10+5
      expect(call.create.materialCost).toBe(10); // (5+3)+2
      expect(call.create.orderCount).toBe(2);
    });
  });

  // ─── snapshotFinancial ────────────────────────────────────────────────────

  describe('snapshotFinancial', () => {
    it('creates REVENUE rows from paid receivables', async () => {
      mockPrisma.receivable.findMany.mockResolvedValue([
        { bankAccountId: 'ba-1', categoryId: 'cat-1', paidAmount: 1000, amount: 1000 },
        { bankAccountId: 'ba-1', categoryId: 'cat-1', paidAmount: 500, amount: 500 },
      ]);
      mockPrisma.payable.findMany.mockResolvedValue([]);
      mockPrisma.factFinancialDaily.upsert.mockResolvedValue({});

      await service.snapshotFinancial('company-1', '2025-01-15');

      expect(mockPrisma.factFinancialDaily.upsert).toHaveBeenCalledTimes(1);
      const call = mockPrisma.factFinancialDaily.upsert.mock.calls[0][0];
      expect(call.create.type).toBe('REVENUE');
      expect(call.create.amount).toBe(1500);
      expect(call.create.count).toBe(2);
    });

    it('creates EXPENSE rows from paid payables', async () => {
      mockPrisma.receivable.findMany.mockResolvedValue([]);
      mockPrisma.payable.findMany.mockResolvedValue([
        { bankAccountId: 'ba-1', categoryId: 'cat-2', paidAmount: 300, amount: 300 },
      ]);
      mockPrisma.factFinancialDaily.upsert.mockResolvedValue({});

      await service.snapshotFinancial('company-1', '2025-01-15');

      expect(mockPrisma.factFinancialDaily.upsert).toHaveBeenCalledTimes(1);
      const call = mockPrisma.factFinancialDaily.upsert.mock.calls[0][0];
      expect(call.create.type).toBe('EXPENSE');
      expect(call.create.amount).toBe(300);
    });

    it('upserts with correct unique key fields', async () => {
      mockPrisma.receivable.findMany.mockResolvedValue([
        { bankAccountId: 'ba-1', categoryId: 'cat-1', paidAmount: 200, amount: 200 },
      ]);
      mockPrisma.payable.findMany.mockResolvedValue([]);
      mockPrisma.factFinancialDaily.upsert.mockResolvedValue({});

      await service.snapshotFinancial('company-1', '2025-01-15');

      const call = mockPrisma.factFinancialDaily.upsert.mock.calls[0][0];
      expect(call.where.companyId_period_bankAccountId_categoryId_type).toMatchObject({
        companyId: 'company-1',
        period: '2025-01-15',
        bankAccountId: 'ba-1',
        categoryId: 'cat-1',
        type: 'REVENUE',
      });
    });
  });

  // ─── runAllCompanies ──────────────────────────────────────────────────────

  describe('runAllCompanies', () => {
    it('runs snapshot for each company', async () => {
      mockPrisma.company.findMany.mockResolvedValue([
        { id: 'company-1' },
        { id: 'company-2' },
      ]);
      mockPrisma.salesOrder.findMany.mockResolvedValue([]);
      mockPrisma.stockBalance.findMany.mockResolvedValue([]);
      mockPrisma.productionOrder.findMany.mockResolvedValue([]);
      mockPrisma.receivable.findMany.mockResolvedValue([]);
      mockPrisma.payable.findMany.mockResolvedValue([]);

      await service.runAllCompanies('2025-01-15');

      // Each company triggers 4 snapshot calls (sales, inventory, production, financial)
      expect(mockPrisma.salesOrder.findMany).toHaveBeenCalledTimes(2);
      expect(mockPrisma.stockBalance.findMany).toHaveBeenCalledTimes(2);
    });
  });
});
