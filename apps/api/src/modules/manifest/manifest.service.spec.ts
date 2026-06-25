import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ManifestService, MANIFEST_CONFIRMED_EVENT } from './manifest.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FiscalClientService } from '../fiscal/fiscal-client.service';

describe('ManifestService', () => {
  let service: ManifestService;
  let prisma: any;
  let fiscalClient: any;
  let eventEmitter: any;

  const mockCompany = {
    id: 'comp-1',
    cnpj: '12.345.678/0001-90',
    name: 'GDR Reboques',
  };

  const mockManifest = {
    id: 'manifest-1',
    companyId: 'comp-1',
    chaveNfe: '35260612345678000190550010000000011000000011',
    nfeNumber: '1',
    series: '1',
    supplierCnpj: '98765432000199',
    supplierName: 'Fornecedor Teste',
    issueDate: new Date('2026-06-01'),
    totalValue: 1500.0,
    status: 'PENDING',
    lastEventType: null,
    lastEventDate: null,
    justification: null,
    protocol: null,
    inboundNfeId: null,
    manifestedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      company: { findUnique: jest.fn() },
      nfeManifest: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };

    fiscalClient = {
      fetchReceivedNfes: jest.fn(),
      manifestNfe: jest.fn(),
    };

    eventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ManifestService,
        { provide: PrismaService, useValue: prisma },
        { provide: FiscalClientService, useValue: fiscalClient },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<ManifestService>(ManifestService);
  });

  describe('syncReceivedNfes', () => {
    it('should sync new NF-e from Focus NFe', async () => {
      prisma.company.findUnique.mockResolvedValue(mockCompany);
      fiscalClient.fetchReceivedNfes.mockResolvedValue([
        {
          chave: '35260612345678000190550010000000011000000011',
          numero: '1',
          serie: '1',
          cnpj_emitente: '98765432000199',
          nome_emitente: 'Fornecedor Teste',
          data_emissao: '2026-06-01',
          valor_total: 1500.0,
        },
      ]);
      prisma.nfeManifest.findUnique.mockResolvedValue(null); // not existing
      prisma.nfeManifest.create.mockResolvedValue(mockManifest);

      const result = await service.syncReceivedNfes('comp-1');

      expect(result.synced).toBe(1);
      expect(result.total).toBe(1);
      expect(prisma.nfeManifest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: 'comp-1',
            chaveNfe: '35260612345678000190550010000000011000000011',
            status: 'PENDING',
          }),
        }),
      );
    });

    it('should skip already synced NF-e', async () => {
      prisma.company.findUnique.mockResolvedValue(mockCompany);
      fiscalClient.fetchReceivedNfes.mockResolvedValue([
        { chave: '35260612345678000190550010000000011000000011' },
      ]);
      prisma.nfeManifest.findUnique.mockResolvedValue(mockManifest); // already exists

      const result = await service.syncReceivedNfes('comp-1');

      expect(result.synced).toBe(0);
      expect(prisma.nfeManifest.create).not.toHaveBeenCalled();
    });
  });

  describe('registerCiencia', () => {
    it('should register ciência for PENDING manifest', async () => {
      prisma.nfeManifest.findUnique.mockResolvedValue(mockManifest);
      fiscalClient.manifestNfe.mockResolvedValue({ status: 'autorizado', protocolo: 'PROT123' });
      prisma.nfeManifest.update.mockResolvedValue({ ...mockManifest, status: 'CIENCIA' });

      await service.registerCiencia(mockManifest.chaveNfe, 'comp-1', 'user-1');

      expect(fiscalClient.manifestNfe).toHaveBeenCalledWith(mockManifest.chaveNfe, 210210);
      expect(prisma.nfeManifest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CIENCIA',
            lastEventType: 'CIENCIA',
            protocol: 'PROT123',
          }),
        }),
      );
    });

    it('should reject ciência for non-PENDING manifest', async () => {
      prisma.nfeManifest.findUnique.mockResolvedValue({ ...mockManifest, status: 'CONFIRMED' });

      await expect(
        service.registerCiencia(mockManifest.chaveNfe, 'comp-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('confirmOperation', () => {
    it('should confirm operation and emit event', async () => {
      prisma.nfeManifest.findUnique.mockResolvedValue({ ...mockManifest, status: 'CIENCIA' });
      fiscalClient.manifestNfe.mockResolvedValue({ status: 'autorizado', protocolo: 'PROT456' });
      prisma.nfeManifest.update.mockResolvedValue({ ...mockManifest, status: 'CONFIRMED' });

      await service.confirmOperation(mockManifest.chaveNfe, 'comp-1', 'user-1');

      expect(fiscalClient.manifestNfe).toHaveBeenCalledWith(mockManifest.chaveNfe, 210200);
      expect(prisma.nfeManifest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CONFIRMED',
            lastEventType: 'CONFIRMACAO',
          }),
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        MANIFEST_CONFIRMED_EVENT,
        expect.objectContaining({
          companyId: 'comp-1',
          chaveNfe: mockManifest.chaveNfe,
        }),
      );
    });

    it('should allow confirming from PENDING directly', async () => {
      prisma.nfeManifest.findUnique.mockResolvedValue(mockManifest); // PENDING
      fiscalClient.manifestNfe.mockResolvedValue({ status: 'autorizado' });
      prisma.nfeManifest.update.mockResolvedValue({ ...mockManifest, status: 'CONFIRMED' });

      await service.confirmOperation(mockManifest.chaveNfe, 'comp-1', 'user-1');

      expect(prisma.nfeManifest.update).toHaveBeenCalled();
    });
  });

  describe('rejectOperation', () => {
    it('should reject operation with justification', async () => {
      prisma.nfeManifest.findUnique.mockResolvedValue(mockManifest);
      fiscalClient.manifestNfe.mockResolvedValue({ status: 'autorizado', protocolo: 'PROT789' });
      prisma.nfeManifest.update.mockResolvedValue({ ...mockManifest, status: 'NOT_PERFORMED' });

      await service.rejectOperation(
        mockManifest.chaveNfe,
        'comp-1',
        'user-1',
        'Mercadoria não foi recebida pela empresa',
      );

      expect(fiscalClient.manifestNfe).toHaveBeenCalledWith(
        mockManifest.chaveNfe,
        210220,
        'Mercadoria não foi recebida pela empresa',
      );
      expect(prisma.nfeManifest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'NOT_PERFORMED',
            justification: 'Mercadoria não foi recebida pela empresa',
          }),
        }),
      );
    });
  });

  describe('unknownOperation', () => {
    it('should register desconhecimento', async () => {
      prisma.nfeManifest.findUnique.mockResolvedValue(mockManifest);
      fiscalClient.manifestNfe.mockResolvedValue({ status: 'autorizado' });
      prisma.nfeManifest.update.mockResolvedValue({ ...mockManifest, status: 'UNKNOWN' });

      await service.unknownOperation(
        mockManifest.chaveNfe,
        'comp-1',
        'user-1',
        'Não conheço este fornecedor nem operação',
      );

      expect(fiscalClient.manifestNfe).toHaveBeenCalledWith(
        mockManifest.chaveNfe,
        210240,
        'Não conheço este fornecedor nem operação',
      );
    });

    it('should not allow desconhecimento on confirmed NF-e', async () => {
      prisma.nfeManifest.findUnique.mockResolvedValue({ ...mockManifest, status: 'CONFIRMED' });

      await expect(
        service.unknownOperation(mockManifest.chaveNfe, 'comp-1', 'user-1', 'justificativa teste longa suficiente'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findPending', () => {
    it('should return pending manifests', async () => {
      prisma.nfeManifest.findMany.mockResolvedValue([mockManifest]);

      const result = await service.findPending('comp-1');

      expect(result).toHaveLength(1);
      expect(prisma.nfeManifest.findMany).toHaveBeenCalledWith({
        where: { companyId: 'comp-1', status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOverdue', () => {
    it('should return manifests older than 30 days', async () => {
      const oldManifest = {
        ...mockManifest,
        createdAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
      };
      prisma.nfeManifest.findMany.mockResolvedValue([oldManifest]);

      const result = await service.findOverdue('comp-1');

      expect(result).toHaveLength(1);
      expect(prisma.nfeManifest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: 'comp-1',
            status: 'PENDING',
            createdAt: expect.objectContaining({ lt: expect.any(Date) }),
          }),
        }),
      );
    });
  });

  describe('getStats', () => {
    it('should return aggregated stats', async () => {
      prisma.nfeManifest.count
        .mockResolvedValueOnce(5)  // pending
        .mockResolvedValueOnce(3)  // ciencia
        .mockResolvedValueOnce(10) // confirmed
        .mockResolvedValueOnce(1)  // notPerformed
        .mockResolvedValueOnce(0)  // unknown
        .mockResolvedValueOnce(2); // overdue

      const stats = await service.getStats('comp-1');

      expect(stats).toEqual({
        pending: 5,
        ciencia: 3,
        confirmed: 10,
        notPerformed: 1,
        unknown: 0,
        overdue: 2,
      });
    });
  });
});
