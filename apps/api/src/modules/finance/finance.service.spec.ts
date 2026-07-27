import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FinancialEntryStatus, FinancialEntryType } from '@prisma/client';
import { FinanceService } from './finance.service';
import { SupplierAdvanceService } from './supplier-advance.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  debtInstallment: { findMany: jest.fn().mockResolvedValue([]) },
  salesOrder: { findFirst: jest.fn() }, // #586 — plano de pagamento da venda
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
  entryCostCenterSplit: {
    deleteMany: jest.fn(),
    create: jest.fn(),
  },
  financialCategory: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  costCenter: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  bankAccount: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
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
        { provide: SupplierAdvanceService, useValue: { applyToPayable: jest.fn().mockResolvedValue(0) } },
      ],
    }).compile();

    service = module.get<FinanceService>(FinanceService);
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  // ─── S09.02: Gerar CR de venda ───────────────────────────────────────────

  describe('createReceivableForSale', () => {
    it('deve criar RECEIVABLE para venda sem CR anterior', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue(null);
      mockPrisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', payments: [] }); // sem plano → legado (#586)
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
      mockPrisma.financialEntry.findFirst.mockResolvedValue(baseEntry);

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

  // ─── Edição de título em aberto ───────────────────────────────────────────

  describe('updateEntry', () => {
    /** Faz o mock de $transaction executar o callback com um tx instrumentado. */
    function stubTransaction() {
      const tx = {
        financialEntry: { update: jest.fn().mockResolvedValue({}) },
        entryCostCenterSplit: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest.fn().mockResolvedValue({}),
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      };
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
      return tx;
    }

    it('deve editar título OPEN sem tocar no rateio quando costCenterId não vem', async () => {
      mockPrisma.financialEntry.findFirst
        .mockResolvedValueOnce({ ...baseEntry, status: FinancialEntryStatus.OPEN })
        .mockResolvedValueOnce({ ...baseEntry, description: 'Novo texto' }); // findOne final
      const tx = stubTransaction();

      await service.updateEntry('fe-1', 'co-1', { description: 'Novo texto', amount: 500 });

      expect(tx.financialEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'fe-1' },
          data: expect.objectContaining({ description: 'Novo texto', amount: 500 }),
        }),
      );
      // rateio preservado: sem costCenterId no payload, não mexe nos splits
      expect(tx.entryCostCenterSplit.deleteMany).not.toHaveBeenCalled();
      expect(tx.entryCostCenterSplit.create).not.toHaveBeenCalled();
      expect(tx.auditLog.create).toHaveBeenCalled();
    });

    it('deve substituir o rateio por 100% quando costCenterId é informado', async () => {
      mockPrisma.financialEntry.findFirst
        .mockResolvedValueOnce({ ...baseEntry, status: FinancialEntryStatus.OVERDUE })
        .mockResolvedValueOnce(baseEntry);
      const tx = stubTransaction();

      await service.updateEntry('fe-1', 'co-1', { costCenterId: 'cc-9', amount: 400 });

      expect(tx.entryCostCenterSplit.deleteMany).toHaveBeenCalledWith({ where: { entryId: 'fe-1' } });
      expect(tx.entryCostCenterSplit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ costCenterId: 'cc-9', percentage: 100, amount: 400 }),
        }),
      );
    });

    it('deve rejeitar edição de título PAID', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue({
        ...baseEntry,
        status: FinancialEntryStatus.PAID,
      });
      await expect(
        service.updateEntry('fe-1', 'co-1', { description: 'x' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('deve rejeitar edição de título CANCELLED', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue({
        ...baseEntry,
        status: FinancialEntryStatus.CANCELLED,
      });
      await expect(
        service.updateEntry('fe-1', 'co-1', { amount: 1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve rejeitar edição de título PARTIALLY_PAID', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue({
        ...baseEntry,
        status: FinancialEntryStatus.PARTIALLY_PAID,
      });
      await expect(
        service.updateEntry('fe-1', 'co-1', { amount: 1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar NotFoundException para título inexistente', async () => {
      mockPrisma.financialEntry.findFirst.mockResolvedValue(null);
      await expect(
        service.updateEntry('nope', 'co-1', { amount: 1 }),
      ).rejects.toThrow(NotFoundException);
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

  // ─── Categorias gerenciais ───────────────────────────────────────────────

  describe('createCategory', () => {
    it('deve criar categoria raiz', async () => {
      mockPrisma.financialCategory.create.mockResolvedValue({ id: 'cat-1', name: 'Receitas', code: 'REC' });

      const result = await service.createCategory('co-1', {
        name: 'Receitas',
        code: 'REC',
        type: 'REVENUE',
      });

      expect(result.name).toBe('Receitas');
      expect(mockPrisma.financialCategory.create).toHaveBeenCalled();
    });

    it('deve criar subcategoria com parentId', async () => {
      mockPrisma.financialCategory.findFirst.mockResolvedValue({ id: 'cat-1' });
      mockPrisma.financialCategory.create.mockResolvedValue({ id: 'cat-2', name: 'Receita Operacional', parentId: 'cat-1' });

      const result = await service.createCategory('co-1', {
        name: 'Receita Operacional',
        code: 'REC-OP',
        type: 'REVENUE',
        parentId: 'cat-1',
      });

      expect(result.parentId).toBe('cat-1');
    });

    it('deve rejeitar subcategoria com parentId inexistente', async () => {
      mockPrisma.financialCategory.findFirst.mockResolvedValue(null);

      await expect(
        service.createCategory('co-1', { name: 'Sub', type: 'EXPENSE', parentId: 'bad-id' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAllCategories', () => {
    it('deve retornar apenas categorias raiz com children', async () => {
      mockPrisma.financialCategory.findMany.mockResolvedValue([
        { id: 'cat-1', name: 'Receitas', parentId: null, children: [{ id: 'cat-2', name: 'Receita Op' }] },
        { id: 'cat-2', name: 'Receita Op', parentId: 'cat-1', children: [] },
      ]);

      const result = await service.findAllCategories('co-1');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Receitas');
    });
  });

  // ─── Centros de custo ────────────────────────────────────────────────────

  describe('createCostCenter', () => {
    it('deve criar centro de custo raiz', async () => {
      mockPrisma.costCenter.create.mockResolvedValue({ id: 'cc-1', name: 'Fábrica', code: 'FAB' });

      const result = await service.createCostCenter('co-1', { name: 'Fábrica', code: 'FAB' });

      expect(result.name).toBe('Fábrica');
    });

    it('deve criar sub-centro com parentId', async () => {
      mockPrisma.costCenter.findFirst.mockResolvedValue({ id: 'cc-1' });
      mockPrisma.costCenter.create.mockResolvedValue({ id: 'cc-2', name: 'Corte', parentId: 'cc-1' });

      const result = await service.createCostCenter('co-1', { name: 'Corte', code: 'FAB-COR', parentId: 'cc-1' });

      expect(result.parentId).toBe('cc-1');
    });

    it('deve rejeitar sub-centro com parentId inexistente', async () => {
      mockPrisma.costCenter.findFirst.mockResolvedValue(null);

      await expect(
        service.createCostCenter('co-1', { name: 'Sub', parentId: 'bad-id' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAllCostCenters', () => {
    it('deve retornar apenas centros raiz com children', async () => {
      mockPrisma.costCenter.findMany.mockResolvedValue([
        { id: 'cc-1', name: 'Fábrica', parentId: null, children: [{ id: 'cc-2', name: 'Corte' }] },
        { id: 'cc-2', name: 'Corte', parentId: 'cc-1', children: [] },
      ]);

      const result = await service.findAllCostCenters('co-1');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Fábrica');
    });
  });

  // ─── Extrato bancário e saldo consolidado ────────────────────────────────

  describe('getBankStatement', () => {
    it('deve retornar extrato com pagamentos da conta', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue({
        id: 'ba-1', name: 'Banco do Brasil', bank: 'BB', balance: 10000,
      });
      (mockPrisma as any).payment = { findMany: jest.fn() };
      (mockPrisma as any).payment.findMany.mockResolvedValue([
        {
          id: 'pay-1',
          amount: 500,
          paidAt: new Date('2026-06-10'),
          method: 'PIX',
          reference: 'txid-123',
          financialEntry: { id: 'fe-1', type: 'RECEIVABLE', description: 'Venda', amount: 500 },
        },
      ]);

      const result = await service.getBankStatement('ba-1', 'co-1', {});

      expect(result.bankAccount.currentBalance).toBe(10000);
      expect(result.payments).toHaveLength(1);
      expect(result.payments[0].direction).toBe('IN');
    });

    it('deve lançar NotFoundException para conta inexistente', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(null);

      await expect(
        service.getBankStatement('bad-id', 'co-1', {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getConsolidatedBalance', () => {
    it('deve retornar saldo total de todas as contas ativas', async () => {
      mockPrisma.bankAccount.findMany.mockResolvedValue([
        { id: 'ba-1', name: 'BB', bank: 'BB', balance: 5000 },
        { id: 'ba-2', name: 'Itaú', bank: 'Itaú', balance: 3000 },
      ]);

      const result = await service.getConsolidatedBalance('co-1');

      expect(result.totalBalance).toBe(8000);
      expect(result.accounts).toHaveLength(2);
    });
  });
});

describe('FinanceService — fluxo de caixa 13 semanas / 12 meses (#383)', () => {
  let service: FinanceService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        FinanceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SupplierAdvanceService, useValue: { applyToPayable: jest.fn().mockResolvedValue(0) } },
      ],
    }).compile();
    service = module.get(FinanceService);
  });

  function dailyStub(days: number) {
    // 2026-07-06 é uma segunda-feira — semanas civis alinhadas
    const projection = [] as any[];
    let balance = 1000;
    for (let i = 0; i < days; i++) {
      const date = new Date(Date.UTC(2026, 6, 6) + 0);
      date.setUTCDate(date.getUTCDate() + i);
      balance += 10 - 5;
      projection.push({
        date: date.toISOString().slice(0, 10),
        receivable: 10,
        payable: 5,
        netFlow: 5,
        projectedBalance: balance,
        alert: false,
      });
    }
    return { currentBalance: 1000, days, alertDaysCount: 0, firstAlertDate: null, projection };
  }

  it('agrega semanas civis (seg-dom): 13 semanas com inflow/outflow somados', async () => {
    jest.spyOn(service, 'getCashFlowProjection').mockResolvedValue(dailyStub(13 * 7 + 7) as any);
    const result = await service.getCashFlowWeekly('co-1');
    expect(result.weeks).toBe(13);
    const w1 = result.projection[0];
    expect(w1.weekStart).toBe('2026-07-06'); // segunda
    expect(w1.weekEnd).toBe('2026-07-12'); // domingo
    expect(w1.inflow).toBe(70); // 7 dias × 10
    expect(w1.outflow).toBe(35);
    expect(w1.netFlow).toBe(35);
    // saldo da semana = saldo do último dia dela
    expect(w1.projectedBalance).toBe(1000 + 7 * 5);
  });

  it('agrega por mês: 12 meses com saldo do último dia do mês', async () => {
    jest.spyOn(service, 'getCashFlowProjection').mockResolvedValue(dailyStub(370) as any);
    const result = await service.getCashFlowMonthly('co-1');
    expect(result.months).toBe(12);
    expect(result.projection[0].month).toBe('2026-07');
    // julho: dias 06-31 = 26 dias × 10
    expect(result.projection[0].inflow).toBe(260);
    expect(result.projection[1].month).toBe('2026-08');
    expect(result.projection[1].inflow).toBe(310); // 31 dias
  });

  it('marca alerta quando o saldo projetado da semana fica negativo', async () => {
    const stub = dailyStub(21);
    stub.projection.forEach((d: any, i: number) => {
      if (i >= 7) d.projectedBalance = -100;
    });
    jest.spyOn(service, 'getCashFlowProjection').mockResolvedValue(stub as any);
    const result = await service.getCashFlowWeekly('co-1', { weeks: 3 });
    expect(result.projection[1].alert).toBe(true);
    expect(result.firstAlertWeek).toBe(result.projection[1].weekStart);
  });
});

describe('FinanceService — cenários de caixa (#390)', () => {
  let service: FinanceService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        FinanceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SupplierAdvanceService, useValue: { applyToPayable: jest.fn().mockResolvedValue(0) } },
      ],
    }).compile();
    service = module.get(FinanceService);
    jest.clearAllMocks();
    // inadimplência: 20k vencido aberto, 80k recebido → 20%
    (mockPrisma.financialEntry as any).aggregate = jest.fn()
      .mockResolvedValueOnce({ _sum: { amount: 20000, paidAmount: 0 } })
      .mockResolvedValueOnce({ _sum: { amount: 80000 } });
  });

  it('estresse reduz entradas (rev×0.8 e inadimplência ×1.5) e aumenta saídas ×1.1', async () => {
    jest.spyOn(service, 'getCashFlowProjection').mockResolvedValue({
      currentBalance: 1000,
      days: 2,
      alertDaysCount: 0,
      firstAlertDate: null,
      projection: [
        { date: '2026-07-08', receivable: 1000, payable: 500, netFlow: 500, projectedBalance: 1500, alert: false },
        { date: '2026-07-09', receivable: 0, payable: 2000, netFlow: -2000, projectedBalance: -500, alert: true },
      ],
    } as any);

    const result = await service.getCashFlowScenarios('co-1');
    expect(result.baseDefaultRate).toBe(20);
    expect(result.scenarios.map((s: any) => s.name)).toEqual(['base', 'otimista', 'estresse']);

    const base = result.scenarios[0];
    // base: inflow 1000 × (1−0.2) = 800; outflow 500 → dia1 saldo 1300
    expect(base.projection[0].inflow).toBe(800);
    expect(base.projection[0].projectedBalance).toBe(1300);

    const stress = result.scenarios[2];
    // estresse: rate 30%; inflow 1000×0.8×0.7 = 560; outflow 550 → 1010; dia2 outflow 2200 → −1190
    expect(stress.effectiveDefaultRate).toBe(30);
    expect(stress.projection[0].inflow).toBe(560);
    expect(stress.projection[0].outflow).toBe(550);
    expect(stress.finalBalance).toBe(1000 + 560 - 550 - 2200);
    expect(stress.firstAlertDate).toBe('2026-07-09');
  });
});
