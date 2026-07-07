import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PaymentMethod, PaymentModality } from '@prisma/client';
import { AcquirerService } from './acquirer.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  acquirer: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  acquirerFee: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  auditLog: { create: jest.fn() },
};

const user = { id: 'user-1', companyId: 'co-1' };

function fee(overrides: Record<string, any> = {}) {
  return {
    id: 'fee-1',
    acquirerId: 'acq-1',
    brand: null,
    modality: PaymentModality.CREDITO_PARCELADO,
    installmentsFrom: 1,
    installmentsTo: 12,
    mdrRate: 3.49,
    settlementDays: 30,
    validFrom: null,
    validTo: null,
    isActive: true,
    ...overrides,
  };
}

describe('AcquirerService (#585)', () => {
  let service: AcquirerService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [AcquirerService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(AcquirerService);
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  describe('modalityFor (#584)', () => {
    it('débito → DEBITO', () => {
      expect(AcquirerService.modalityFor(PaymentMethod.CARTAO_DEBITO, 1)).toBe(PaymentModality.DEBITO);
    });
    it('crédito 1x → CREDITO_AVISTA', () => {
      expect(AcquirerService.modalityFor(PaymentMethod.CARTAO_CREDITO, 1)).toBe(PaymentModality.CREDITO_AVISTA);
    });
    it('crédito 6x → CREDITO_PARCELADO (idem CARTAO legado)', () => {
      expect(AcquirerService.modalityFor(PaymentMethod.CARTAO_CREDITO, 6)).toBe(PaymentModality.CREDITO_PARCELADO);
      expect(AcquirerService.modalityFor(PaymentMethod.CARTAO, 6)).toBe(PaymentModality.CREDITO_PARCELADO);
    });
    it('formas sem adquirente → null', () => {
      expect(AcquirerService.modalityFor(PaymentMethod.PIX, 1)).toBeNull();
      expect(AcquirerService.modalityFor(PaymentMethod.BOLETO, 3)).toBeNull();
    });
  });

  describe('create', () => {
    it('cria com companyId do JWT e audita', async () => {
      mockPrisma.acquirer.findUnique.mockResolvedValue(null);
      mockPrisma.acquirer.create.mockResolvedValue({ id: 'acq-1', name: 'Cielo' });

      await service.create({ name: 'Cielo', cnpj: '01027058000191' }, user);

      expect(mockPrisma.acquirer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: 'Cielo', companyId: 'co-1' }),
      });
      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
    });

    it('rejeita nome duplicado na empresa', async () => {
      mockPrisma.acquirer.findUnique.mockResolvedValue({ id: 'acq-x' });
      await expect(service.create({ name: 'Cielo' }, user)).rejects.toThrow(ConflictException);
    });
  });

  describe('addFee', () => {
    beforeEach(() => {
      mockPrisma.acquirer.findFirst.mockResolvedValue({ id: 'acq-1', companyId: 'co-1', fees: [] });
      mockPrisma.acquirerFee.create.mockResolvedValue(fee());
    });

    it('normaliza bandeira p/ maiúsculas e defaults de faixa', async () => {
      await service.addFee(
        'acq-1',
        { brand: 'visa', modality: PaymentModality.DEBITO, mdrRate: 1.99, settlementDays: 1 },
        user,
      );
      expect(mockPrisma.acquirerFee.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ brand: 'VISA', installmentsFrom: 1, installmentsTo: 1 }),
      });
    });

    it('rejeita faixa invertida (to < from)', async () => {
      await expect(
        service.addFee(
          'acq-1',
          {
            modality: PaymentModality.CREDITO_PARCELADO,
            installmentsFrom: 6,
            installmentsTo: 2,
            mdrRate: 3.49,
            settlementDays: 30,
          },
          user,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita vigência invertida (validTo < validFrom)', async () => {
      await expect(
        service.addFee(
          'acq-1',
          {
            modality: PaymentModality.DEBITO,
            mdrRate: 1.99,
            settlementDays: 1,
            validFrom: '2026-08-01',
            validTo: '2026-07-01',
          },
          user,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('adquirente de outro tenant → NotFound', async () => {
      mockPrisma.acquirer.findFirst.mockResolvedValue(null);
      await expect(
        service.addFee('acq-alheio', { modality: PaymentModality.DEBITO, mdrRate: 1, settlementDays: 1 }, user),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('resolveFee', () => {
    it('bandeira exata vence regra genérica', async () => {
      mockPrisma.acquirerFee.findMany.mockResolvedValue([
        fee({ id: 'generica', brand: null, mdrRate: 3.99 }),
        fee({ id: 'visa', brand: 'VISA', mdrRate: 2.99 }),
      ]);

      const r = await service.resolveFee('co-1', {
        acquirerId: 'acq-1',
        brand: 'visa',
        modality: PaymentModality.CREDITO_PARCELADO,
        installments: 6,
      });

      expect(r).toEqual({ feeId: 'visa', mdrRate: 2.99, settlementDays: 30 });
    });

    it('empate de bandeira → vigência mais recente vence', async () => {
      mockPrisma.acquirerFee.findMany.mockResolvedValue([
        fee({ id: 'antiga', validFrom: new Date('2025-01-01'), mdrRate: 4.5 }),
        fee({ id: 'nova', validFrom: new Date('2026-06-01'), mdrRate: 3.2 }),
      ]);

      const r = await service.resolveFee('co-1', {
        acquirerId: 'acq-1',
        modality: PaymentModality.CREDITO_PARCELADO,
        installments: 3,
      });

      expect(r?.feeId).toBe('nova');
    });

    it('sem taxa cadastrada → null', async () => {
      mockPrisma.acquirerFee.findMany.mockResolvedValue([]);
      const r = await service.resolveFee('co-1', {
        acquirerId: 'acq-1',
        modality: PaymentModality.DEBITO,
        installments: 1,
      });
      expect(r).toBeNull();
    });

    it('filtra por faixa de parcelas e vigência na query', async () => {
      mockPrisma.acquirerFee.findMany.mockResolvedValue([]);
      const date = new Date('2026-07-07');
      await service.resolveFee('co-1', {
        acquirerId: 'acq-1',
        modality: PaymentModality.CREDITO_PARCELADO,
        installments: 6,
        date,
      });

      expect(mockPrisma.acquirerFee.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          acquirerId: 'acq-1',
          acquirer: { companyId: 'co-1', isActive: true },
          installmentsFrom: { lte: 6 },
          installmentsTo: { gte: 6 },
        }),
      });
    });
  });
});
