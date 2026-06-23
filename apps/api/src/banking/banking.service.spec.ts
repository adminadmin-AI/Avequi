import { Test, TestingModule } from '@nestjs/testing';
import { BankingService } from './banking.service';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

const mockBankAccount = {
  id: 'account-1',
  companyId: 'company-1',
  name: 'Conta Corrente Inter',
  bankCode: '077',
  agency: '0001',
  accountNumber: '123456-7',
  type: 'CHECKING',
  initialBalance: 5000,
  isActive: true,
  legacyId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPrisma = {
  bankAccount: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  receivable: {
    aggregate: jest.fn(),
  },
  payable: {
    aggregate: jest.fn(),
  },
};

describe('BankingService', () => {
  let service: BankingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BankingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BankingService>(BankingService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all active bank accounts for the company', async () => {
      mockPrisma.bankAccount.findMany.mockResolvedValue([mockBankAccount]);

      const result = await service.findAll('company-1');

      expect(result).toEqual([mockBankAccount]);
      expect(mockPrisma.bankAccount.findMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1', isActive: true },
        orderBy: { name: 'asc' },
      });
    });

    it('should return empty array when no accounts exist', async () => {
      mockPrisma.bankAccount.findMany.mockResolvedValue([]);
      const result = await service.findAll('company-1');
      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should return a bank account by id', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(mockBankAccount);

      const result = await service.findOne('company-1', 'account-1');

      expect(result).toEqual(mockBankAccount);
      expect(mockPrisma.bankAccount.findFirst).toHaveBeenCalledWith({
        where: { id: 'account-1', companyId: 'company-1' },
      });
    });

    it('should throw BusinessException when account not found', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(null);

      await expect(service.findOne('company-1', 'nonexistent')).rejects.toThrow(
        BusinessException,
      );
    });
  });

  describe('getBalance', () => {
    it('should calculate balance correctly', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(mockBankAccount);
      mockPrisma.receivable.aggregate
        .mockResolvedValueOnce({ _sum: { paidAmount: 10000 } })  // paid receivables
        .mockResolvedValueOnce({ _sum: { amount: 5000 } });       // open receivables
      mockPrisma.payable.aggregate
        .mockResolvedValueOnce({ _sum: { paidAmount: 3000 } })   // paid payables
        .mockResolvedValueOnce({ _sum: { amount: 2000 } });       // open payables

      const result = await service.getBalance('company-1', 'account-1');

      expect(result.initialBalance).toBe(5000);
      expect(result.credits).toBe(10000);
      expect(result.debits).toBe(3000);
      expect(result.currentBalance).toBe(12000); // 5000 + 10000 - 3000
      expect(result.pendingCredits).toBe(5000);
      expect(result.pendingDebits).toBe(2000);
      expect(result.projectedBalance).toBe(15000); // 12000 + 5000 - 2000
    });

    it('should handle null aggregate sums', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue({
        ...mockBankAccount,
        initialBalance: 1000,
      });
      mockPrisma.receivable.aggregate
        .mockResolvedValue({ _sum: { paidAmount: null } });
      mockPrisma.payable.aggregate
        .mockResolvedValue({ _sum: { paidAmount: null, amount: null } });

      const result = await service.getBalance('company-1', 'account-1');

      expect(result.credits).toBe(0);
      expect(result.debits).toBe(0);
      expect(result.currentBalance).toBe(1000);
    });

    it('should throw when bank account not found', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(null);

      await expect(service.getBalance('company-1', 'bad-id')).rejects.toThrow(
        BusinessException,
      );
    });
  });
});
