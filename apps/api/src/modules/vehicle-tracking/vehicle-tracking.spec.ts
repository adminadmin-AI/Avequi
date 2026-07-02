import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BinRegistrationService } from './bin-registration.service';
import { AtpveService } from './atpve.service';
import { PrismaService } from '../../prisma/prisma.service';

const BinStatus = {
  PENDING: 'PENDING' as any,
  SUBMITTED: 'SUBMITTED' as any,
  REGISTERED: 'REGISTERED' as any,
  REJECTED: 'REJECTED' as any,
};

const baseSn = {
  id: 'sn-1',
  companyId: 'co-1',
  serial: 'GDR-001',
  chassi: '92UPRTB75TS001163',
  pesoLiquido: '0.570',
  pesoBruto: '0.750',
};

describe('VehicleTracking', () => {
  let binService: BinRegistrationService;
  let atpveService: AtpveService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      serialNumber: { findFirst: jest.fn(), findMany: jest.fn() },
      salesOrder: { findFirst: jest.fn() },
      binRegistration: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      atpveRecord: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        BinRegistrationService,
        AtpveService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    binService = module.get(BinRegistrationService);
    atpveService = module.get(AtpveService);
  });

  describe('BinRegistrationService (#362)', () => {
    it('cria registro BIN para chassi com pesos válidos', async () => {
      prisma.serialNumber.findFirst.mockResolvedValue(baseSn);
      prisma.binRegistration.create.mockResolvedValue({ id: 'bin-1', status: 'PENDING' });

      const result = await binService.create('co-1', { serialNumberId: 'sn-1' });

      expect(result.status).toBe('PENDING');
      expect(prisma.binRegistration.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ companyId: 'co-1', serialNumberId: 'sn-1' }),
        }),
      );
    });

    it('rejeita SerialNumber sem chassi', async () => {
      prisma.serialNumber.findFirst.mockResolvedValue({ ...baseSn, chassi: null });
      await expect(binService.create('co-1', { serialNumberId: 'sn-1' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejeita pesos zerados — BIN exige peso real (#372)', async () => {
      prisma.serialNumber.findFirst.mockResolvedValue({ ...baseSn, pesoLiquido: '0.000', pesoBruto: '0.000' });
      await expect(binService.create('co-1', { serialNumberId: 'sn-1' })).rejects.toThrow(
        /pesoLiquido e pesoBruto/,
      );
    });

    it('exige rejectionReason quando status=REJECTED', async () => {
      prisma.binRegistration.findFirst.mockResolvedValue({ id: 'bin-1', status: 'SUBMITTED' });
      await expect(
        binService.update('bin-1', 'co-1', { status: BinStatus.REJECTED }),
      ).rejects.toThrow(/rejectionReason/);
    });

    it('seta registeredAt na transição para REGISTERED', async () => {
      prisma.binRegistration.findFirst.mockResolvedValue({ id: 'bin-1', status: 'SUBMITTED', submittedAt: new Date(), registeredAt: null });
      prisma.binRegistration.update.mockResolvedValue({});

      await binService.update('bin-1', 'co-1', { status: BinStatus.REGISTERED, binNumber: 'BIN123' });

      expect(prisma.binRegistration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REGISTERED', binNumber: 'BIN123', registeredAt: expect.any(Date) }),
        }),
      );
    });

    it('isRegistered retorna true apenas para status REGISTERED', async () => {
      prisma.binRegistration.findUnique.mockResolvedValue({ status: 'REGISTERED' });
      expect(await binService.isRegistered('sn-1')).toBe(true);

      prisma.binRegistration.findUnique.mockResolvedValue({ status: 'SUBMITTED' });
      expect(await binService.isRegistered('sn-1')).toBe(false);

      prisma.binRegistration.findUnique.mockResolvedValue(null);
      expect(await binService.isRegistered('sn-1')).toBe(false);
    });
  });

  describe('AtpveService (#363)', () => {
    const dto = {
      serialNumberId: 'sn-1',
      salesOrderId: 'so-1',
      clienteCpf: '12345678909',
      clienteNome: 'João da Silva',
    };

    it('bloqueia ATPV-e sem BIN REGISTERED (pré-requisito do fluxo RENAVE)', async () => {
      prisma.serialNumber.findFirst.mockResolvedValue({
        ...baseSn,
        binRegistration: { status: 'SUBMITTED' },
      });
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1' });

      await expect(atpveService.create('co-1', dto)).rejects.toThrow(/BIN REGISTERED/);
    });

    it('cria ATPV-e quando BIN está REGISTERED e não há ativo para o chassi', async () => {
      prisma.serialNumber.findFirst.mockResolvedValue({
        ...baseSn,
        binRegistration: { status: 'REGISTERED' },
      });
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1' });
      prisma.atpveRecord.findFirst.mockResolvedValue(null);
      prisma.atpveRecord.create.mockResolvedValue({ id: 'atpve-1', status: 'PENDING' });

      const result = await atpveService.create('co-1', dto);

      expect(result.id).toBe('atpve-1');
      expect(prisma.atpveRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ clienteCpf: '12345678909', salesOrderId: 'so-1' }),
        }),
      );
    });

    it('bloqueia segundo ATPV-e ativo para o mesmo chassi', async () => {
      prisma.serialNumber.findFirst.mockResolvedValue({
        ...baseSn,
        binRegistration: { status: 'REGISTERED' },
      });
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1' });
      prisma.atpveRecord.findFirst.mockResolvedValue({ id: 'atpve-1', status: 'ISSUED' });

      await expect(atpveService.create('co-1', dto)).rejects.toThrow(/ATPV-e ativo/);
    });

    it('seta issuedAt na transição para ISSUED', async () => {
      prisma.atpveRecord.findFirst.mockResolvedValue({ id: 'atpve-1', status: 'PENDING', issuedAt: null });
      prisma.atpveRecord.update.mockResolvedValue({});

      await atpveService.update('atpve-1', 'co-1', { status: 'ISSUED' as any, atpveNumber: 'ATPV-9' });

      expect(prisma.atpveRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ISSUED', atpveNumber: 'ATPV-9', issuedAt: expect.any(Date) }),
        }),
      );
    });

    it('lança NotFoundException para ATPV-e inexistente', async () => {
      prisma.atpveRecord.findFirst.mockResolvedValue(null);
      await expect(atpveService.findOne('x', 'co-1')).rejects.toThrow(NotFoundException);
    });
  });
});
