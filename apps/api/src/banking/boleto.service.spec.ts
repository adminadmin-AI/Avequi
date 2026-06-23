import { Test, TestingModule } from '@nestjs/testing';
import { BoletoService } from './boleto.service';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';
import { BoletoStatus } from '../../generated/prisma';

const companyId = 'company-1';
const bankAccountId = 'account-1';

const mockBankAccount = {
  id: bankAccountId,
  companyId,
  name: 'Conta Corrente',
  bankCode: '077',
  agency: '0001',
  accountNumber: '12345-6',
};

const mockBoleto = {
  id: 'boleto-1',
  companyId,
  bankAccountId,
  receivableId: null,
  nossoNumero: '00001',
  seuNumero: null,
  amount: 1500,
  dueDate: new Date('2026-07-31'),
  status: BoletoStatus.PENDING,
  payerName: 'João Silva',
  payerDocument: '123.456.789-01',
  payerAddress: 'Rua A, 100',
  payerCity: 'São Paulo',
  payerState: 'SP',
  payerZipCode: '01310-100',
  registeredAt: null,
  paidAt: null,
  paidAmount: null,
  cancelledAt: null,
  instructions: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const createDto = {
  bankAccountId,
  nossoNumero: '00001',
  amount: 1500,
  dueDate: '2026-07-31',
  payerName: 'João Silva',
  payerDocument: '123.456.789-01',
};

const mockPrisma = {
  bankAccount: { findFirst: jest.fn() },
  receivable: { findFirst: jest.fn() },
  boleto: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

describe('BoletoService', () => {
  let service: BoletoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BoletoService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BoletoService>(BoletoService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a boleto successfully', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(mockBankAccount);
      mockPrisma.boleto.findUnique.mockResolvedValue(null);
      mockPrisma.boleto.create.mockResolvedValue({ ...mockBoleto, bankAccount: mockBankAccount });

      const result = await service.create(companyId, createDto);

      expect(result).toHaveProperty('id', 'boleto-1');
      expect(mockPrisma.boleto.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId,
            bankAccountId,
            nossoNumero: '00001',
            amount: 1500,
          }),
        }),
      );
    });

    it('should throw when bank account not found', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(null);

      await expect(service.create(companyId, createDto)).rejects.toThrow(BusinessException);
    });

    it('should throw when nossoNumero already exists', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(mockBankAccount);
      mockPrisma.boleto.findUnique.mockResolvedValue(mockBoleto);

      await expect(service.create(companyId, createDto)).rejects.toThrow(BusinessException);
    });

    it('should throw when receivableId is provided but not found', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(mockBankAccount);
      mockPrisma.receivable.findFirst.mockResolvedValue(null);

      await expect(
        service.create(companyId, { ...createDto, receivableId: 'bad-id' }),
      ).rejects.toThrow(BusinessException);
    });
  });

  describe('findAll', () => {
    it('should return paginated boletos', async () => {
      mockPrisma.boleto.findMany.mockResolvedValue([mockBoleto]);
      mockPrisma.boleto.count.mockResolvedValue(1);

      const result = await service.findAll(companyId, { page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('should filter by status', async () => {
      mockPrisma.boleto.findMany.mockResolvedValue([]);
      mockPrisma.boleto.count.mockResolvedValue(0);

      await service.findAll(companyId, { status: BoletoStatus.PAID });

      expect(mockPrisma.boleto.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId, status: BoletoStatus.PAID },
        }),
      );
    });

    it('should filter by bankAccountId', async () => {
      mockPrisma.boleto.findMany.mockResolvedValue([]);
      mockPrisma.boleto.count.mockResolvedValue(0);

      await service.findAll(companyId, { bankAccountId });

      expect(mockPrisma.boleto.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId, bankAccountId },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return boleto detail', async () => {
      mockPrisma.boleto.findFirst.mockResolvedValue(mockBoleto);

      const result = await service.findOne(companyId, 'boleto-1');

      expect(result).toEqual(mockBoleto);
    });

    it('should throw when boleto not found', async () => {
      mockPrisma.boleto.findFirst.mockResolvedValue(null);

      await expect(service.findOne(companyId, 'bad-id')).rejects.toThrow(BusinessException);
    });
  });

  describe('update', () => {
    it('should update boleto successfully', async () => {
      mockPrisma.boleto.findFirst.mockResolvedValue(mockBoleto);
      mockPrisma.boleto.update.mockResolvedValue({ ...mockBoleto, amount: 2000 });

      const result = await service.update(companyId, 'boleto-1', { amount: 2000 });

      expect(result.amount).toBe(2000);
    });

    it('should throw when boleto is cancelled', async () => {
      mockPrisma.boleto.findFirst.mockResolvedValue({
        ...mockBoleto,
        status: BoletoStatus.CANCELLED,
      });

      await expect(
        service.update(companyId, 'boleto-1', { amount: 2000 }),
      ).rejects.toThrow(BusinessException);
    });

    it('should throw when boleto not found', async () => {
      mockPrisma.boleto.findFirst.mockResolvedValue(null);

      await expect(
        service.update(companyId, 'bad-id', { amount: 2000 }),
      ).rejects.toThrow(BusinessException);
    });
  });

  describe('cancel', () => {
    it('should cancel a pending boleto', async () => {
      mockPrisma.boleto.findFirst.mockResolvedValue(mockBoleto);
      mockPrisma.boleto.update.mockResolvedValue({
        ...mockBoleto,
        status: BoletoStatus.CANCELLED,
        cancelledAt: new Date(),
      });

      const result = await service.cancel(companyId, 'boleto-1');

      expect(result.status).toBe(BoletoStatus.CANCELLED);
    });

    it('should throw when boleto is already paid', async () => {
      mockPrisma.boleto.findFirst.mockResolvedValue({
        ...mockBoleto,
        status: BoletoStatus.PAID,
      });

      await expect(service.cancel(companyId, 'boleto-1')).rejects.toThrow(BusinessException);
    });

    it('should throw when boleto is already cancelled', async () => {
      mockPrisma.boleto.findFirst.mockResolvedValue({
        ...mockBoleto,
        status: BoletoStatus.CANCELLED,
      });

      await expect(service.cancel(companyId, 'boleto-1')).rejects.toThrow(BusinessException);
    });
  });
});
