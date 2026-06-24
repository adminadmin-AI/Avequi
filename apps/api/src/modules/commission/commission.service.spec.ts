import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CommissionService } from './commission.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  salesOrder: { findFirst: jest.fn() },
  commissionRule: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn() },
  commission: { create: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  payable: { create: jest.fn() },
};

describe('CommissionService', () => {
  let service: CommissionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommissionService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<CommissionService>(CommissionService);
    jest.clearAllMocks();
  });

  describe('onSaleInvoiced', () => {
    it('venda faturada → comissão calculada', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        createdById: 'seller-1',
        companyId: 'co-1',
      });
      mockPrisma.commissionRule.findFirst.mockResolvedValue({
        percentRate: 5,
        fixedAmount: null,
      });
      mockPrisma.commission.create.mockResolvedValue({ id: 'comm-1' });

      await service.onSaleInvoiced({
        companyId: 'co-1',
        userId: 'user-1',
        salesOrderId: 'so-1',
        warehouseId: 'wh-1',
        items: [
          { saleItemId: 'si-1', productId: 'p-1', quantity: 10, unitPrice: 100 },
        ],
      });

      expect(mockPrisma.commission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'seller-1',
          salesOrderId: 'so-1',
          amount: 50, // 1000 * 5%
        }),
      });
    });
  });

  describe('approveBatch', () => {
    it('aprovação em batch → payables gerados', async () => {
      mockPrisma.commission.findMany.mockResolvedValue([
        { id: 'comm-1', salesOrderId: 'so-1', amount: 50, status: 'PENDING' },
        { id: 'comm-2', salesOrderId: 'so-2', amount: 30, status: 'PENDING' },
      ]);
      mockPrisma.payable.create.mockResolvedValueOnce({ id: 'pay-1' })
        .mockResolvedValueOnce({ id: 'pay-2' });
      mockPrisma.commission.update.mockResolvedValue({});

      const result = await service.approveBatch('co-1', ['comm-1', 'comm-2'], 'user-1');

      expect(result.approved).toBe(2);
      expect(result.payables).toHaveLength(2);
      expect(mockPrisma.payable.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.commission.update).toHaveBeenCalledTimes(2);
    });
  });
});
