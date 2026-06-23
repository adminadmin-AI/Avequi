import { Test, TestingModule } from '@nestjs/testing';
import { CnabService } from './cnab/cnab.service';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';
import { BoletoStatus, CnabRetornoStatus } from '../../generated/prisma';

const companyId = 'company-1';
const bankAccountId = 'account-1';

const mockBankAccount = {
  id: bankAccountId,
  companyId,
  name: 'Conta Corrente Inter',
  bankCode: '077',
  agency: '0001',
  accountNumber: '12345-6',
  type: 'CHECKING',
  initialBalance: 0,
  isActive: true,
  legacyId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockBoleto = {
  id: 'boleto-1',
  companyId,
  bankAccountId,
  nossoNumero: '00000000000001',
  seuNumero: 'REF001',
  amount: 1500.0,
  dueDate: new Date('2026-07-31'),
  status: BoletoStatus.PENDING,
  payerName: 'João Silva',
  payerDocument: '12345678901',
  payerAddress: 'Rua A, 100',
  payerCity: 'São Paulo',
  payerState: 'SP',
  payerZipCode: '01310100',
  instructions: 'Não receber após o vencimento',
  registeredAt: null,
  paidAt: null,
  paidAmount: null,
  cancelledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  bankAccount: mockBankAccount,
};

const mockPrisma = {
  bankAccount: { findFirst: jest.fn() },
  boleto: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  company: { findUnique: jest.fn() },
  cnabRemessa: {
    findFirst: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
  },
  cnabRetorno: {
    create: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  cnabRetornoItem: { createMany: jest.fn() },
};

describe('CnabService', () => {
  let service: CnabService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CnabService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CnabService>(CnabService);
    jest.clearAllMocks();
  });

  describe('generateRemessa', () => {
    it('should generate a remessa for Inter bank', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(mockBankAccount);
      mockPrisma.boleto.findMany.mockResolvedValue([mockBoleto]);
      mockPrisma.company.findUnique.mockResolvedValue({
        cnpj: '12.345.678/0001-00',
        name: 'GDR REBOQUES LTDA',
      });
      mockPrisma.cnabRemessa.findFirst.mockResolvedValue(null);
      mockPrisma.cnabRemessa.create.mockResolvedValue({
        id: 'remessa-1',
        companyId,
        bankAccountId,
        fileName: '077_company1_000001.rem',
        sequenceNumber: 1,
        totalBoletos: 1,
        totalAmount: 1500,
        status: 'GENERATED',
        fileContent: 'FILE_CONTENT',
        items: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.generateRemessa(companyId, bankAccountId, ['boleto-1']);

      expect(result.remessa.sequenceNumber).toBe(1);
      expect(result.fileContent).toBeTruthy();
      expect(result.fileContent.split('\n').length).toBeGreaterThan(0);
    });

    it('should use next sequence number', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(mockBankAccount);
      mockPrisma.boleto.findMany.mockResolvedValue([mockBoleto]);
      mockPrisma.company.findUnique.mockResolvedValue({ cnpj: '12345678000100', name: 'GDR' });
      mockPrisma.cnabRemessa.findFirst.mockResolvedValue({ sequenceNumber: 5 });
      mockPrisma.cnabRemessa.create.mockResolvedValue({
        id: 'remessa-2',
        sequenceNumber: 6,
        totalBoletos: 1,
        totalAmount: 1500,
        status: 'GENERATED',
        fileContent: 'X',
        items: [],
      });

      const result = await service.generateRemessa(companyId, bankAccountId, ['boleto-1']);

      expect(mockPrisma.cnabRemessa.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sequenceNumber: 6 }),
        }),
      );
    });

    it('should throw when bank account not found', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(null);

      await expect(
        service.generateRemessa(companyId, bankAccountId, ['boleto-1']),
      ).rejects.toThrow(BusinessException);
    });

    it('should throw when bank has no bankCode', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue({ ...mockBankAccount, bankCode: null });

      await expect(
        service.generateRemessa(companyId, bankAccountId, ['boleto-1']),
      ).rejects.toThrow(BusinessException);
    });

    it('should throw when no valid boletos found', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(mockBankAccount);
      mockPrisma.boleto.findMany.mockResolvedValue([]);

      await expect(
        service.generateRemessa(companyId, bankAccountId, ['bad-id']),
      ).rejects.toThrow(BusinessException);
    });

    it('should throw for unsupported bank code', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue({
        ...mockBankAccount,
        bankCode: '999', // inexistent bank — not implemented
      });
      mockPrisma.boleto.findMany.mockResolvedValue([mockBoleto]);
      mockPrisma.company.findUnique.mockResolvedValue({ cnpj: '12345678000100', name: 'GDR' });
      mockPrisma.cnabRemessa.findFirst.mockResolvedValue(null);

      await expect(
        service.generateRemessa(companyId, bankAccountId, ['boleto-1']),
      ).rejects.toThrow(BusinessException);
    });
  });

  describe('processRetorno', () => {
    const retornoId = 'retorno-1';

    const mockRetorno = {
      id: retornoId,
      companyId,
      bankAccountId,
      fileName: 'RET001.ret',
      status: CnabRetornoStatus.PROCESSING,
      matchedCount: 0,
      unmatchedCount: 0,
      totalAmount: null,
      items: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should throw when bank account not found', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(null);

      await expect(
        service.processRetorno(companyId, bankAccountId, 'test.ret', ''),
      ).rejects.toThrow(BusinessException);
    });

    it('should throw when bank has no bankCode', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue({ ...mockBankAccount, bankCode: null });

      await expect(
        service.processRetorno(companyId, bankAccountId, 'test.ret', ''),
      ).rejects.toThrow(BusinessException);
    });

    it('should create retorno record and process items', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(mockBankAccount);
      mockPrisma.cnabRetorno.create.mockResolvedValue(mockRetorno);
      mockPrisma.cnabRetorno.update.mockResolvedValue({
        ...mockRetorno,
        status: CnabRetornoStatus.PROCESSED,
        processedAt: new Date(),
        matchedCount: 0,
        unmatchedCount: 0,
        items: [],
        bankAccount: mockBankAccount,
      });
      mockPrisma.cnabRetornoItem.createMany.mockResolvedValue({ count: 0 });

      // Empty file content — no valid lines
      const result = await service.processRetorno(
        companyId,
        bankAccountId,
        'RET001.ret',
        '',
      );

      expect(result.status).toBe(CnabRetornoStatus.PROCESSED);
      expect(mockPrisma.cnabRetorno.create).toHaveBeenCalled();
    });
  });

  describe('findAllRemessas', () => {
    it('should return all remessas for company', async () => {
      mockPrisma.cnabRemessa.findMany.mockResolvedValue([]);

      const result = await service.findAllRemessas(companyId);

      expect(result).toEqual([]);
      expect(mockPrisma.cnabRemessa.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId } }),
      );
    });
  });

  describe('findOneRetorno', () => {
    it('should throw when retorno not found', async () => {
      mockPrisma.cnabRetorno.findFirst.mockResolvedValue(null);

      await expect(
        service.findOneRetorno(companyId, 'bad-id'),
      ).rejects.toThrow(BusinessException);
    });
  });
});
