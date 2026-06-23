import { Test, TestingModule } from '@nestjs/testing';
import { DdaService } from './dda.service';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

const mockCustomer = {
  id: 'customer-1',
  companyId: 'company-1',
  name: 'João Silva',
  document: '12345678901',
};

const mockBankAccount = {
  id: 'account-1',
  companyId: 'company-1',
  name: 'Conta Corrente Inter',
  bankCode: '077',
};

const mockMandate = {
  id: 'mandate-1',
  companyId: 'company-1',
  customerId: 'customer-1',
  bankAccountId: 'account-1',
  consentStatus: 'PENDING',
  maxAmount: null,
  startDate: new Date('2026-01-01'),
  endDate: null,
  cancelledAt: null,
  reference: 'REF-001',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockDebit = {
  id: 'debit-1',
  mandateId: 'mandate-1',
  amount: 500.00,
  debitDate: new Date('2026-06-22'),
  status: 'PENDING',
  processedAt: null,
  failReason: null,
  receivableId: null,
  createdAt: new Date(),
  mandate: {
    ...mockMandate,
    consentStatus: 'ACTIVE',
    endDate: null,
    maxAmount: null,
    bankAccount: mockBankAccount,
  },
};

const mockPrisma = {
  customer: {
    findFirst: jest.fn(),
  },
  bankAccount: {
    findFirst: jest.fn(),
  },
  ddaMandate: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  ddaDebit: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

describe('DdaService', () => {
  let service: DdaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DdaService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DdaService>(DdaService);
    jest.clearAllMocks();
  });

  // ─── createMandate ────────────────────────────────────────────────────────

  describe('createMandate', () => {
    const dto = {
      customerId: 'customer-1',
      bankAccountId: 'account-1',
      maxAmount: 1000,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      reference: 'REF-001',
    };

    it('should create a mandate when customer and bankAccount are found', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(mockCustomer);
      mockPrisma.bankAccount.findFirst.mockResolvedValue(mockBankAccount);
      mockPrisma.ddaMandate.create.mockResolvedValue({
        ...mockMandate,
        customer: mockCustomer,
        bankAccount: mockBankAccount,
      });

      const result = await service.createMandate('company-1', dto);

      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({
        where: { id: 'customer-1', companyId: 'company-1' },
      });
      expect(mockPrisma.bankAccount.findFirst).toHaveBeenCalledWith({
        where: { id: 'account-1', companyId: 'company-1' },
      });
      expect(mockPrisma.ddaMandate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: 'company-1',
          customerId: 'customer-1',
          bankAccountId: 'account-1',
          maxAmount: 1000,
          consentStatus: 'PENDING',
          reference: 'REF-001',
        }),
        include: expect.any(Object),
      });
      expect(result).toBeDefined();
    });

    it('should throw BusinessException when customer not found', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await expect(service.createMandate('company-1', dto)).rejects.toThrow(
        BusinessException,
      );
      expect(mockPrisma.ddaMandate.create).not.toHaveBeenCalled();
    });

    it('should throw BusinessException when bankAccount not found', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(mockCustomer);
      mockPrisma.bankAccount.findFirst.mockResolvedValue(null);

      await expect(service.createMandate('company-1', dto)).rejects.toThrow(
        BusinessException,
      );
      expect(mockPrisma.ddaMandate.create).not.toHaveBeenCalled();
    });

    it('should set endDate to null when not provided', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(mockCustomer);
      mockPrisma.bankAccount.findFirst.mockResolvedValue(mockBankAccount);
      mockPrisma.ddaMandate.create.mockResolvedValue(mockMandate);

      await service.createMandate('company-1', {
        customerId: 'customer-1',
        bankAccountId: 'account-1',
        startDate: '2026-01-01',
      });

      expect(mockPrisma.ddaMandate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ endDate: null }),
        }),
      );
    });
  });

  // ─── cancelMandate ────────────────────────────────────────────────────────

  describe('cancelMandate', () => {
    it('should cancel an existing mandate', async () => {
      mockPrisma.ddaMandate.findFirst.mockResolvedValue(mockMandate);
      mockPrisma.ddaMandate.update.mockResolvedValue({
        ...mockMandate,
        consentStatus: 'CANCELLED',
        cancelledAt: new Date(),
      });

      const result = await service.cancelMandate('company-1', 'mandate-1');

      expect(mockPrisma.ddaMandate.update).toHaveBeenCalledWith({
        where: { id: 'mandate-1' },
        data: expect.objectContaining({
          consentStatus: 'CANCELLED',
          cancelledAt: expect.any(Date),
        }),
        include: expect.any(Object),
      });
      expect(result.consentStatus).toBe('CANCELLED');
    });

    it('should throw BusinessException when mandate not found', async () => {
      mockPrisma.ddaMandate.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelMandate('company-1', 'nonexistent'),
      ).rejects.toThrow(BusinessException);
    });

    it('should throw BusinessException when mandate is already cancelled', async () => {
      mockPrisma.ddaMandate.findFirst.mockResolvedValue({
        ...mockMandate,
        consentStatus: 'CANCELLED',
      });

      await expect(
        service.cancelMandate('company-1', 'mandate-1'),
      ).rejects.toThrow(BusinessException);
    });
  });

  // ─── findMandates ─────────────────────────────────────────────────────────

  describe('findMandates', () => {
    it('should find all mandates for company', async () => {
      mockPrisma.ddaMandate.findMany.mockResolvedValue([mockMandate]);

      const result = await service.findMandates('company-1');

      expect(mockPrisma.ddaMandate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'company-1' },
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('should filter by status', async () => {
      mockPrisma.ddaMandate.findMany.mockResolvedValue([]);

      await service.findMandates('company-1', { status: 'ACTIVE' });

      expect(mockPrisma.ddaMandate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'company-1', consentStatus: 'ACTIVE' },
        }),
      );
    });

    it('should filter by customerId', async () => {
      mockPrisma.ddaMandate.findMany.mockResolvedValue([mockMandate]);

      await service.findMandates('company-1', { customerId: 'customer-1' });

      expect(mockPrisma.ddaMandate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'company-1', customerId: 'customer-1' },
        }),
      );
    });

    it('should filter by bankAccountId', async () => {
      mockPrisma.ddaMandate.findMany.mockResolvedValue([mockMandate]);

      await service.findMandates('company-1', { bankAccountId: 'account-1' });

      expect(mockPrisma.ddaMandate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'company-1', bankAccountId: 'account-1' },
        }),
      );
    });

    it('should return empty array when no mandates exist', async () => {
      mockPrisma.ddaMandate.findMany.mockResolvedValue([]);

      const result = await service.findMandates('company-1');
      expect(result).toEqual([]);
    });
  });

  // ─── processAuthorizedDebits ──────────────────────────────────────────────

  describe('processAuthorizedDebits', () => {
    it('should return { processed: 0, failed: 0 } when no pending debits', async () => {
      mockPrisma.ddaDebit.findMany.mockResolvedValue([]);

      const result = await service.processAuthorizedDebits();

      expect(result).toEqual({ processed: 0, failed: 0 });
    });

    it('should process a valid pending debit and mark it as PROCESSED', async () => {
      mockPrisma.ddaDebit.findMany.mockResolvedValue([mockDebit]);
      mockPrisma.ddaDebit.update.mockResolvedValue({
        ...mockDebit,
        status: 'PROCESSED',
        processedAt: new Date(),
      });

      const result = await service.processAuthorizedDebits();

      expect(mockPrisma.ddaDebit.update).toHaveBeenCalledWith({
        where: { id: 'debit-1' },
        data: expect.objectContaining({
          status: 'PROCESSED',
          processedAt: expect.any(Date),
        }),
      });
      expect(result).toEqual({ processed: 1, failed: 0 });
    });

    it('should fail debit when mandate is expired (endDate < today)', async () => {
      const expiredDebit = {
        ...mockDebit,
        mandate: {
          ...mockDebit.mandate,
          consentStatus: 'ACTIVE',
          endDate: new Date('2020-01-01'), // expired
        },
      };
      mockPrisma.ddaDebit.findMany.mockResolvedValue([expiredDebit]);
      mockPrisma.ddaDebit.update.mockResolvedValue({
        ...expiredDebit,
        status: 'FAILED',
      });
      mockPrisma.ddaMandate.update.mockResolvedValue({
        ...expiredDebit.mandate,
        consentStatus: 'EXPIRED',
      });

      const result = await service.processAuthorizedDebits();

      expect(mockPrisma.ddaDebit.update).toHaveBeenCalledWith({
        where: { id: 'debit-1' },
        data: expect.objectContaining({
          status: 'FAILED',
          failReason: 'Mandato expirado',
        }),
      });
      expect(result).toEqual({ processed: 0, failed: 1 });
    });

    it('should fail debit when amount exceeds maxAmount', async () => {
      const debitExceedingLimit = {
        ...mockDebit,
        amount: 1500.00, // exceeds maxAmount
        mandate: {
          ...mockDebit.mandate,
          consentStatus: 'ACTIVE',
          maxAmount: 1000.00, // maxAmount = 1000
          endDate: null,
        },
      };
      mockPrisma.ddaDebit.findMany.mockResolvedValue([debitExceedingLimit]);
      mockPrisma.ddaDebit.update.mockResolvedValue({
        ...debitExceedingLimit,
        status: 'FAILED',
      });

      const result = await service.processAuthorizedDebits();

      expect(mockPrisma.ddaDebit.update).toHaveBeenCalledWith({
        where: { id: 'debit-1' },
        data: expect.objectContaining({
          status: 'FAILED',
          failReason: expect.stringContaining('excede limite'),
        }),
      });
      expect(result).toEqual({ processed: 0, failed: 1 });
    });

    it('should process multiple debits and count correctly', async () => {
      const validDebit1 = { ...mockDebit, id: 'debit-1' };
      const validDebit2 = { ...mockDebit, id: 'debit-2' };
      mockPrisma.ddaDebit.findMany.mockResolvedValue([validDebit1, validDebit2]);
      mockPrisma.ddaDebit.update.mockResolvedValue({ status: 'PROCESSED', processedAt: new Date() });

      const result = await service.processAuthorizedDebits();

      expect(result.processed).toBe(2);
      expect(result.failed).toBe(0);
    });
  });
});
