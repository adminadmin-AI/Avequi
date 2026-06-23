import { Test, TestingModule } from '@nestjs/testing';
import { PixService } from './pix.service';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

const mockPrisma = {
  bankAccount: {
    findFirst: jest.fn(),
  },
  receivable: {
    findFirst: jest.fn(),
  },
  pixCharge: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

const mockBankAccount = {
  id: 'ba-1',
  companyId: 'co-1',
  name: 'Bradesco Matriz',
  bankCode: '237',
  company: { name: 'GDR Reboques' },
};

const mockPixCharge = {
  id: 'pc-1',
  companyId: 'co-1',
  bankAccountId: 'ba-1',
  txId: 'TX123',
  amount: 500,
  pixKey: 'gdr@empresa.com.br',
  qrCode: '000201...',
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('PixService', () => {
  let service: PixService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PixService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PixService>(PixService);
    jest.clearAllMocks();
  });

  // ─── generateQrCodePayload ────────────────────────────────────────────────

  describe('generateQrCodePayload', () => {
    it('should return a non-empty EMV string with CRC16 appended', () => {
      const payload = service.generateQrCodePayload(
        'contato@empresa.com',
        'GDR REBOQUES',
        'CAXIAS DO SUL',
        'TXID001',
        150.0,
      );
      expect(payload).toBeTruthy();
      expect(typeof payload).toBe('string');
    });

    it('should include Tag 00 (Payload Format Indicator = "01")', () => {
      const payload = service.generateQrCodePayload(
        'key@test.com',
        'MERCHANT',
        'CITY',
        'TX001',
        100,
      );
      expect(payload).toContain('000201');
    });

    it('should include Tag 26 with br.gov.bcb.pix', () => {
      const payload = service.generateQrCodePayload(
        'key@test.com',
        'MERCHANT',
        'CITY',
        'TX001',
        100,
      );
      expect(payload).toContain('br.gov.bcb.pix');
    });

    it('should include Tag 53 currency 986 (BRL)', () => {
      const payload = service.generateQrCodePayload(
        'key@test.com',
        'MERCHANT',
        'CITY',
        'TX001',
        100,
      );
      expect(payload).toContain('5303986');
    });

    it('should include Tag 58 country code BR', () => {
      const payload = service.generateQrCodePayload(
        'key@test.com',
        'MERCHANT',
        'CITY',
        'TX001',
        100,
      );
      expect(payload).toContain('5802BR');
    });

    it('should include Tag 54 with formatted amount', () => {
      const payload = service.generateQrCodePayload(
        'key@test.com',
        'MERCHANT',
        'CITY',
        'TX001',
        150.5,
      );
      expect(payload).toContain('150.50');
    });

    it('should include txId in Tag 62 subtag 05', () => {
      const txId = 'MYTXID123';
      const payload = service.generateQrCodePayload(
        'key@test.com',
        'MERCHANT',
        'CITY',
        txId,
        100,
      );
      expect(payload).toContain(txId);
    });

    it('should end with 4-char uppercase hex CRC (Tag 63)', () => {
      const payload = service.generateQrCodePayload(
        'key@test.com',
        'MERCHANT',
        'CITY',
        'TX001',
        100,
      );
      // Last 4 chars should be the CRC hex
      const crcPart = payload.slice(-4);
      expect(crcPart).toMatch(/^[0-9A-F]{4}$/);
    });

    it('should not include Tag 54 when amount is 0', () => {
      const payload = service.generateQrCodePayload(
        'key@test.com',
        'MERCHANT',
        'CITY',
        'TX001',
        0,
      );
      // Tag 54 should be absent
      expect(payload).not.toContain('5406');
      expect(payload).not.toContain('5407');
    });
  });

  // ─── generateStaticQrCode ─────────────────────────────────────────────────

  describe('generateStaticQrCode', () => {
    it('should create a PixCharge and return txId and qrCode', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(mockBankAccount);
      mockPrisma.pixCharge.create.mockResolvedValue(mockPixCharge);

      const result = await service.generateStaticQrCode('co-1', {
        bankAccountId: 'ba-1',
        amount: 500,
        pixKey: 'gdr@empresa.com.br',
      });

      expect(result.txId).toBeDefined();
      expect(result.qrCode).toBeDefined();
      expect(result.pixCharge).toEqual(mockPixCharge);
    });

    it('should throw BusinessException if bank account not found', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(null);

      await expect(
        service.generateStaticQrCode('co-1', {
          bankAccountId: 'invalid',
          amount: 100,
          pixKey: 'key@test.com',
        }),
      ).rejects.toThrow(BusinessException);
    });

    it('should throw BusinessException if receivable not found', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(mockBankAccount);
      mockPrisma.receivable.findFirst.mockResolvedValue(null);

      await expect(
        service.generateStaticQrCode('co-1', {
          bankAccountId: 'ba-1',
          amount: 100,
          pixKey: 'key@test.com',
          receivableId: 'bad-id',
        }),
      ).rejects.toThrow(BusinessException);
    });
  });

  // ─── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return paginated results', async () => {
      mockPrisma.pixCharge.findMany.mockResolvedValue([mockPixCharge]);
      mockPrisma.pixCharge.count.mockResolvedValue(1);

      const result = await service.findAll('co-1', { page: 1, limit: 10 });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  // ─── findOne ──────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return the charge when found', async () => {
      mockPrisma.pixCharge.findFirst.mockResolvedValue(mockPixCharge);
      const result = await service.findOne('co-1', 'pc-1');
      expect(result).toEqual(mockPixCharge);
    });

    it('should throw BusinessException when charge not found', async () => {
      mockPrisma.pixCharge.findFirst.mockResolvedValue(null);
      await expect(service.findOne('co-1', 'bad-id')).rejects.toThrow(BusinessException);
    });
  });

  // ─── cancelCharge ────────────────────────────────────────────────────────

  describe('cancelCharge', () => {
    it('should cancel an ACTIVE charge', async () => {
      mockPrisma.pixCharge.findFirst.mockResolvedValue(mockPixCharge);
      mockPrisma.pixCharge.update.mockResolvedValue({ ...mockPixCharge, status: 'CANCELLED' });

      const result = await service.cancelCharge('co-1', 'pc-1');
      expect(result.status).toBe('CANCELLED');
    });

    it('should throw BusinessException when charge is already PAID', async () => {
      mockPrisma.pixCharge.findFirst.mockResolvedValue({ ...mockPixCharge, status: 'PAID' });

      await expect(service.cancelCharge('co-1', 'pc-1')).rejects.toThrow(BusinessException);
    });

    it('should throw BusinessException when charge is already CANCELLED', async () => {
      mockPrisma.pixCharge.findFirst.mockResolvedValue({ ...mockPixCharge, status: 'CANCELLED' });

      await expect(service.cancelCharge('co-1', 'pc-1')).rejects.toThrow(BusinessException);
    });
  });

  // ─── markAsPaid ──────────────────────────────────────────────────────────

  describe('markAsPaid', () => {
    it('should mark a charge as paid', async () => {
      mockPrisma.pixCharge.findFirst.mockResolvedValue(mockPixCharge);
      mockPrisma.pixCharge.update.mockResolvedValue({
        ...mockPixCharge,
        status: 'PAID',
        paidAmount: 500,
        e2eId: 'E2E123',
      });

      const result = await service.markAsPaid('co-1', 'TX123', 500, 'E2E123');
      expect(result.status).toBe('PAID');
    });

    it('should be idempotent — return existing charge if already PAID', async () => {
      const paidCharge = { ...mockPixCharge, status: 'PAID' };
      mockPrisma.pixCharge.findFirst.mockResolvedValue(paidCharge);

      const result = await service.markAsPaid('co-1', 'TX123', 500, 'E2E123');
      expect(result.status).toBe('PAID');
      expect(mockPrisma.pixCharge.update).not.toHaveBeenCalled();
    });

    it('should throw BusinessException for unknown txId', async () => {
      mockPrisma.pixCharge.findFirst.mockResolvedValue(null);

      await expect(
        service.markAsPaid('co-1', 'UNKNOWN', 100, 'e2e'),
      ).rejects.toThrow(BusinessException);
    });
  });
});
