import { Test, TestingModule } from '@nestjs/testing';
import { FraudDetectionService } from './fraud-detection.service';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

// ─── Mock Prisma ──────────────────────────────────────────────────────────────

const mockPrisma = {
  payable: {
    findFirst: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
  },
  receivable: {
    findFirst: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
  },
  fraudRule: {
    findFirst: jest.fn(),
    upsert: jest.fn(),
    findMany: jest.fn(),
  },
  fraudAlert: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const COMPANY_ID = 'co-1';
const BANK_ACCOUNT_ID = 'ba-1';

function setCurrentHourUTC(hour: number) {
  // Mock Date to return a specific UTC hour
  const now = new Date();
  jest.spyOn(global, 'Date').mockImplementation((...args: any[]) => {
    if (args.length === 0) {
      const d = new (jest.requireActual('Date') as DateConstructor)();
      // UTC-3 Brazil: to force brazilHour = hour we set UTCHours = hour + 3
      d.setUTCHours((hour + 3) % 24, 0, 0, 0);
      return d;
    }
    return new (jest.requireActual('Date') as DateConstructor)(...args);
  });
}

function restoreDate() {
  (global.Date as jest.Mock).mockRestore?.();
  jest.restoreAllMocks();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FraudDetectionService', () => {
  let service: FraudDetectionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FraudDetectionService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<FraudDetectionService>(FraudDetectionService);
    jest.clearAllMocks();

    // Default mock: no fraud signals
    mockPrisma.payable.findFirst.mockResolvedValue(null);
    mockPrisma.receivable.findFirst.mockResolvedValue(null);
    mockPrisma.payable.count.mockResolvedValue(0);
    mockPrisma.receivable.count.mockResolvedValue(0);
    mockPrisma.payable.aggregate.mockResolvedValue({
      _avg: { amount: null },
      _count: { id: 0 },
      _max: { amount: null },
    });
    mockPrisma.receivable.aggregate.mockResolvedValue({
      _avg: { amount: null },
      _count: { id: 0 },
      _max: { amount: null },
    });
    mockPrisma.fraudRule.findFirst.mockResolvedValue(null);
    mockPrisma.fraudAlert.create.mockResolvedValue({});
  });

  afterEach(() => {
    restoreDate();
  });

  // ─── checkTransaction ──────────────────────────────────────────────────────

  describe('checkTransaction', () => {
    it('should allow transaction with no flags during business hours', async () => {
      // 10h Brazil (UTC-3) = 13h UTC
      jest.spyOn(Date.prototype, 'getUTCHours').mockReturnValue(13);

      const result = await service.checkTransaction(
        COMPANY_ID,
        BANK_ACCOUNT_ID,
        1000,
        'PIX',
      );

      expect(result.allowed).toBe(true);
      expect(result.flags).toHaveLength(0);
    });

    it('should flag UNUSUAL_HOUR (LOW) for transactions between 22:00-06:00 Brazil time', async () => {
      // 23h Brazil = 2h UTC
      jest.spyOn(Date.prototype, 'getUTCHours').mockReturnValue(2);

      const result = await service.checkTransaction(
        COMPANY_ID,
        BANK_ACCOUNT_ID,
        100,
        'PIX',
      );

      const unusualFlag = result.flags.find((f) => f.type === 'UNUSUAL_HOUR');
      expect(unusualFlag).toBeDefined();
      expect(unusualFlag?.severity).toBe('LOW');
      // LOW flags should not block
      expect(result.allowed).toBe(true);
    });

    it('should flag HIGH_VALUE (MEDIUM) when amount > 3x average', async () => {
      // Average is 1000 (based on 2 payables at 1000 each)
      mockPrisma.payable.aggregate.mockResolvedValue({
        _avg: { amount: 1000 },
        _count: { id: 2 },
        _max: { amount: 1000 },
      });
      mockPrisma.receivable.aggregate.mockResolvedValue({
        _avg: { amount: null },
        _count: { id: 0 },
        _max: { amount: null },
      });

      const result = await service.checkTransaction(
        COMPANY_ID,
        BANK_ACCOUNT_ID,
        4000, // > 3x 1000
        'BOLETO',
      );

      const highValueFlag = result.flags.find((f) => f.type === 'HIGH_VALUE');
      expect(highValueFlag).toBeDefined();
      expect(highValueFlag?.severity).toBe('MEDIUM');
      // MEDIUM alone should not block
      expect(result.allowed).toBe(true);
    });

    it('should flag DUPLICATE (HIGH) and block when same amount in last 5 min', async () => {
      mockPrisma.payable.findFirst.mockResolvedValue({
        id: 'pay-1',
        amount: 500,
      });

      const result = await service.checkTransaction(
        COMPANY_ID,
        BANK_ACCOUNT_ID,
        500,
        'PAYMENT',
      );

      const dupFlag = result.flags.find((f) => f.type === 'DUPLICATE');
      expect(dupFlag).toBeDefined();
      expect(dupFlag?.severity).toBe('HIGH');
      expect(result.allowed).toBe(false);
    });

    it('should flag DUPLICATE via receivable when duplicate found there', async () => {
      mockPrisma.payable.findFirst.mockResolvedValue(null);
      mockPrisma.receivable.findFirst.mockResolvedValue({
        id: 'rec-1',
        amount: 800,
      });

      const result = await service.checkTransaction(
        COMPANY_ID,
        BANK_ACCOUNT_ID,
        800,
        'PIX',
      );

      const dupFlag = result.flags.find((f) => f.type === 'DUPLICATE');
      expect(dupFlag).toBeDefined();
      expect(dupFlag?.severity).toBe('HIGH');
      expect(result.allowed).toBe(false);
    });

    it('should flag RATE_LIMIT (MEDIUM) when more than 20 transactions in last hour', async () => {
      mockPrisma.payable.count.mockResolvedValue(12);
      mockPrisma.receivable.count.mockResolvedValue(10); // total = 22 >= 20

      const result = await service.checkTransaction(
        COMPANY_ID,
        BANK_ACCOUNT_ID,
        100,
        'PIX',
      );

      const rateLimitFlag = result.flags.find((f) => f.type === 'RATE_LIMIT');
      expect(rateLimitFlag).toBeDefined();
      expect(rateLimitFlag?.severity).toBe('MEDIUM');
      // MEDIUM alone does not block
      expect(result.allowed).toBe(true);
    });

    it('should flag WHITELIST_EXCEEDED (HIGH) and block when amount exceeds rule', async () => {
      mockPrisma.fraudRule.findFirst.mockResolvedValue({
        id: 'rule-1',
        companyId: COMPANY_ID,
        transactionType: 'TRANSFER',
        maxAmount: 5000,
        isActive: true,
      });

      const result = await service.checkTransaction(
        COMPANY_ID,
        BANK_ACCOUNT_ID,
        10000, // exceeds 5000
        'TRANSFER',
      );

      const whitelistFlag = result.flags.find(
        (f) => f.type === 'WHITELIST_EXCEEDED',
      );
      expect(whitelistFlag).toBeDefined();
      expect(whitelistFlag?.severity).toBe('HIGH');
      expect(result.allowed).toBe(false);
    });

    it('should not flag WHITELIST_EXCEEDED when amount is within rule', async () => {
      mockPrisma.fraudRule.findFirst.mockResolvedValue({
        id: 'rule-1',
        companyId: COMPANY_ID,
        transactionType: 'TRANSFER',
        maxAmount: 5000,
        isActive: true,
      });

      const result = await service.checkTransaction(
        COMPANY_ID,
        BANK_ACCOUNT_ID,
        4999,
        'TRANSFER',
      );

      const whitelistFlag = result.flags.find(
        (f) => f.type === 'WHITELIST_EXCEEDED',
      );
      expect(whitelistFlag).toBeUndefined();
    });

    it('should persist MEDIUM/HIGH alerts to DB', async () => {
      mockPrisma.payable.findFirst.mockResolvedValue({ id: 'pay-1', amount: 100 });

      await service.checkTransaction(COMPANY_ID, BANK_ACCOUNT_ID, 100, 'PIX');

      expect(mockPrisma.fraudAlert.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: COMPANY_ID,
            bankAccountId: BANK_ACCOUNT_ID,
            flagType: 'DUPLICATE',
            severity: 'HIGH',
          }),
        }),
      );
    });

    it('should not persist LOW alerts to DB', async () => {
      // Only UNUSUAL_HOUR (LOW) is triggered
      jest.spyOn(Date.prototype, 'getUTCHours').mockReturnValue(2); // 23h Brazil

      await service.checkTransaction(COMPANY_ID, BANK_ACCOUNT_ID, 100, 'PIX');

      expect(mockPrisma.fraudAlert.create).not.toHaveBeenCalled();
    });
  });

  // ─── getTransactionStats ──────────────────────────────────────────────────

  describe('getTransactionStats', () => {
    it('should return zeros when no transactions exist', async () => {
      mockPrisma.payable.aggregate.mockResolvedValue({
        _avg: { amount: null },
        _count: { id: 0 },
        _max: { amount: null },
      });
      mockPrisma.receivable.aggregate.mockResolvedValue({
        _avg: { amount: null },
        _count: { id: 0 },
        _max: { amount: null },
      });

      const stats = await service.getTransactionStats(COMPANY_ID, BANK_ACCOUNT_ID);

      expect(stats.average).toBe(0);
      expect(stats.count).toBe(0);
      expect(stats.max).toBe(0);
    });

    it('should calculate weighted average across payables and receivables', async () => {
      mockPrisma.payable.aggregate.mockResolvedValue({
        _avg: { amount: 2000 },
        _count: { id: 4 },
        _max: { amount: 3000 },
      });
      mockPrisma.receivable.aggregate.mockResolvedValue({
        _avg: { amount: 1000 },
        _count: { id: 6 },
        _max: { amount: 1500 },
      });

      const stats = await service.getTransactionStats(COMPANY_ID, BANK_ACCOUNT_ID);

      // Weighted: (2000*4 + 1000*6) / 10 = (8000 + 6000) / 10 = 1400
      expect(stats.average).toBe(1400);
      expect(stats.count).toBe(10);
      expect(stats.max).toBe(3000);
    });

    it('should use only payable data when no receivables exist', async () => {
      mockPrisma.payable.aggregate.mockResolvedValue({
        _avg: { amount: 500 },
        _count: { id: 3 },
        _max: { amount: 700 },
      });
      mockPrisma.receivable.aggregate.mockResolvedValue({
        _avg: { amount: null },
        _count: { id: 0 },
        _max: { amount: null },
      });

      const stats = await service.getTransactionStats(COMPANY_ID, BANK_ACCOUNT_ID);

      expect(stats.average).toBe(500);
      expect(stats.count).toBe(3);
      expect(stats.max).toBe(700);
    });
  });

  // ─── setMaxAmount ──────────────────────────────────────────────────────────

  describe('setMaxAmount', () => {
    it('should upsert a fraud rule with given max amount', async () => {
      const mockRule = {
        id: 'rule-1',
        companyId: COMPANY_ID,
        bankAccountId: BANK_ACCOUNT_ID,
        transactionType: 'PIX',
        maxAmount: 20000,
        isActive: true,
      };
      mockPrisma.fraudRule.upsert.mockResolvedValue(mockRule);

      const result = await service.setMaxAmount(
        COMPANY_ID,
        BANK_ACCOUNT_ID,
        'PIX',
        20000,
      );

      expect(result).toEqual(mockRule);
      expect(mockPrisma.fraudRule.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            companyId_bankAccountId_transactionType: {
              companyId: COMPANY_ID,
              bankAccountId: BANK_ACCOUNT_ID,
              transactionType: 'PIX',
            },
          },
          update: { maxAmount: 20000, isActive: true },
          create: expect.objectContaining({
            companyId: COMPANY_ID,
            bankAccountId: BANK_ACCOUNT_ID,
            transactionType: 'PIX',
            maxAmount: 20000,
          }),
        }),
      );
    });

    it('should allow null bankAccountId for company-wide rules', async () => {
      mockPrisma.fraudRule.upsert.mockResolvedValue({});

      await service.setMaxAmount(COMPANY_ID, null, 'BOLETO', 10000);

      expect(mockPrisma.fraudRule.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            companyId_bankAccountId_transactionType: {
              companyId: COMPANY_ID,
              bankAccountId: null,
              transactionType: 'BOLETO',
            },
          },
        }),
      );
    });
  });

  // ─── Alert management ──────────────────────────────────────────────────────

  describe('findAlerts', () => {
    it('should return all alerts when resolved is undefined', async () => {
      mockPrisma.fraudAlert.findMany.mockResolvedValue([{ id: 'a1' }]);

      const result = await service.findAlerts(COMPANY_ID, undefined);

      expect(mockPrisma.fraudAlert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: COMPANY_ID } }),
      );
      expect(result).toHaveLength(1);
    });

    it('should filter by resolved=false for open alerts', async () => {
      mockPrisma.fraudAlert.findMany.mockResolvedValue([]);

      await service.findAlerts(COMPANY_ID, false);

      expect(mockPrisma.fraudAlert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: COMPANY_ID, resolved: false },
        }),
      );
    });
  });

  describe('resolveAlert', () => {
    it('should mark alert as resolved', async () => {
      const mockAlert = { id: 'alert-1', companyId: COMPANY_ID, resolved: false };
      mockPrisma.fraudAlert.findFirst.mockResolvedValue(mockAlert);
      mockPrisma.fraudAlert.update.mockResolvedValue({ ...mockAlert, resolved: true });

      const result = await service.resolveAlert(COMPANY_ID, 'alert-1', 'user-1');

      expect(mockPrisma.fraudAlert.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'alert-1' },
          data: expect.objectContaining({
            resolved: true,
            resolvedBy: 'user-1',
          }),
        }),
      );
    });

    it('should throw BusinessException when alert not found', async () => {
      mockPrisma.fraudAlert.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveAlert(COMPANY_ID, 'nonexistent', 'user-1'),
      ).rejects.toThrow(BusinessException);
    });
  });
});
