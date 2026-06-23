import { Test, TestingModule } from '@nestjs/testing';
import { BankingReportService } from './banking-report.service';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

// ─── Mock Prisma ──────────────────────────────────────────────────────────────

const mockPrisma = {
  bankAccount: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  payable: {
    findMany: jest.fn(),
    aggregate: jest.fn(),
  },
  receivable: {
    findMany: jest.fn(),
    aggregate: jest.fn(),
  },
  pixCharge: {
    findMany: jest.fn(),
    aggregate: jest.fn(),
  },
  boleto: {
    findMany: jest.fn(),
    aggregate: jest.fn(),
  },
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const COMPANY_ID = 'co-1';
const BANK_ACCOUNT_ID = 'ba-1';

const mockBankAccount = {
  id: BANK_ACCOUNT_ID,
  companyId: COMPANY_ID,
  name: 'Conta Corrente BB',
  bankCode: '001',
  agency: '1234',
  accountNumber: '56789-0',
  initialBalance: 10000,
  isActive: true,
  type: 'CHECKING',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const START_DATE = new Date('2026-06-01');
const END_DATE = new Date('2026-06-30');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BankingReportService', () => {
  let service: BankingReportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BankingReportService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BankingReportService>(BankingReportService);
    jest.clearAllMocks();

    // Default: empty lists and zero aggregates
    mockPrisma.payable.findMany.mockResolvedValue([]);
    mockPrisma.receivable.findMany.mockResolvedValue([]);
    mockPrisma.pixCharge.findMany.mockResolvedValue([]);
    mockPrisma.boleto.findMany.mockResolvedValue([]);
    mockPrisma.payable.aggregate.mockResolvedValue({
      _sum: { paidAmount: null, amount: null },
    });
    mockPrisma.receivable.aggregate.mockResolvedValue({
      _sum: { paidAmount: null, amount: null },
    });
    mockPrisma.pixCharge.aggregate.mockResolvedValue({
      _sum: { paidAmount: null, amount: null },
    });
    mockPrisma.boleto.aggregate.mockResolvedValue({
      _sum: { amount: null },
    });
  });

  // ─── getStatement ──────────────────────────────────────────────────────────

  describe('getStatement', () => {
    it('should throw BusinessException when bank account not found', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(null);

      await expect(
        service.getStatement(COMPANY_ID, 'bad-id', START_DATE, END_DATE),
      ).rejects.toThrow(BusinessException);
    });

    it('should return empty statement with opening=closing balance when no movements', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(mockBankAccount);

      // Opening balance: no prior movements, so it equals initialBalance
      mockPrisma.receivable.aggregate.mockResolvedValue({
        _sum: { paidAmount: null, amount: null },
      });
      mockPrisma.payable.aggregate.mockResolvedValue({
        _sum: { paidAmount: null, amount: null },
      });

      const result = await service.getStatement(
        COMPANY_ID,
        BANK_ACCOUNT_ID,
        START_DATE,
        END_DATE,
      );

      expect(result.entries).toHaveLength(0);
      expect(result.openingBalance).toBe(10000);
      expect(result.closingBalance).toBe(10000);
      expect(result.bankAccount.id).toBe(BANK_ACCOUNT_ID);
    });

    it('should calculate running balance with credits and debits', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(mockBankAccount);

      // No prior balance movements
      mockPrisma.receivable.aggregate.mockResolvedValue({
        _sum: { paidAmount: null, amount: null },
      });
      mockPrisma.payable.aggregate.mockResolvedValue({
        _sum: { paidAmount: null, amount: null },
      });

      const june10 = new Date('2026-06-10T10:00:00Z');
      const june15 = new Date('2026-06-15T10:00:00Z');
      const june20 = new Date('2026-06-20T10:00:00Z');

      // 1 receivable (credit +3000) on June 10
      mockPrisma.receivable.findMany.mockResolvedValue([
        {
          id: 'rec-1',
          paidAt: june10,
          dueDate: june10,
          description: 'Venda cliente X',
          paidAmount: 3000,
          amount: 3000,
          status: 'PAID',
        },
      ]);

      // 1 payable (debit -1500) on June 15
      mockPrisma.payable.findMany.mockResolvedValue([
        {
          id: 'pay-1',
          paidAt: june15,
          dueDate: june15,
          description: 'Fornecedor Y',
          paidAmount: 1500,
          amount: 1500,
          status: 'PAID',
        },
      ]);

      // 1 pix charge (credit +500) on June 20
      mockPrisma.pixCharge.findMany.mockResolvedValue([
        {
          id: 'pix-1',
          paidAt: june20,
          createdAt: june20,
          description: 'Pix cobrado',
          paidAmount: 500,
          amount: 500,
          status: 'PAID',
        },
      ]);

      const result = await service.getStatement(
        COMPANY_ID,
        BANK_ACCOUNT_ID,
        START_DATE,
        END_DATE,
      );

      expect(result.entries).toHaveLength(3);
      expect(result.openingBalance).toBe(10000);

      // First entry: credit +3000 → 13000
      expect(result.entries[0].direction).toBe('CREDIT');
      expect(result.entries[0].amount).toBe(3000);
      expect(result.entries[0].runningBalance).toBe(13000);
      expect(result.entries[0].source).toBe('RECEIVABLE');

      // Second entry: debit -1500 → 11500
      expect(result.entries[1].direction).toBe('DEBIT');
      expect(result.entries[1].amount).toBe(1500);
      expect(result.entries[1].runningBalance).toBe(11500);
      expect(result.entries[1].source).toBe('PAYABLE');

      // Third entry: credit +500 → 12000
      expect(result.entries[2].direction).toBe('CREDIT');
      expect(result.entries[2].amount).toBe(500);
      expect(result.entries[2].runningBalance).toBe(12000);
      expect(result.entries[2].source).toBe('PIX');

      expect(result.closingBalance).toBe(12000);
    });

    it('should include boleto as CREDIT entry', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(mockBankAccount);
      mockPrisma.receivable.aggregate.mockResolvedValue({ _sum: { paidAmount: null, amount: null } });
      mockPrisma.payable.aggregate.mockResolvedValue({ _sum: { paidAmount: null, amount: null } });

      const june5 = new Date('2026-06-05T08:00:00Z');
      mockPrisma.boleto.findMany.mockResolvedValue([
        {
          id: 'bol-1',
          paidAt: june5,
          dueDate: june5,
          description: 'Boleto cliente Z',
          paidAmount: 2000,
          amount: 2000,
          status: 'PAID',
        },
      ]);

      const result = await service.getStatement(
        COMPANY_ID,
        BANK_ACCOUNT_ID,
        START_DATE,
        END_DATE,
      );

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].direction).toBe('CREDIT');
      expect(result.entries[0].source).toBe('BOLETO');
      expect(result.entries[0].runningBalance).toBe(12000); // 10000 + 2000
    });

    it('should sort entries chronologically', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(mockBankAccount);
      mockPrisma.receivable.aggregate.mockResolvedValue({ _sum: { paidAmount: null, amount: null } });
      mockPrisma.payable.aggregate.mockResolvedValue({ _sum: { paidAmount: null, amount: null } });

      const june20 = new Date('2026-06-20');
      const june5 = new Date('2026-06-05');

      // Return receivable (june20) before payable (june5) — they should be reordered
      mockPrisma.receivable.findMany.mockResolvedValue([
        {
          id: 'rec-1',
          paidAt: june20,
          dueDate: june20,
          description: null,
          paidAmount: 1000,
          amount: 1000,
        },
      ]);
      mockPrisma.payable.findMany.mockResolvedValue([
        {
          id: 'pay-1',
          paidAt: june5,
          dueDate: june5,
          description: null,
          paidAmount: 500,
          amount: 500,
        },
      ]);

      const result = await service.getStatement(
        COMPANY_ID,
        BANK_ACCOUNT_ID,
        START_DATE,
        END_DATE,
      );

      // Should be sorted: june5 first, then june20
      expect(result.entries[0].date.getTime()).toBe(june5.getTime());
      expect(result.entries[1].date.getTime()).toBe(june20.getTime());
    });

    it('should use fallback description when entry has no description', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(mockBankAccount);
      mockPrisma.receivable.aggregate.mockResolvedValue({ _sum: { paidAmount: null, amount: null } });
      mockPrisma.payable.aggregate.mockResolvedValue({ _sum: { paidAmount: null, amount: null } });

      mockPrisma.receivable.findMany.mockResolvedValue([
        {
          id: 'rec-1',
          paidAt: new Date('2026-06-10'),
          dueDate: new Date('2026-06-10'),
          description: null,
          paidAmount: 100,
          amount: 100,
        },
      ]);

      const result = await service.getStatement(
        COMPANY_ID,
        BANK_ACCOUNT_ID,
        START_DATE,
        END_DATE,
      );

      expect(result.entries[0].description).toBe('Recebimento');
    });
  });

  // ─── getSummary ────────────────────────────────────────────────────────────

  describe('getSummary', () => {
    it('should return zero totals with no accounts', async () => {
      mockPrisma.bankAccount.findMany.mockResolvedValue([]);

      const result = await service.getSummary(COMPANY_ID, START_DATE, END_DATE);

      expect(result.totalCredits).toBe(0);
      expect(result.totalDebits).toBe(0);
      expect(result.netMovement).toBe(0);
      expect(result.byAccount).toHaveLength(0);
    });

    it('should aggregate credits and debits across accounts', async () => {
      const account2 = { ...mockBankAccount, id: 'ba-2', name: 'Poupança' };
      mockPrisma.bankAccount.findMany.mockResolvedValue([mockBankAccount, account2]);

      // First account: 5000 credits (receivable), 2000 debits (payable)
      // Second account: 3000 credits (pix), 1000 debits
      mockPrisma.receivable.aggregate
        .mockResolvedValueOnce({ _sum: { paidAmount: 5000, amount: 5000 } })   // ba-1
        .mockResolvedValueOnce({ _sum: { paidAmount: 0, amount: 0 } });         // ba-2

      mockPrisma.payable.aggregate
        .mockResolvedValueOnce({ _sum: { paidAmount: 2000, amount: 2000 } })   // ba-1
        .mockResolvedValueOnce({ _sum: { paidAmount: 1000, amount: 1000 } });  // ba-2

      mockPrisma.pixCharge.aggregate
        .mockResolvedValueOnce({ _sum: { paidAmount: null, amount: null } })    // ba-1
        .mockResolvedValueOnce({ _sum: { paidAmount: 3000, amount: 3000 } });  // ba-2

      // Boletos: no paid boletos
      mockPrisma.boleto.aggregate.mockResolvedValue({ _sum: { amount: null } });

      const result = await service.getSummary(COMPANY_ID, START_DATE, END_DATE);

      expect(result.byAccount).toHaveLength(2);

      const acc1 = result.byAccount.find((a) => a.bankAccountId === 'ba-1');
      expect(acc1?.totalCredits).toBe(5000);
      expect(acc1?.totalDebits).toBe(2000);
      expect(acc1?.netMovement).toBe(3000);

      const acc2 = result.byAccount.find((a) => a.bankAccountId === 'ba-2');
      expect(acc2?.totalCredits).toBe(3000);
      expect(acc2?.totalDebits).toBe(1000);
      expect(acc2?.netMovement).toBe(2000);

      // Totals: 5000+3000=8000 credits, 2000+1000=3000 debits
      expect(result.totalCredits).toBe(8000);
      expect(result.totalDebits).toBe(3000);
      expect(result.netMovement).toBe(5000);
    });

    it('should include period in response', async () => {
      mockPrisma.bankAccount.findMany.mockResolvedValue([]);

      const result = await service.getSummary(COMPANY_ID, START_DATE, END_DATE);

      expect(result.period.startDate).toEqual(START_DATE);
      expect(result.period.endDate).toBeDefined();
    });
  });
});
