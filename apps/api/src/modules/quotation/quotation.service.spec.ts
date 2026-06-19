import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { QuotationStatus, SalesOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { RejectQuotationDto } from './dto/reject-quotation.dto';
import { QuotationService } from './quotation.service';

const mockPrisma = {
  quotation: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    groupBy: jest.fn(),
  },
  quotationItem: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  salesOrder: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

const baseQuotation = {
  id: 'q-1',
  companyId: 'co-1',
  customerId: 'cust-1',
  warehouseId: 'wh-1',
  status: QuotationStatus.DRAFT,
  discount: 0,
  notes: null,
  validUntil: null,
  salesOrderId: null,
  sentAt: null,
  approvedAt: null,
  rejectedAt: null,
  rejectionReason: null,
  createdById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [
    {
      id: 'qi-1',
      quotationId: 'q-1',
      productId: 'p-1',
      quantity: 2,
      unitPrice: 100,
      discount: 10,
      unit: 'UN',
    },
  ],
};

describe('QuotationService', () => {
  let service: QuotationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuotationService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<QuotationService>(QuotationService);
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('deve criar orçamento com itens', async () => {
      const dto: CreateQuotationDto = {
        warehouseId: 'wh-1',
        items: [{ productId: 'p-1', quantity: 2, unitPrice: 100 }],
      };

      const expected = { ...baseQuotation, items: [{ ...baseQuotation.items[0], discount: 0 }] };
      mockPrisma.quotation.create.mockResolvedValue(expected);

      const result = await service.create('co-1', dto, 'user-1');

      expect(mockPrisma.quotation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: 'co-1',
            warehouseId: 'wh-1',
            status: QuotationStatus.DRAFT,
          }),
        }),
      );
      expect(result).toEqual(expected);
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('deve atualizar orçamento em DRAFT', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue(baseQuotation);
      const updated = { ...baseQuotation, notes: 'Novo texto' };
      mockPrisma.quotation.update.mockResolvedValue(updated);

      const dto: UpdateQuotationDto = { notes: 'Novo texto' };
      const result = await service.update('q-1', 'co-1', dto);

      expect(mockPrisma.quotation.update).toHaveBeenCalled();
      expect(result.notes).toBe('Novo texto');
    });

    it('deve lançar BadRequestException quando status não é DRAFT', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({
        ...baseQuotation,
        status: QuotationStatus.SENT,
      });

      await expect(
        service.update('q-1', 'co-1', { notes: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar NotFoundException quando orçamento não existe', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue(null);

      await expect(
        service.update('q-x', 'co-1', {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── send ─────────────────────────────────────────────────────────────────

  describe('send', () => {
    it('deve transitar DRAFT → SENT', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue(baseQuotation);
      const sent = { ...baseQuotation, status: QuotationStatus.SENT, sentAt: new Date() };
      mockPrisma.quotation.update.mockResolvedValue(sent);

      const result = await service.send('q-1', 'co-1');

      expect(mockPrisma.quotation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: QuotationStatus.SENT }),
        }),
      );
      expect(result.status).toBe(QuotationStatus.SENT);
    });

    it('deve lançar BadRequestException quando não está em DRAFT', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({
        ...baseQuotation,
        status: QuotationStatus.SENT,
      });

      await expect(service.send('q-1', 'co-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── approve ──────────────────────────────────────────────────────────────

  describe('approve', () => {
    it('deve transitar SENT → APPROVED', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({
        ...baseQuotation,
        status: QuotationStatus.SENT,
      });
      const approved = {
        ...baseQuotation,
        status: QuotationStatus.APPROVED,
        approvedAt: new Date(),
      };
      mockPrisma.quotation.update.mockResolvedValue(approved);

      const result = await service.approve('q-1', 'co-1');

      expect(result.status).toBe(QuotationStatus.APPROVED);
    });

    it('deve lançar BadRequestException quando não está em SENT', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue(baseQuotation); // DRAFT

      await expect(service.approve('q-1', 'co-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── reject ───────────────────────────────────────────────────────────────

  describe('reject', () => {
    it('deve transitar SENT → REJECTED com razão', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({
        ...baseQuotation,
        status: QuotationStatus.SENT,
      });
      const rejected = {
        ...baseQuotation,
        status: QuotationStatus.REJECTED,
        rejectedAt: new Date(),
        rejectionReason: 'Preço fora do mercado',
      };
      mockPrisma.quotation.update.mockResolvedValue(rejected);

      const dto: RejectQuotationDto = { rejectionReason: 'Preço fora do mercado' };
      const result = await service.reject('q-1', 'co-1', dto);

      expect(mockPrisma.quotation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: QuotationStatus.REJECTED,
            rejectionReason: 'Preço fora do mercado',
          }),
        }),
      );
      expect(result.status).toBe(QuotationStatus.REJECTED);
    });

    it('deve lançar BadRequestException quando não está em SENT/APPROVED', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue(baseQuotation); // DRAFT

      await expect(
        service.reject('q-1', 'co-1', {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── convert ──────────────────────────────────────────────────────────────

  describe('convert', () => {
    it('deve converter APPROVED → CONVERTED e criar OV com descontos aplicados', async () => {
      const approvedQuotation = {
        ...baseQuotation,
        status: QuotationStatus.APPROVED,
        discount: 10, // 10% global
        items: [
          {
            id: 'qi-1',
            quotationId: 'q-1',
            productId: 'p-1',
            quantity: 2,
            unitPrice: 100,
            discount: 10, // 10% per item
            unit: 'UN',
          },
        ],
      };
      mockPrisma.quotation.findFirst.mockResolvedValue(approvedQuotation);

      const newSalesOrder = {
        id: 'so-1',
        companyId: 'co-1',
        status: SalesOrderStatus.DRAFT,
        items: [{ productId: 'p-1', quantity: 2, unitPrice: 81 }], // 100 * 0.9 * 0.9 = 81
      };
      mockPrisma.salesOrder.create.mockResolvedValue(newSalesOrder);

      const convertedQuotation = {
        ...approvedQuotation,
        status: QuotationStatus.CONVERTED,
        salesOrderId: 'so-1',
      };
      mockPrisma.quotation.update.mockResolvedValue(convertedQuotation);

      const result = await service.convert('q-1', 'co-1', 'user-1');

      expect(result).toHaveProperty('quotation');
      expect(result).toHaveProperty('salesOrder');
      expect(result.quotation.status).toBe(QuotationStatus.CONVERTED);

      // Verify discount calculation: 100 * (1 - 10/100) * (1 - 10/100) = 81
      const createCall = mockPrisma.salesOrder.create.mock.calls[0][0];
      const createdItem = createCall.data.items.create[0];
      expect(Number(createdItem.unitPrice)).toBeCloseTo(81, 5);
    });

    it('deve lançar BadRequestException quando não está APPROVED', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue(baseQuotation); // DRAFT

      await expect(service.convert('q-1', 'co-1')).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException quando já foi convertido', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({
        ...baseQuotation,
        status: QuotationStatus.APPROVED,
        salesOrderId: 'so-existing',
      });

      await expect(service.convert('q-1', 'co-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── expire ───────────────────────────────────────────────────────────────

  describe('expire', () => {
    it('deve transitar SENT → EXPIRED', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({
        ...baseQuotation,
        status: QuotationStatus.SENT,
      });
      const expired = { ...baseQuotation, status: QuotationStatus.EXPIRED };
      mockPrisma.quotation.update.mockResolvedValue(expired);

      const result = await service.expire('q-1', 'co-1');

      expect(result.status).toBe(QuotationStatus.EXPIRED);
    });

    it('deve lançar BadRequestException quando não está em SENT/APPROVED', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue(baseQuotation); // DRAFT

      await expect(service.expire('q-1', 'co-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── delete ───────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deve excluir orçamento em DRAFT', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue(baseQuotation);
      mockPrisma.quotation.delete.mockResolvedValue(baseQuotation);

      const result = await service.delete('q-1', 'co-1');

      expect(mockPrisma.quotation.delete).toHaveBeenCalledWith({ where: { id: 'q-1' } });
      expect(result).toEqual({ deleted: true });
    });

    it('deve lançar BadRequestException quando não está em DRAFT', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({
        ...baseQuotation,
        status: QuotationStatus.SENT,
      });

      await expect(service.delete('q-1', 'co-1')).rejects.toThrow(BadRequestException);
    });

    it('deve lançar NotFoundException quando orçamento não existe', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue(null);

      await expect(service.delete('q-x', 'co-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getStats ─────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('deve retornar estrutura correta com taxa de conversão', async () => {
      mockPrisma.quotation.groupBy.mockResolvedValue([
        { status: QuotationStatus.DRAFT, _count: { id: 5 } },
        { status: QuotationStatus.SENT, _count: { id: 3 } },
        { status: QuotationStatus.APPROVED, _count: { id: 2 } },
        { status: QuotationStatus.REJECTED, _count: { id: 1 } },
        { status: QuotationStatus.EXPIRED, _count: { id: 1 } },
        { status: QuotationStatus.CONVERTED, _count: { id: 2 } },
      ]);

      const result = await service.getStats('co-1');

      expect(result).toMatchObject({
        total: 14,
        draft: 5,
        sent: 3,
        approved: 2,
        rejected: 1,
        expired: 1,
        converted: 2,
      });
      // conversionRate = 2 / (2+1+1+2) * 100 = 33.33
      expect(result.conversionRate).toBeCloseTo(33.33, 1);
    });

    it('deve retornar conversionRate 0 quando não há orçamentos finalizados', async () => {
      mockPrisma.quotation.groupBy.mockResolvedValue([
        { status: QuotationStatus.DRAFT, _count: { id: 3 } },
      ]);

      const result = await service.getStats('co-1');

      expect(result.conversionRate).toBe(0);
      expect(result.total).toBe(3);
    });
  });
});
