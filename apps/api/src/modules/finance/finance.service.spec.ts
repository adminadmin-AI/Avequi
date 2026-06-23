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
    updateMany: jest.fn(),
  },
  payment: {
    create: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

const baseEntry = {
  id: 'fe-1',
  companyId: 'co-1',
  type: FinancialEntryType.RECEIVABLE,
  status: FinancialEntryStatus.OPEN,
  amount: 300,
  dueDate: new Date('2026-05-28'),
  salesOrderId: 'so-1',
  payments: [],
  paymentNote: null,
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

  // ─── S09.05: Pagamento parcial e total ───────────────────────────────────

  describe('pay', () => {
    const fullPayDto = {
      paidAt: '2026-04-28',
      paidAmount: 300,
      method: 'PIX' as any,
      paymentNote: 'Pix recebido',
    };

    it('deve registrar pagamento total em lançamento OPEN', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue(baseEntry);
      mockPrisma.$transaction.mockResolvedValue([
        { id: 'pay-1' },
        { ...baseEntry, status: FinancialEntryStatus.PAID },
        {},
      ]);

      const result = await service.pay('fe-1', 'co-1', fullPayDto);

      expect(result.status).toBe(FinancialEntryStatus.PAID);
      expect(result.totalPaid).toBe(300);
      expect(result.remaining).toBe(0);
    });

    it('deve registrar pagamento parcial e marcar PARTIALLY_PAID', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue(baseEntry);
      mockPrisma.$transaction.mockResolvedValue([
        { id: 'pay-1' },
        { ...baseEntry, status: FinancialEntryStatus.PARTIALLY_PAID },
        {},
      ]);

      const result = await service.pay('fe-1', 'co-1', {
        paidAt: '2026-04-28',
        paidAmount: 100,
        method: 'BOLETO' as any,
      });

      expect(result.status).toBe(FinancialEntryStatus.PARTIALLY_PAID);
      expect(result.totalPaid).toBe(100);
      expect(result.remaining).toBe(200);
    });

    it('deve fechar entry como PAID no último pagamento parcial', async () => {
      const entryWithPayments = {
        ...baseEntry,
        status: FinancialEntryStatus.PARTIALLY_PAID,
        payments: [{ id: 'pay-1', amount: 200 }],
      };
      mockPrisma.financialEntry.findFirst.mockResolvedValue(entryWithPayments);
      mockPrisma.$transaction.mockResolvedValue([
        { id: 'pay-2' },
        { ...baseEntry, status: FinancialEntryStatus.PAID },
        {},
      ]);

      const result = await service.pay('fe-1', 'co-1', {
        paidAt: '2026-05-10',
        paidAmount: 100,
        method: 'PIX' as any,
      });

      expect(result.status).toBe(FinancialEntryStatus.PAID);
      expect(result.totalPaid).toBe(300);
      expect(result.remaining).toBe(0);
    });

    it('deve aceitar pagamento em lançamento OVERDUE', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue({
        ...baseEntry,
        status: FinancialEntryStatus.OVERDUE,
      });
      mockPrisma.$transaction.mockResolvedValue([
        { id: 'pay-1' },
        {},
        {},
      ]);

      await expect(service.pay('fe-1', 'co-1', fullPayDto)).resolves.toBeDefined();
    });

    it('deve rejeitar pagamento acima do saldo devedor', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue({
        ...baseEntry,
        payments: [{ id: 'pay-1', amount: 250 }],
      });

      await expect(
        service.pay('fe-1', 'co-1', {
          paidAt: '2026-05-10',
          paidAmount: 100,
          method: 'PIX' as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar NotFoundException para lançamento inexistente', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue(null);
      await expect(service.pay('fe-x', 'co-1', fullPayDto)).rejects.toThrow(NotFoundException);
    });

    it('deve lançar BadRequestException para lançamento já PAID', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue({
        ...baseEntry,
        status: FinancialEntryStatus.PAID,
        payments: [],
      });
      await expect(service.pay('fe-1', 'co-1', fullPayDto)).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException para lançamento CANCELLED', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue({
        ...baseEntry,
        status: FinancialEntryStatus.CANCELLED,
        payments: [],
      });
      await expect(service.pay('fe-1', 'co-1', fullPayDto)).rejects.toThrow(BadRequestException);
    });
  });

  // ─── Parcelamento ────────────────────────────────────────────────────────

  describe('createInstallments', () => {
    const installDto = {
      numberOfInstallments: 3,
      intervalDays: 30,
      firstDueDate: '2026-06-01',
    };

    it('deve gerar N parcelas com valores corretos', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue({
        ...baseEntry,
        installments: [],
        description: 'Venda reboque',
        purchaseOrderId: null,
      });

      const createdInstallments = [
        { id: 'inst-1', amount: 100 },
        { id: 'inst-2', amount: 100 },
        { id: 'inst-3', amount: 100 },
      ];

      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        // Simulate transaction callback
        const tx = {
          financialEntry: {
            create: jest.fn().mockResolvedValueOnce(createdInstallments[0])
              .mockResolvedValueOnce(createdInstallments[1])
              .mockResolvedValueOnce(createdInstallments[2]),
            update: jest.fn().mockResolvedValue({}),
          },
          auditLog: { create: jest.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      });

      const result = await service.createInstallments('fe-1', 'co-1', installDto);

      expect(result).toHaveLength(3);
    });

    it('deve rejeitar se já foi parcelado', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue({
        ...baseEntry,
        installments: [{ id: 'inst-1' }],
      });

      await expect(
        service.createInstallments('fe-1', 'co-1', installDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve rejeitar se entry está PAID', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue({
        ...baseEntry,
        status: FinancialEntryStatus.PAID,
        installments: [],
      });

      await expect(
        service.createInstallments('fe-1', 'co-1', installDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve rejeitar se entry está CANCELLED', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue({
        ...baseEntry,
        status: FinancialEntryStatus.CANCELLED,
        installments: [],
      });

      await expect(
        service.createInstallments('fe-1', 'co-1', installDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar NotFoundException para entry inexistente', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue(null);

      await expect(
        service.createInstallments('fe-x', 'co-1', installDto),
      ).rejects.toThrow(NotFoundException);
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

    it('deve lançar BadRequestException para lançamento PARTIALLY_PAID', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue({
        ...baseEntry,
        status: FinancialEntryStatus.PARTIALLY_PAID,
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
