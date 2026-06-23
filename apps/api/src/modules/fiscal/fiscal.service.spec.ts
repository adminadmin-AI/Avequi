import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FiscalDocumentType, FiscalStatus } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FiscalService } from './fiscal.service';
import { FiscalClientService } from './fiscal-client.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TaxCalculationService } from '../tax/tax-calculation.service';
import { FISCAL_CANCELLED_EVENT } from './events/fiscal-cancelled.event';

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
  fiscalCorrection: {
    create: jest.fn(),
  },
  fiscalVoidRange: {
    create: jest.fn(),
  },
  fiscalDocumentItem: {
    create: jest.fn(),
  },
  fiscalDocumentItemTax: {
    create: jest.fn(),
  },
  company: {
    findUnique: jest.fn(),
  },
};

const mockClient = {
  emitNFCe: jest.fn(),
  emitNFe: jest.fn(),
  cancelNFe: jest.fn(),
  sendCCe: jest.fn(),
  voidRange: jest.fn(),
  getStatus: jest.fn(),
};

const mockEventEmitter = {
  emit: jest.fn(),
};

const mockTaxCalc = {
  calculateTaxes: jest.fn().mockResolvedValue({
    cfop: '5101',
    icms: { cst: '00', baseCalculo: 300, aliquota: 18, valor: 54 },
    ipi: { cst: '50', baseCalculo: 300, aliquota: 5, valor: 15 },
    pis: { cst: '01', baseCalculo: 300, aliquota: 0.65, valor: 1.95 },
    cofins: { cst: '01', baseCalculo: 300, aliquota: 3, valor: 9 },
    totalTributos: 79.95,
  }),
};

const baseOrder = {
  id: 'so-1',
  companyId: 'co-1',
  customer: null,
  company: { cnpj: '12.345.678/0001-90', name: 'GDR Indústria Ltda', razaoSocial: 'GDR Ltda', ie: 'ISENTO', crt: 3, street: 'Rua A', number: '1', complement: null, neighborhood: 'Centro', city: 'Cascavel', state: 'PR', zipCode: '85807-030', ibgeCode: '4104808', phone: '4532221234' },
  items: [
    {
      product: { sku: 'COD001', name: 'Produto A', ncm: '61099000', unit: 'UN', type: 'FINISHED_GOOD' },
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
        { provide: TaxCalculationService, useValue: mockTaxCalc },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<FiscalService>(FiscalService);
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.fiscalDocumentItem.create.mockResolvedValue({ id: 'fdi-1' });
    mockPrisma.fiscalDocumentItemTax.create.mockResolvedValue({ id: 'fdit-1' });
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

  // ─── #164: Cancelamento de NF-e ──────────────────────────────────────────

  describe('cancel', () => {
    const authorizedDoc = {
      ...baseFiscalDoc,
      status: FiscalStatus.AUTHORIZED,
      createdAt: new Date(), // dentro do prazo de 24h
      salesOrderId: 'so-1',
      storeTransferId: null,
    };

    it('deve cancelar NF-e autorizada dentro do prazo de 24h', async () => {
      mockPrisma.fiscalDocument.findFirst.mockResolvedValue(authorizedDoc);
      mockClient.cancelNFe.mockResolvedValue({ status: 'cancelado' });
      mockPrisma.fiscalDocument.update.mockResolvedValue({
        ...authorizedDoc,
        status: FiscalStatus.CANCELLED,
      });

      await service.cancel('fd-1', 'co-1', 'Erro no valor do produto informado na nota');

      expect(mockClient.cancelNFe).toHaveBeenCalledWith(
        'GDR-SO-so-1',
        'Erro no valor do produto informado na nota',
      );
      expect(mockPrisma.fiscalDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FiscalStatus.CANCELLED,
            cancellationJustification: 'Erro no valor do produto informado na nota',
          }),
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        FISCAL_CANCELLED_EVENT,
        expect.objectContaining({
          companyId: 'co-1',
          fiscalDocumentId: 'fd-1',
          salesOrderId: 'so-1',
        }),
      );
    });

    it('deve rejeitar cancelamento fora do prazo de 24h (422)', async () => {
      const expiredDoc = {
        ...authorizedDoc,
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25h atrás
      };
      mockPrisma.fiscalDocument.findFirst.mockResolvedValue(expiredDoc);

      await expect(
        service.cancel('fd-1', 'co-1', 'Justificativa de cancelamento tardio'),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(mockClient.cancelNFe).not.toHaveBeenCalled();
    });

    it('deve rejeitar cancelamento de documento não autorizado (400)', async () => {
      mockPrisma.fiscalDocument.findFirst.mockResolvedValue({
        ...baseFiscalDoc,
        status: FiscalStatus.PENDING,
      });

      await expect(
        service.cancel('fd-1', 'co-1', 'Tentando cancelar doc pendente'),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar NotFoundException para documento inexistente', async () => {
      mockPrisma.fiscalDocument.findFirst.mockResolvedValue(null);

      await expect(
        service.cancel('fd-x', 'co-1', 'Documento não existe na base'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deve lançar BadRequestException quando SEFAZ rejeita o cancelamento', async () => {
      mockPrisma.fiscalDocument.findFirst.mockResolvedValue(authorizedDoc);
      mockClient.cancelNFe.mockResolvedValue({
        status: 'erro',
        motivo: 'NF-e já está cancelada na base da SEFAZ',
      });

      await expect(
        service.cancel('fd-1', 'co-1', 'Cancelamento rejeitado pela SEFAZ'),
      ).rejects.toThrow(BadRequestException);

      // Deve salvar o lastError
      expect(mockPrisma.fiscalDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastError: 'NF-e já está cancelada na base da SEFAZ',
          }),
        }),
      );
      // Não deve emitir evento de reversão
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('deve criar audit log ao cancelar com sucesso', async () => {
      mockPrisma.fiscalDocument.findFirst.mockResolvedValue(authorizedDoc);
      mockClient.cancelNFe.mockResolvedValue({ status: 'cancelado' });
      mockPrisma.fiscalDocument.update.mockResolvedValue({
        ...authorizedDoc,
        status: FiscalStatus.CANCELLED,
      });

      await service.cancel('fd-1', 'co-1', 'Cancelamento com audit log');

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: 'co-1',
          entity: 'FiscalDocument',
          action: 'CANCEL',
          payload: expect.objectContaining({ fiscalDocumentId: 'fd-1' }),
        }),
      });
    });
  });

  // ─── #165: CC-e (Carta de Correção) ────────────────────────────────────

  describe('correction', () => {
    const authorizedDoc = {
      ...baseFiscalDoc,
      status: FiscalStatus.AUTHORIZED,
      focusRef: 'GDR-SO-so-1',
      corrections: [],
    };

    it('deve emitir CC-e para documento autorizado', async () => {
      mockPrisma.fiscalDocument.findFirst.mockResolvedValue(authorizedDoc);
      mockClient.sendCCe.mockResolvedValue({ status: 'autorizado', chave_nfe: 'PROT-123' });
      mockPrisma.fiscalCorrection.create.mockResolvedValue({ id: 'corr-1', sequenceNumber: 1 });

      const result = await service.correction('fd-1', 'co-1', 'Correção do endereço de entrega do cliente');

      expect(result.sequenceNumber).toBe(1);
      expect(result.protocol).toBe('PROT-123');
      expect(mockClient.sendCCe).toHaveBeenCalledWith('GDR-SO-so-1', 'Correção do endereço de entrega do cliente');
    });

    it('deve rejeitar CC-e para documento cancelado (422)', async () => {
      mockPrisma.fiscalDocument.findFirst.mockResolvedValue({
        ...authorizedDoc,
        status: FiscalStatus.CANCELLED,
        corrections: [],
      });

      await expect(
        service.correction('fd-1', 'co-1', 'Correção em nota cancelada'),
      ).rejects.toThrow('cancelado');
    });

    it('deve rejeitar CC-e quando limite de 20 atingido', async () => {
      mockPrisma.fiscalDocument.findFirst.mockResolvedValue({
        ...authorizedDoc,
        corrections: [{ sequenceNumber: 20 }],
      });

      await expect(
        service.correction('fd-1', 'co-1', 'Correção número 21 não permitida'),
      ).rejects.toThrow('20');
    });
  });

  // ─── #165: Inutilização ────────────────────────────────────────────────

  describe('voidRange', () => {
    it('deve inutilizar faixa com sucesso', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({ id: 'co-1', cnpj: '12.345.678/0001-90' });
      mockClient.voidRange.mockResolvedValue({ status: 'autorizado', ref: 'PROT-VOID' });
      mockPrisma.fiscalVoidRange.create.mockResolvedValue({ id: 'vr-1' });

      const result = await service.voidRange('co-1', '1', 101, 104, 'Gap de numeração no sistema fiscal');

      expect(mockClient.voidRange).toHaveBeenCalledWith(
        expect.objectContaining({ cnpj: '12345678000190', serie: '1', numero_inicial: 101, numero_final: 104 }),
      );
      expect(result.protocol).toBe('PROT-VOID');
    });

    it('deve rejeitar quando número final < inicial', async () => {
      await expect(
        service.voidRange('co-1', '1', 105, 101, 'Faixa invertida no sistema'),
      ).rejects.toThrow('>=');
    });

    it('deve lançar erro quando SEFAZ rejeita inutilização', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({ id: 'co-1', cnpj: '12345678000190' });
      mockClient.voidRange.mockResolvedValue({ status: 'erro', motivo: 'Número já utilizado' });

      await expect(
        service.voidRange('co-1', '1', 100, 100, 'Tentativa de inutilizar número já usado'),
      ).rejects.toThrow('Número já utilizado');
    });
  });

  // ─── #166: Persistência de FiscalDocumentItem + ItemTax ────────────────

  describe('emitForSale — persiste itens e impostos', () => {
    it('deve criar FiscalDocumentItem e FiscalDocumentItemTax ao emitir', async () => {
      mockPrisma.fiscalDocument.findUnique.mockResolvedValue(null);
      mockPrisma.salesOrder.findUnique.mockResolvedValue(baseOrder);
      mockPrisma.fiscalDocument.create.mockResolvedValue(baseFiscalDoc);
      mockClient.emitNFCe.mockResolvedValue({ status: 'autorizado', chave_nfe: 'CHAVE-123' });
      mockPrisma.fiscalDocument.update.mockResolvedValue({ ...baseFiscalDoc, status: FiscalStatus.AUTHORIZED });

      await service.emitForSale('so-1');

      expect(mockPrisma.fiscalDocumentItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fiscalDocumentId: 'fd-1',
          productCode: 'COD001',
          productName: 'Produto A',
          ncm: '61099000',
          cfop: '5101',
          quantity: 2,
          unitPrice: 150,
          totalPrice: 300,
        }),
      });
      expect(mockPrisma.fiscalDocumentItemTax.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fiscalDocumentItemId: 'fdi-1',
          cstIcms: '00',
          valorIcms: 54,
          cstCofins: '01',
          valorCofins: 9,
        }),
      });
    });
  });
});
