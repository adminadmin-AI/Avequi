import { Test, TestingModule } from '@nestjs/testing';
import { CreditLimitService } from './credit-limit.service';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

const mockPrisma = {
  customer: {
    findFirst: jest.fn(),
  },
  creditLimit: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const mockCustomer = { id: 'cust-1', companyId: 'co-1', name: 'Cliente Teste' };
const mockLimit = {
  id: 'cl-1',
  companyId: 'co-1',
  customerId: 'cust-1',
  maxAmount: 10000,
  usedAmount: 2000,
  status: 'ACTIVE',
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('CreditLimitService', () => {
  let service: CreditLimitService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreditLimitService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CreditLimitService>(CreditLimitService);
    jest.clearAllMocks();
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should upsert a credit limit for a valid customer', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(mockCustomer);
      mockPrisma.creditLimit.upsert.mockResolvedValue(mockLimit);

      const result = await service.create('co-1', {
        customerId: 'cust-1',
        maxAmount: 10000,
      });
      expect(result).toEqual(mockLimit);
      expect(mockPrisma.creditLimit.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId_customerId: { companyId: 'co-1', customerId: 'cust-1' } },
        }),
      );
    });

    it('should throw BusinessException if customer not in company', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.create('co-1', { customerId: 'bad', maxAmount: 1000 }),
      ).rejects.toThrow(BusinessException);
    });
  });

  // ─── findByCustomer ───────────────────────────────────────────────────────

  describe('findByCustomer', () => {
    it('should return the limit with customer info', async () => {
      mockPrisma.creditLimit.findUnique.mockResolvedValue({
        ...mockLimit,
        customer: { id: 'cust-1', name: 'Cliente Teste', document: '12345678000195' },
      });

      const result = await service.findByCustomer('co-1', 'cust-1');
      expect(result.customerId).toBe('cust-1');
    });

    it('should throw BusinessException if no limit exists', async () => {
      mockPrisma.creditLimit.findUnique.mockResolvedValue(null);

      await expect(service.findByCustomer('co-1', 'cust-1')).rejects.toThrow(BusinessException);
    });
  });

  // ─── checkAvailability ────────────────────────────────────────────────────

  describe('checkAvailability', () => {
    it('should return available=true when amount fits within remaining', async () => {
      mockPrisma.creditLimit.findUnique.mockResolvedValue(mockLimit);

      const result = await service.checkAvailability('co-1', 'cust-1', 5000);
      expect(result.available).toBe(true);
      expect(result.remainingAmount).toBe(8000);
    });

    it('should return available=false when amount exceeds remaining', async () => {
      mockPrisma.creditLimit.findUnique.mockResolvedValue(mockLimit);

      const result = await service.checkAvailability('co-1', 'cust-1', 9000);
      expect(result.available).toBe(false);
    });

    it('should return available=false when limit does not exist', async () => {
      mockPrisma.creditLimit.findUnique.mockResolvedValue(null);

      const result = await service.checkAvailability('co-1', 'cust-1', 100);
      expect(result.available).toBe(false);
    });

    it('should return available=false when limit is SUSPENDED', async () => {
      mockPrisma.creditLimit.findUnique.mockResolvedValue({
        ...mockLimit,
        status: 'SUSPENDED',
      });

      const result = await service.checkAvailability('co-1', 'cust-1', 100);
      expect(result.available).toBe(false);
    });
  });

  // ─── consume ──────────────────────────────────────────────────────────────

  describe('consume', () => {
    it('should increment usedAmount when within limit', async () => {
      mockPrisma.creditLimit.findUnique.mockResolvedValue(mockLimit);
      mockPrisma.creditLimit.update.mockResolvedValue({ ...mockLimit, usedAmount: 5000 });

      const result = await service.consume('co-1', 'cust-1', 3000);
      expect(mockPrisma.creditLimit.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { usedAmount: 5000 } }),
      );
    });

    it('should throw BusinessException when amount exceeds remaining limit', async () => {
      mockPrisma.creditLimit.findUnique.mockResolvedValue(mockLimit);

      await expect(service.consume('co-1', 'cust-1', 9000)).rejects.toThrow(BusinessException);
    });

    it('should throw BusinessException when limit is SUSPENDED', async () => {
      mockPrisma.creditLimit.findUnique.mockResolvedValue({
        ...mockLimit,
        status: 'SUSPENDED',
      });

      await expect(service.consume('co-1', 'cust-1', 100)).rejects.toThrow(BusinessException);
    });

    it('should throw BusinessException when no limit exists', async () => {
      mockPrisma.creditLimit.findUnique.mockResolvedValue(null);

      await expect(service.consume('co-1', 'cust-1', 100)).rejects.toThrow(BusinessException);
    });
  });

  // ─── release ──────────────────────────────────────────────────────────────

  describe('release', () => {
    it('should decrement usedAmount', async () => {
      mockPrisma.creditLimit.findUnique.mockResolvedValue(mockLimit);
      mockPrisma.creditLimit.update.mockResolvedValue({ ...mockLimit, usedAmount: 1000 });

      await service.release('co-1', 'cust-1', 1000);
      expect(mockPrisma.creditLimit.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { usedAmount: 1000 } }),
      );
    });

    it('should not go below zero (floor at 0)', async () => {
      mockPrisma.creditLimit.findUnique.mockResolvedValue({ ...mockLimit, usedAmount: 100 });
      mockPrisma.creditLimit.update.mockResolvedValue({ ...mockLimit, usedAmount: 0 });

      await service.release('co-1', 'cust-1', 9999);
      expect(mockPrisma.creditLimit.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { usedAmount: 0 } }),
      );
    });

    it('should throw BusinessException when no limit exists', async () => {
      mockPrisma.creditLimit.findUnique.mockResolvedValue(null);

      await expect(service.release('co-1', 'cust-1', 100)).rejects.toThrow(BusinessException);
    });
  });

  // ─── suspend / activate ───────────────────────────────────────────────────

  describe('suspend', () => {
    it('should set status to SUSPENDED', async () => {
      mockPrisma.creditLimit.findUnique.mockResolvedValue(mockLimit);
      mockPrisma.creditLimit.update.mockResolvedValue({ ...mockLimit, status: 'SUSPENDED' });

      await service.suspend('co-1', 'cust-1');
      expect(mockPrisma.creditLimit.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'SUSPENDED' } }),
      );
    });

    it('should throw BusinessException when no limit exists', async () => {
      mockPrisma.creditLimit.findUnique.mockResolvedValue(null);
      await expect(service.suspend('co-1', 'cust-1')).rejects.toThrow(BusinessException);
    });
  });

  describe('activate', () => {
    it('should set status to ACTIVE', async () => {
      mockPrisma.creditLimit.findUnique.mockResolvedValue({ ...mockLimit, status: 'SUSPENDED' });
      mockPrisma.creditLimit.update.mockResolvedValue({ ...mockLimit, status: 'ACTIVE' });

      await service.activate('co-1', 'cust-1');
      expect(mockPrisma.creditLimit.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'ACTIVE' } }),
      );
    });

    it('should throw BusinessException when no limit exists', async () => {
      mockPrisma.creditLimit.findUnique.mockResolvedValue(null);
      await expect(service.activate('co-1', 'cust-1')).rejects.toThrow(BusinessException);
    });
  });
});
