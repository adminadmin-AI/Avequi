import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PriceService } from './price.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  priceTable: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  product: {
    findFirst: jest.fn(),
  },
};

describe('PriceService', () => {
  let service: PriceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PriceService>(PriceService);
    jest.clearAllMocks();
  });

  describe('lookup', () => {
    it('cliente com tabela específica → usa preço do cliente', async () => {
      mockPrisma.priceTable.findFirst.mockResolvedValueOnce({
        id: 'pt-cust',
        name: 'Tabela Cliente VIP',
        items: [{ unitPrice: 80, minQuantity: null, discountPercent: null }],
      });

      const result = await service.lookup('co-1', 'p-1', 'cust-1');
      expect(result.source).toBe('CUSTOMER_SPECIFIC');
      expect(result.unitPrice).toBe(80);
    });

    it('tabela vencida → cai para padrão', async () => {
      // Customer table not found (expired)
      mockPrisma.priceTable.findFirst
        .mockResolvedValueOnce(null) // customer
        .mockResolvedValueOnce(null) // promotional
        .mockResolvedValueOnce({
          id: 'pt-default',
          name: 'Tabela Padrão',
          items: [{ unitPrice: 100, minQuantity: null, discountPercent: null }],
        });

      const result = await service.lookup('co-1', 'p-1', 'cust-1');
      expect(result.source).toBe('DEFAULT');
      expect(result.unitPrice).toBe(100);
    });

    it('desconto por volume aplicado corretamente', async () => {
      mockPrisma.priceTable.findFirst.mockResolvedValueOnce({
        id: 'pt-cust',
        name: 'Tabela Volume',
        items: [
          { unitPrice: 100, minQuantity: 50, discountPercent: 10 },
          { unitPrice: 100, minQuantity: 10, discountPercent: 5 },
          { unitPrice: 100, minQuantity: null, discountPercent: null },
        ],
      });

      const result = await service.lookup('co-1', 'p-1', 'cust-1', 60);
      expect(result.source).toBe('CUSTOMER_SPECIFIC');
      expect(result.discountPercent).toBe(10);
      expect(result.effectivePrice).toBe(90); // 100 * (1 - 10/100)
    });

    it('sem tabela → fallback para salePrice do produto', async () => {
      mockPrisma.priceTable.findFirst
        .mockResolvedValueOnce(null) // customer
        .mockResolvedValueOnce(null) // promotional
        .mockResolvedValueOnce(null); // default
      mockPrisma.product.findFirst.mockResolvedValue({ salePrice: 150 });

      const result = await service.lookup('co-1', 'p-1');
      expect(result.source).toBe('PRODUCT_DEFAULT');
      expect(result.unitPrice).toBe(150);
    });
  });
});
