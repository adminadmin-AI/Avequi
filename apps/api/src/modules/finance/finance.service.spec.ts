import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FinancialEntryStatus, FinancialEntryType } from '@prisma/client';
import { FinanceService } from './finance.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  financialEntry: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

const baseEntry = {
  id: 'fe-1',
  companyId: 'co-1',
  type: FinancialEntryType.RECEIVABLE,
  status: FinancialEntryStatus.OPEN,
  amount: 300,
  dueDate: new Date('2026-05-28'),
  salesOrderId: 'so-1',
};

describe('FinanceService', () => {
  let service: FinanceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<FinanceService>(FinanceService);
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  // ─── S09.02: Gerar CR de venda ───────────────────────────────────────────

  describe('createReceivableForSale', () => {
    it('deve criar RECEIVABLE para venda sem CR anterior', async () => {
      mockPrisma.financialEntry.findUnique.mockResolvedValue(null);
      mockPrisma.financialEntry.create.mockResolvedValue(baseEntry);

      await service.createReceivableForSale({
        companyId: 'co-1',
        salesOrderId: 'so-1',
        amount: 300,
      });

      expect(mockPrisma.financialEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: FinancialEntryType.RECEIVABLE,
            status: FinancialEntryStatus.OPEN,
            amount: 300,
            salesOrderId: 'so-1',
          }),
        }),
      );
    });

    it('deve ignorar criação quando CR já existe (idempotência)', async () => {
      mockPrisma.financialEntry.findUnique.mockResolvedValue(baseEntry);

      await service.createReceivableForSale({
        companyId: 'co-1',
        salesOrderId: 'so-1',
        amount: 300,
      });

      expect(mockPrisma.financialEntry.create).not.toHaveBeenCalled();
    });
  });

  // ─── S09.03: Gerar CP de recebimento ─────────────────────────────────────

  describe('createPayableForReceipt', () => {
    it('deve criar PAYABLE para recebimento sem CP anterior', async () => {
      mockPrisma.financialEntry.findUnique.mockResolvedValue(null);
      mockPrisma.financialEntry.create.mockResolvedValue({
        ...baseEntry,
        type: FinancialEntryType.PAYABLE,
        salesOrderId: null,
        goodsReceiptId: 'gr-1',
      });

      await service.createPayableForReceipt({
        companyId: 'co-1',
        purchaseOrderId: 'po-1',
        goodsReceiptId: 'gr-1',
        amount: 450,
      });

      expect(mockPrisma.financialEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: FinancialEntryType.PAYABLE,
            status: FinancialEntryStatus.OPEN,
            amount: 450,
            purchaseOrderId: 'po-1',
            goodsReceiptId: 'gr-1',
          }),
        }),
      );
    });

    it('deve ignorar criação quando CP já existe (idempotência)', async () => {
      mockPrisma.financialEntry.findUnique.mockResolvedValue({
        ...baseEntry,
        type: FinancialEntryType.PAYABLE,
        goodsReceiptId: 'gr-1',
      });

      await service.createPayableForReceipt({
        companyId: 'co-1',
        purchaseOrderId: 'po-1',
        goodsReceiptId: 'gr-1',
        amount: 450,
      });

      expect(mockPrisma.financialEntry.create).not.toHaveBeenCalled();
    });
  });

  // ─── S09.05: Baixa de pagamento ──────────────────────────────────────────

  describe('pay', () => {
    const dto = { paidAt: '2026-04-28', paidAmount: 300, paymentNote: 'PIX' };

    it('deve registrar pagamento em lançamento OPEN', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue(baseEntry);
      mockPrisma.financialEntry.update.mockResolvedValue({
        ...baseEntry,
        status: FinancialEntryStatus.PAID,
      });

      await service.pay('fe-1', 'co-1', dto);

      expect(mockPrisma.financialEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FinancialEntryStatus.PAID,
            paidAmount: 300,
            paymentNote: 'PIX',
          }),
        }),
      );
    });

    it('deve lançar NotFoundException para lançamento inexistente', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue(null);
      await expect(service.pay('fe-x', 'co-1', dto)).rejects.toThrow(NotFoundException);
    });

    it('deve lançar BadRequestException para lançamento já PAID', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue({
        ...baseEntry,
        status: FinancialEntryStatus.PAID,
      });
      await expect(service.pay('fe-1', 'co-1', dto)).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException para lançamento CANCELLED', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue({
        ...baseEntry,
        status: FinancialEntryStatus.CANCELLED,
      });
      await expect(service.pay('fe-1', 'co-1', dto)).rejects.toThrow(BadRequestException);
    });
  });

  // ─── Cancelamento ────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('deve cancelar lançamento OPEN', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue(baseEntry);
      mockPrisma.financialEntry.update.mockResolvedValue({
        ...baseEntry,
        status: FinancialEntryStatus.CANCELLED,
      });

      await service.cancel('fe-1', 'co-1');

      expect(mockPrisma.financialEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: FinancialEntryStatus.CANCELLED }),
        }),
      );
    });

    it('deve lançar NotFoundException para lançamento inexistente', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue(null);
      await expect(service.cancel('fe-x', 'co-1')).rejects.toThrow(NotFoundException);
    });

    it('deve lançar BadRequestException para lançamento já PAID', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue({
        ...baseEntry,
        status: FinancialEntryStatus.PAID,
      });
      await expect(service.cancel('fe-1', 'co-1')).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException para lançamento já CANCELLED', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue({
        ...baseEntry,
        status: FinancialEntryStatus.CANCELLED,
      });
      await expect(service.cancel('fe-1', 'co-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── Listagem ─────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('deve retornar todos os lançamentos da empresa', async () => {
      mockPrisma.financialEntry.findMany.mockResolvedValue([baseEntry]);

      const result = await service.findAll('co-1');

      expect(mockPrisma.financialEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: 'co-1' }),
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('deve aplicar filtro por type e status', async () => {
      mockPrisma.financialEntry.findMany.mockResolvedValue([]);

      await service.findAll('co-1', {
        type: FinancialEntryType.RECEIVABLE,
        status: FinancialEntryStatus.OPEN,
      });

      expect(mockPrisma.financialEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: FinancialEntryType.RECEIVABLE,
            status: FinancialEntryStatus.OPEN,
          }),
        }),
      );
    });
  });
});
