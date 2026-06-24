import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RfqService } from './rfq.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  requestForQuotation: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  rfqQuote: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  purchaseOrder: { create: jest.fn() },
};

describe('RfqService', () => {
  let service: RfqService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RfqService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<RfqService>(RfqService);
    jest.clearAllMocks();
  });

  describe('submitQuote', () => {
    it('deve registrar cotação e atualizar status para QUOTED', async () => {
      mockPrisma.requestForQuotation.findFirst.mockResolvedValue({
        id: 'rfq-1', status: 'SENT',
      });
      mockPrisma.rfqQuote.create.mockResolvedValue({
        id: 'quote-1', rfqId: 'rfq-1', supplierId: 'sup-1', totalAmount: 5000,
      });
      mockPrisma.requestForQuotation.update.mockResolvedValue({});

      const result = await service.submitQuote('rfq-1', {
        supplierId: 'sup-1',
        deliveryDays: 15,
        items: [{ rfqItemId: 'ri-1', unitPrice: 50, quantity: 100 }],
      });

      expect(result.totalAmount).toBe(5000);
      expect(mockPrisma.requestForQuotation.update).toHaveBeenCalledWith({
        where: { id: 'rfq-1' },
        data: { status: 'QUOTED' },
      });
    });
  });

  describe('awardQuote', () => {
    it('adjudicar cotação → PO criada', async () => {
      mockPrisma.rfqQuote.findFirst.mockResolvedValue({
        id: 'quote-1',
        rfqId: 'rfq-1',
        supplierId: 'sup-1',
        rfq: { companyId: 'co-1', title: 'Chapas aço' },
        items: [
          { rfqItemId: 'ri-1', unitPrice: 50, quantity: 100, rfqItem: { productId: 'p-1' } },
        ],
      });
      const createdPO = { id: 'po-new', items: [], supplier: {} };
      mockPrisma.purchaseOrder.create.mockResolvedValue(createdPO);
      mockPrisma.rfqQuote.update.mockResolvedValue({});
      mockPrisma.requestForQuotation.update.mockResolvedValue({});

      const result = await service.awardQuote('quote-1', 'co-1', 'user-1');

      expect(result.purchaseOrderId).toBe('po-new');
      expect(mockPrisma.purchaseOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            supplierId: 'sup-1',
            companyId: 'co-1',
          }),
        }),
      );
      expect(mockPrisma.rfqQuote.update).toHaveBeenCalledWith({
        where: { id: 'quote-1' },
        data: { isAwarded: true, purchaseOrderId: 'po-new' },
      });
    });
  });
});
