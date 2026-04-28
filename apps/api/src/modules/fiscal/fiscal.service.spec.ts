import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FiscalDocumentType, FiscalStatus } from '@prisma/client';
import { FiscalService } from './fiscal.service';
import { FiscalClientService } from './fiscal-client.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  fiscalDocument: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  salesOrder: {
    findUnique: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

const mockClient = {
  emitNFCe: jest.fn(),
  emitNFe: jest.fn(),
  getStatus: jest.fn(),
};

const baseOrder = {
  id: 'so-1',
  companyId: 'co-1',
  customer: null,
  company: { cnpj: '12.345.678/0001-90', name: 'GDR Indústria Ltda' },
  items: [
    {
      product: { sku: 'COD001', name: 'Produto A', ncm: '61099000', unit: 'UN' },
      quantity: '2',
      unitPrice: '150',
    },
  ],
};

const baseFiscalDoc = {
  id: 'fd-1',
  companyId: 'co-1',
  salesOrderId: 'so-1',
  type: FiscalDocumentType.NFCE,
  status: FiscalStatus.PENDING,
  focusRef: 'GDR-SO-so-1',
  retryCount: 0,
};

describe('FiscalService', () => {
  let service: FiscalService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiscalService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FiscalClientService, useValue: mockClient },
      ],
    }).compile();

    service = module.get<FiscalService>(FiscalService);
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  // ─── S08.06: fluxo autorizado ────────────────────────────────────────────

  describe('emitForSale — autorizado', () => {
    it('deve criar FiscalDocument, enviar para Focus e salvar chave quando autorizado', async () => {
      mockPrisma.fiscalDocument.findUnique.mockResolvedValue(null); // sem doc anterior
      mockPrisma.salesOrder.findUnique.mockResolvedValue(baseOrder);
      mockPrisma.fiscalDocument.create.mockResolvedValue(baseFiscalDoc);
      mockClient.emitNFCe.mockResolvedValue({
        status: 'autorizado',
        chave_nfe: '35260412345678000190650010000000011234567890',
        ref: 'GDR-SO-so-1',
      });
      mockPrisma.fiscalDocument.update.mockResolvedValue({
        ...baseFiscalDoc,
        status: FiscalStatus.AUTHORIZED,
        chave: '35260412345678000190650010000000011234567890',
      });

      await service.emitForSale('so-1');

      expect(mockPrisma.fiscalDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ salesOrderId: 'so-1', type: 'NFCE' }) }),
      );
      expect(mockClient.emitNFCe).toHaveBeenCalledWith('GDR-SO-so-1', expect.any(Object));
      expect(mockPrisma.fiscalDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FiscalStatus.AUTHORIZED,
            chave: '35260412345678000190650010000000011234567890',
          }),
        }),
      );
    });
  });

  // ─── S08.06: fluxo rejeitado ─────────────────────────────────────────────

  describe('emitForSale — rejeitado', () => {
    it('deve salvar status REJECTED com código e motivo sem apagar a venda', async () => {
      mockPrisma.fiscalDocument.findUnique.mockResolvedValue(null);
      mockPrisma.salesOrder.findUnique.mockResolvedValue(baseOrder);
      mockPrisma.fiscalDocument.create.mockResolvedValue(baseFiscalDoc);
      mockClient.emitNFCe.mockResolvedValue({
        status: 'rejeitado',
        codigo: '539',
        motivo: 'Duplicidade de NF-e, com diferença na Chave de Acesso',
      });
      mockPrisma.fiscalDocument.update.mockResolvedValue({
        ...baseFiscalDoc,
        status: FiscalStatus.REJECTED,
        rejectionCode: '539',
        rejectionReason: 'Duplicidade de NF-e, com diferença na Chave de Acesso',
      });

      await service.emitForSale('so-1');

      expect(mockPrisma.fiscalDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FiscalStatus.REJECTED,
            rejectionCode: '539',
            rejectionReason: 'Duplicidade de NF-e, com diferença na Chave de Acesso',
          }),
        }),
      );
      // Não lança exceção — venda permanece intacta
    });
  });

  // ─── S08.06: indisponibilidade / erro de comunicação ─────────────────────

  describe('emitForSale — erro de comunicação', () => {
    it('deve salvar status ERROR quando Focus NFe estiver indisponível', async () => {
      mockPrisma.fiscalDocument.findUnique.mockResolvedValue(null);
      mockPrisma.salesOrder.findUnique.mockResolvedValue(baseOrder);
      mockPrisma.fiscalDocument.create.mockResolvedValue(baseFiscalDoc);
      mockClient.emitNFCe.mockResolvedValue({
        status: 'erro',
        motivo: 'Timeout ao conectar com a Focus NFe',
        codigo: '0',
      });
      mockPrisma.fiscalDocument.update.mockResolvedValue({
        ...baseFiscalDoc,
        status: FiscalStatus.ERROR,
        lastError: 'Timeout ao conectar com a Focus NFe',
      });

      await service.emitForSale('so-1');

      expect(mockPrisma.fiscalDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: FiscalStatus.ERROR }),
        }),
      );
    });
  });

  // ─── S08.06: idempotência — não re-emite se já autorizado ────────────────

  describe('emitForSale — idempotência', () => {
    it('deve ignorar emissão quando documento já está AUTHORIZED', async () => {
      mockPrisma.fiscalDocument.findUnique.mockResolvedValue({
        ...baseFiscalDoc,
        status: FiscalStatus.AUTHORIZED,
      });

      await service.emitForSale('so-1');

      expect(mockClient.emitNFCe).not.toHaveBeenCalled();
      expect(mockClient.emitNFe).not.toHaveBeenCalled();
    });

    it('deve ignorar emissão quando documento está PROCESSING', async () => {
      mockPrisma.fiscalDocument.findUnique.mockResolvedValue({
        ...baseFiscalDoc,
        status: FiscalStatus.PROCESSING,
      });

      await service.emitForSale('so-1');

      expect(mockClient.emitNFCe).not.toHaveBeenCalled();
    });
  });

  // ─── S08.04: webhook atualiza status ─────────────────────────────────────

  describe('handleWebhook', () => {
    it('deve atualizar FiscalDocument para AUTHORIZED via webhook', async () => {
      mockPrisma.fiscalDocument.findFirst.mockResolvedValue({
        ...baseFiscalDoc,
        status: FiscalStatus.PROCESSING,
      });
      mockPrisma.fiscalDocument.update.mockResolvedValue({
        ...baseFiscalDoc,
        status: FiscalStatus.AUTHORIZED,
      });

      await service.handleWebhook({
        ref: 'GDR-SO-so-1',
        status: 'autorizado',
        chave_nfe: '35260412345678000190650010000000011234567890',
      });

      expect(mockPrisma.fiscalDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: FiscalStatus.AUTHORIZED }),
        }),
      );
    });

    it('não deve sobrescrever documento já AUTHORIZED (idempotência do webhook)', async () => {
      mockPrisma.fiscalDocument.findFirst.mockResolvedValue({
        ...baseFiscalDoc,
        status: FiscalStatus.AUTHORIZED,
      });

      await service.handleWebhook({ ref: 'GDR-SO-so-1', status: 'autorizado' });

      expect(mockPrisma.fiscalDocument.update).not.toHaveBeenCalled();
    });

    it('deve ignorar webhook sem campo ref', async () => {
      await service.handleWebhook({ status: 'autorizado' });
      expect(mockPrisma.fiscalDocument.findFirst).not.toHaveBeenCalled();
    });
  });

  // ─── S08.05: retry de documentos rejeitados ───────────────────────────────

  describe('retry', () => {
    it('deve lançar NotFoundException para documento inexistente', async () => {
      mockPrisma.fiscalDocument.findFirst.mockResolvedValue(null);
      await expect(service.retry('fd-x', 'co-1')).rejects.toThrow(NotFoundException);
    });

    it('deve lançar BadRequestException para documento já autorizado', async () => {
      mockPrisma.fiscalDocument.findFirst.mockResolvedValue({
        ...baseFiscalDoc,
        status: FiscalStatus.AUTHORIZED,
      });
      await expect(service.retry('fd-1', 'co-1')).rejects.toThrow(BadRequestException);
    });

    it('deve reprocessar documento rejeitado sem erro', async () => {
      mockPrisma.fiscalDocument.findFirst.mockResolvedValue({
        ...baseFiscalDoc,
        status: FiscalStatus.REJECTED,
      });
      // emitForSale será chamado — simular documento existente para cair no branch de retry
      mockPrisma.fiscalDocument.findUnique.mockResolvedValue({
        ...baseFiscalDoc,
        status: FiscalStatus.REJECTED,
      });
      mockPrisma.salesOrder.findUnique.mockResolvedValue(baseOrder);
      mockPrisma.fiscalDocument.update.mockResolvedValue({ ...baseFiscalDoc, status: FiscalStatus.PENDING });
      mockClient.emitNFCe.mockResolvedValue({ status: 'autorizado', chave_nfe: '123' });

      await expect(service.retry('fd-1', 'co-1')).resolves.not.toThrow();
      expect(mockClient.emitNFCe).toHaveBeenCalled();
    });
  });
});
