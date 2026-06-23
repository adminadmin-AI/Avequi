import { Test, TestingModule } from '@nestjs/testing';
import { SalesCubeService } from './sales-cube.service';
import { PrismaService } from '../../prisma/prisma.service';

const fakeSalesRows = [
  { companyId: 'c1', period: '2025-01-01', productId: 'p1', customerId: 'cust1', region: 'Sul', state: 'RS', city: 'POA', revenue: 1000, quantity: 10, orderCount: 2, avgTicket: 500 },
  { companyId: 'c1', period: '2025-01-02', productId: 'p2', customerId: 'cust2', region: 'Sul', state: 'RS', city: 'Caxias', revenue: 500, quantity: 5, orderCount: 1, avgTicket: 500 },
  { companyId: 'c1', period: '2025-01-03', productId: 'p1', customerId: 'cust3', region: 'Norte', state: 'AM', city: 'Manaus', revenue: 2000, quantity: 20, orderCount: 4, avgTicket: 500 },
];

const mockPrisma = {
  factSalesDaily: {
    findMany: jest.fn(),
  },
};

describe('SalesCubeService', () => {
  let service: SalesCubeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesCubeService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SalesCubeService>(SalesCubeService);
    jest.clearAllMocks();
  });

  // ─── query ────────────────────────────────────────────────────────────────

  describe('query', () => {
    it('returns totals and rows', async () => {
      mockPrisma.factSalesDaily.findMany.mockResolvedValue(fakeSalesRows);

      const result = await service.query('c1', {});

      expect(result.revenue).toBe(3500);
      expect(result.quantity).toBe(35);
      expect(result.orderCount).toBe(7);
      expect(result.avgTicket).toBeCloseTo(500);
      expect(result.rows).toHaveLength(3);
    });

    it('passes period filter to prisma', async () => {
      mockPrisma.factSalesDaily.findMany.mockResolvedValue([]);

      await service.query('c1', { periodFrom: '2025-01-01', periodTo: '2025-01-31' });

      expect(mockPrisma.factSalesDaily.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            period: { gte: '2025-01-01', lte: '2025-01-31' },
          }),
        }),
      );
    });

    it('filters by productId', async () => {
      mockPrisma.factSalesDaily.findMany.mockResolvedValue([fakeSalesRows[0]]);

      await service.query('c1', { productId: 'p1' });

      expect(mockPrisma.factSalesDaily.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ productId: 'p1' }),
        }),
      );
    });

    it('returns zero avgTicket when no orders', async () => {
      mockPrisma.factSalesDaily.findMany.mockResolvedValue([]);
      const result = await service.query('c1', {});
      expect(result.avgTicket).toBe(0);
    });
  });

  // ─── drillDown ────────────────────────────────────────────────────────────

  describe('drillDown', () => {
    it('product dimension returns grouped by customerId', async () => {
      mockPrisma.factSalesDaily.findMany.mockResolvedValue([fakeSalesRows[0], fakeSalesRows[2]]);

      const result = await service.drillDown('c1', 'product', 'p1', {});

      // Two distinct customers
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.key)).toEqual(expect.arrayContaining(['cust1', 'cust3']));
    });

    it('customer dimension returns grouped by productId', async () => {
      mockPrisma.factSalesDaily.findMany.mockResolvedValue([fakeSalesRows[0]]);

      const result = await service.drillDown('c1', 'customer', 'cust1', {});

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('p1');
    });

    it('region dimension returns grouped by state', async () => {
      mockPrisma.factSalesDaily.findMany.mockResolvedValue([fakeSalesRows[0], fakeSalesRows[1]]);

      const result = await service.drillDown('c1', 'region', 'Sul', {});

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('RS');
    });

    it('state dimension returns grouped by city', async () => {
      mockPrisma.factSalesDaily.findMany.mockResolvedValue([fakeSalesRows[0], fakeSalesRows[1]]);

      const result = await service.drillDown('c1', 'state', 'RS', {});

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.key)).toEqual(expect.arrayContaining(['POA', 'Caxias']));
    });
  });

  // ─── topN ─────────────────────────────────────────────────────────────────

  describe('topN', () => {
    it('returns top N products by revenue', async () => {
      mockPrisma.factSalesDaily.findMany.mockResolvedValue(fakeSalesRows);

      const result = await service.topN('c1', 'product', 2, {});

      expect(result).toHaveLength(2);
      // p1 has total revenue 1000+2000=3000, p2 has 500
      expect(result[0].key).toBe('p1');
      expect(result[0].revenue).toBe(3000);
      expect(result[1].key).toBe('p2');
    });

    it('top N by customer', async () => {
      mockPrisma.factSalesDaily.findMany.mockResolvedValue(fakeSalesRows);

      const result = await service.topN('c1', 'customer', 1, {});

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('cust3'); // highest revenue
    });

    it('top N by region', async () => {
      mockPrisma.factSalesDaily.findMany.mockResolvedValue(fakeSalesRows);

      const result = await service.topN('c1', 'region', 5, {});

      // Sul: 1500, Norte: 2000
      expect(result[0].key).toBe('Norte');
    });
  });
});
