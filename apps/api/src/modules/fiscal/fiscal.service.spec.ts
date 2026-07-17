import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FiscalDocumentType, FiscalStatus } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FiscalService } from './fiscal.service';
import { EMISSOR_PORT } from './emissor.port';
import { IbsCbsAdjustmentService } from './ibscbs-adjustment.service';
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
  storeTransfer: {
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
  company: { cnpj: '11.222.333/0001-81', name: 'GDR Indústria Ltda', razaoSocial: 'GDR Ltda', ie: 'ISENTO', crt: 3, street: 'Rua A', number: '1', complement: null, neighborhood: 'Centro', city: 'Cascavel', state: 'PR', zipCode: '85807-030', ibgeCode: '4104808', phone: '4532221234' },
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
        { provide: EMISSOR_PORT, useValue: mockClient },
        { provide: TaxCalculationService, useValue: mockTaxCalc },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        IbsCbsAdjustmentService, // #755 — motor puro, instância real
      ],
    }).compile();

    service = module.get<FiscalService>(FiscalService);
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.fiscalDocumentItem.create.mockResolvedValue({ id: 'fdi-1' });
    mockPrisma.fiscalDocumentItemTax.create.mockResolvedValue({ id: 'fdit-1' });
  });

  describe('formas de pagamento na NF-e (#479)', () => {
    it('mapeia PaymentMethod da OV para o código tPag (PIX → 17)', async () => {
      mockPrisma.fiscalDocument.findUnique.mockResolvedValue(null);
      mockPrisma.salesOrder.findUnique.mockResolvedValue({ ...baseOrder, paymentMethod: 'PIX' });
      mockPrisma.fiscalDocument.create.mockResolvedValue(baseFiscalDoc);
      mockClient.emitNFCe.mockResolvedValue({ status: 'autorizado', ref: 'GDR-SO-so-1' });
      mockPrisma.fiscalDocument.update.mockResolvedValue(baseFiscalDoc);

      await service.emitForSale('so-1');

      const payload = mockClient.emitNFCe.mock.calls[0][1] as any;
      expect(payload.formas_pagamento[0].forma_pagamento).toBe('17');
      expect(payload.formas_pagamento[0].valor_pagamento).toBe(300);
    });

    it('mapeia BOLETO → 15', async () => {
      mockPrisma.fiscalDocument.findUnique.mockResolvedValue(null);
      mockPrisma.salesOrder.findUnique.mockResolvedValue({ ...baseOrder, paymentMethod: 'BOLETO' });
      mockPrisma.fiscalDocument.create.mockResolvedValue(baseFiscalDoc);
      mockClient.emitNFCe.mockResolvedValue({ status: 'autorizado', ref: 'GDR-SO-so-1' });
      mockPrisma.fiscalDocument.update.mockResolvedValue(baseFiscalDoc);

      await service.emitForSale('so-1');

      const payload = mockClient.emitNFCe.mock.calls[0][1] as any;
      expect(payload.formas_pagamento[0].forma_pagamento).toBe('15');
    });
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
      expect(mockClient.emitNFCe).toHaveBeenCalledWith('GDR-SO-so-1', expect.any(Object), expect.anything());
      // #479: sem forma de pagamento na OV → detPag 99 (outros)
      const payloadSemForma = mockClient.emitNFCe.mock.calls[0][1] as any;
      expect(payloadSemForma.formas_pagamento[0].forma_pagamento).toBe('99');
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
    it('erro_autorizacao vira REJECTED com codigo/motivo da SEFAZ (974 CRD, 13/07)', async () => {
      mockPrisma.fiscalDocument.findFirst.mockResolvedValue({
        ...baseFiscalDoc,
        status: FiscalStatus.PROCESSING,
      });
      mockPrisma.fiscalDocument.update.mockResolvedValue({
        ...baseFiscalDoc,
        status: FiscalStatus.REJECTED,
      });

      await service.handleWebhook({
        ref: 'GDR-SO-so-1',
        status: 'erro_autorizacao',
        status_sefaz: '974',
        mensagem_sefaz: 'CNPJ do responsavel tecnico diverge do cadastrado',
      });

      expect(mockPrisma.fiscalDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FiscalStatus.REJECTED,
            rejectionCode: '974',
            rejectionReason: 'CNPJ do responsavel tecnico diverge do cadastrado',
          }),
        }),
      );
    });

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

    it('deve persistir número, série e protocolo SEFAZ ao autorizar (#361)', async () => {
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
        numero: '14237',
        serie: '1',
        protocolo: '141260000012345',
      });

      expect(mockPrisma.fiscalDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            number: 14237,
            series: 1,
            protocolNumber: '141260000012345',
            authorizedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('deve extrair nProt do XML quando protocolo não vem no webhook (#361)', async () => {
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
        xml: '<protNFe><infProt><nProt>141260000054321</nProt></infProt></protNFe>',
      });

      expect(mockPrisma.fiscalDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ protocolNumber: '141260000054321' }),
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
        'co-1',
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
      expect(mockClient.sendCCe).toHaveBeenCalledWith('GDR-SO-so-1', 'Correção do endereço de entrega do cliente', 'co-1');
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
      mockPrisma.company.findUnique.mockResolvedValue({ id: 'co-1', cnpj: '11.222.333/0001-81' });
      mockClient.voidRange.mockResolvedValue({ status: 'autorizado', ref: 'PROT-VOID' });
      mockPrisma.fiscalVoidRange.create.mockResolvedValue({ id: 'vr-1' });

      const result = await service.voidRange('co-1', '1', 101, 104, 'Gap de numeração no sistema fiscal');

      expect(mockClient.voidRange).toHaveBeenCalledWith(
        expect.objectContaining({ cnpj: '11222333000181', serie: '1', numero_inicial: 101, numero_final: 104 }),
        'co-1',
      );
      expect(result.protocol).toBe('PROT-VOID');
    });

    it('deve rejeitar quando número final < inicial', async () => {
      await expect(
        service.voidRange('co-1', '1', 105, 101, 'Faixa invertida no sistema'),
      ).rejects.toThrow('>=');
    });

    it('deve lançar erro quando SEFAZ rejeita inutilização', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({ id: 'co-1', cnpj: '11222333000181' });
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

  // ─── emitForTransfer: operação derivada das UFs + destinatário real ──────

  describe('emitForTransfer — derivação INTERNA/INTERESTADUAL', () => {
    const emitterCompany = { cnpj: '46247069000115', name: 'GDR Reboques', razaoSocial: 'GDR Reboques Ltda', ie: '9095313067', crt: 3, street: 'Rua Antônio Singer', number: '4075', complement: null, neighborhood: 'Campo Largo da Roseira', city: 'SAO JOSE DOS PINHAIS', state: 'PR', zipCode: '83091-002', ibgeCode: '4125506', phone: '4132221234' };

    const makeTransfer = (destCompany: Record<string, unknown> | null) => ({
      id: 'tr-1',
      companyId: 'co-1',
      company: emitterCompany,
      fromWarehouseId: 'wh-1',
      fromWarehouse: { id: 'wh-1', name: 'Almoxarifado Fábrica' },
      toWarehouseId: 'wh-2',
      toWarehouse: { id: 'wh-2', name: 'Loja Guarapuava', company: destCompany },
      items: [
        {
          quantity: '2',
          unit: 'UN',
          product: { sku: 'MOD-CAR-001', name: 'Reboque Carga', ncm: '87163900', type: 'FINISHED_GOOD', avgCost: '150', costPrice: '120', origem: 0 },
        },
      ],
    });

    const destGuarapuava = { cnpj: '46247069000204', name: 'GDR Guarapuava', razaoSocial: 'GDR Reboques Ltda', ie: null, street: 'Rua XV', number: '100', neighborhood: 'Centro', city: 'GUARAPUAVA', state: 'PR', zipCode: '85010-000', ibgeCode: '4109401' };

    beforeEach(() => {
      mockPrisma.fiscalDocument.findUnique.mockResolvedValue(null);
      mockPrisma.fiscalDocument.create.mockResolvedValue({ ...baseFiscalDoc, focusRef: 'GDR-TR-tr-1' });
      mockPrisma.fiscalDocument.update.mockResolvedValue(baseFiscalDoc);
      mockClient.emitNFe.mockResolvedValue({ status: 'processando_autorizacao' });
    });

    it('mesma UF → TRANSFERENCIA_INTERNA, CFOP 5152 e destinatário com CNPJ da filial', async () => {
      mockPrisma.storeTransfer.findUnique.mockResolvedValue(makeTransfer(destGuarapuava));
      mockTaxCalc.calculateTaxes.mockResolvedValueOnce({
        cfop: '5152',
        icms: { cst: '41', baseCalculo: 0, aliquota: 0, valor: 0 },
        ipi: { cst: '53', baseCalculo: 0, aliquota: 0, valor: 0 },
        pis: { cst: '08', baseCalculo: 0, aliquota: 0, valor: 0 },
        cofins: { cst: '08', baseCalculo: 0, aliquota: 0, valor: 0 },
        totalTributos: 0,
      });

      await service.emitForTransfer('tr-1');

      expect(mockTaxCalc.calculateTaxes).toHaveBeenCalledWith(
        expect.objectContaining({ operationType: 'TRANSFERENCIA_INTERNA', ufOrigem: 'PR', ufDestino: 'PR' }),
      );
      const payload = mockClient.emitNFe.mock.calls[0][1] as any;
      expect(payload.items[0].cfop).toBe('5152');
      expect(payload.cnpj_destinatario).toBe('46247069000204');
      expect(payload.uf_destinatario).toBe('PR');
      expect(payload.nome_destinatario).toBe('GDR Reboques Ltda');
    });

    it('UFs distintas → TRANSFERENCIA_INTERESTADUAL e CFOP 6152', async () => {
      mockPrisma.storeTransfer.findUnique.mockResolvedValue(
        makeTransfer({ ...destGuarapuava, name: 'GDR Loja São Paulo', city: 'São Paulo', state: 'SP', ibgeCode: '3550308' }),
      );
      mockTaxCalc.calculateTaxes.mockResolvedValueOnce({
        cfop: '6152',
        icms: { cst: '41', baseCalculo: 0, aliquota: 0, valor: 0 },
        ipi: { cst: '53', baseCalculo: 0, aliquota: 0, valor: 0 },
        pis: { cst: '08', baseCalculo: 0, aliquota: 0, valor: 0 },
        cofins: { cst: '08', baseCalculo: 0, aliquota: 0, valor: 0 },
        totalTributos: 0,
      });

      await service.emitForTransfer('tr-1');

      expect(mockTaxCalc.calculateTaxes).toHaveBeenCalledWith(
        expect.objectContaining({ operationType: 'TRANSFERENCIA_INTERESTADUAL', ufOrigem: 'PR', ufDestino: 'SP' }),
      );
      const payload = mockClient.emitNFe.mock.calls[0][1] as any;
      expect(payload.items[0].cfop).toBe('6152');
      expect(payload.uf_destinatario).toBe('SP');
    });

    it('depósito destino sem company carregada → assume UF do emitente (INTERNA)', async () => {
      mockPrisma.storeTransfer.findUnique.mockResolvedValue(makeTransfer(null));

      await service.emitForTransfer('tr-1');

      expect(mockTaxCalc.calculateTaxes).toHaveBeenCalledWith(
        expect.objectContaining({ operationType: 'TRANSFERENCIA_INTERNA', ufOrigem: 'PR', ufDestino: 'PR' }),
      );
      const payload = mockClient.emitNFe.mock.calls[0][1] as any;
      expect(payload.uf_destinatario).toBe('PR');
      expect(payload.nome_destinatario).toBe('Loja Guarapuava');
    });
  });

  // ─── #747: NF-e de devolução referenciada (entrada, finNFe 4) ─────────────
  describe('emitReturnNote (#747)', () => {
    const CHAVE = '41260730284708000182550010000200021392278324';
    const taxRow = {
      cstIcms: '00', baseIcms: '300', aliquotaIcms: '12', valorIcms: '36',
      cstIpi: '53', baseIpi: '0', aliquotaIpi: '0', valorIpi: '0',
      cstPis: '49', basePis: '0', aliquotaPis: '0', valorPis: '0',
      cstCofins: '99', baseCofins: '0', aliquotaCofins: '0', valorCofins: '0',
      cClassTrib: '000001', cstCbs: '000', baseCbs: '300', aliquotaCbs: '0.9', valorCbs: '2.7',
      cstIbsUf: '000', baseIbsUf: '300', aliquotaIbsUf: '0.1', valorIbsUf: '0.3',
      cstIbsMun: '000', baseIbsMun: '300', aliquotaIbsMun: '0', valorIbsMun: '0',
    };
    const originalDoc = () => ({
      id: 'nfe-orig',
      companyId: 'co-1',
      type: 'NFE',
      status: 'AUTHORIZED',
      finalidade: 'NORMAL',
      chave: CHAVE,
      number: 20002,
      series: 1,
      items: [
        {
          id: 'fdi-orig', productCode: 'COD001', productName: 'Produto A', ncm: '61099000',
          cest: null, unit: 'UN', quantity: '2', unitPrice: '150', taxes: [{ ...taxRow }],
        },
      ],
      salesOrder: {
        id: 'so-1',
        status: 'RETURNED',
        company: baseOrder.company,
        customer: {
          name: 'Cliente PR', document: '52998224725', state: 'PR', city: 'Curitiba',
          address: 'Rua B', number: '10', neighborhood: 'Centro', zipCode: '80000-000',
          ibgeCode: '4106902', email: null, fiscalEmail: null, ie: null, indIeDest: null,
          razaoSocial: null, complement: null,
        },
        items: [
          {
            product: { id: 'p1', sku: 'COD001', name: 'Produto A', unit: 'UN', origem: '0' },
            serialNumber: null, quantity: '2', unitPrice: '150',
          },
        ],
      },
    });

    beforeEach(() => {
      mockClient.emitNFe.mockResolvedValue({ status: 'processando_autorizacao', ref: 'GDR-RET-nfe-orig' });
      mockPrisma.fiscalDocument.create.mockResolvedValue({ id: 'nfe-dev', companyId: 'co-1' });
      mockPrisma.fiscalDocument.update.mockResolvedValue({});
    });

    it('cria doc DEVOLUCAO vinculado à original e transmite o payload espelho (entrada 1202, ref à chave)', async () => {
      mockPrisma.fiscalDocument.findFirst
        .mockResolvedValueOnce(originalDoc()) // original
        .mockResolvedValueOnce(null); // sem devolução existente

      await service.emitReturnNote('nfe-orig', 'co-1', 'defeito de fabricação');

      expect(mockPrisma.fiscalDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'NFE',
          finalidade: 'DEVOLUCAO',
          referencedDocumentId: 'nfe-orig',
          focusRef: 'GDR-RET-nfe-orig',
          // vínculo com a OV vai pela referência — salesOrderId NÃO é usado (@unique da NORMAL)
        }),
      });
      const create = mockPrisma.fiscalDocument.create.mock.calls[0][0].data;
      expect(create.salesOrderId).toBeUndefined();

      expect(mockClient.emitNFe).toHaveBeenCalledTimes(1);
      const [ref, payload] = mockClient.emitNFe.mock.calls[0] as any[];
      expect(ref).toBe('GDR-RET-nfe-orig');
      expect(payload.finalidade_emissao).toBe('4');
      expect(payload.tipo_documento).toBe('0');
      expect(payload.natureza_operacao).toBe('DEVOLUCAO DE VENDA');
      expect(payload.notas_referenciadas).toEqual([{ chave_nfe: CHAVE }]);
      expect(payload.formas_pagamento).toEqual([{ forma_pagamento: '90', valor_pagamento: 0 }]);
      // espelho: CFOP de entrada intra + IBS/CBS da original preservados
      expect(payload.items[0].cfop).toBe('1202');
      expect(payload.items[0].ibs_cbs_classificacao_tributaria).toBe('000001');
      expect(payload.items[0].cbs_valor).toBe(2.7);
      // itens persistidos no doc de devolução
      expect(mockPrisma.fiscalDocumentItem.create).toHaveBeenCalled();
    });

    it('bloqueia se a OV não está RETURNED (reversão interna primeiro)', async () => {
      const doc = originalDoc();
      doc.salesOrder.status = 'INVOICED';
      mockPrisma.fiscalDocument.findFirst.mockResolvedValueOnce(doc);

      await expect(service.emitReturnNote('nfe-orig', 'co-1')).rejects.toThrow(/RETURNED/);
      expect(mockClient.emitNFe).not.toHaveBeenCalled();
    });

    it('idempotência: devolução viva (não REJECTED/ERROR) não reemite', async () => {
      mockPrisma.fiscalDocument.findFirst
        .mockResolvedValueOnce(originalDoc())
        .mockResolvedValueOnce({ id: 'nfe-dev', status: 'AUTHORIZED' });

      await service.emitReturnNote('nfe-orig', 'co-1');

      expect(mockPrisma.fiscalDocument.create).not.toHaveBeenCalled();
      expect(mockClient.emitNFe).not.toHaveBeenCalled();
    });

    it('original NFC-e → erro orientado (devolução referenciada é só p/ NF-e)', async () => {
      const doc = originalDoc();
      (doc as any).type = 'NFCE';
      mockPrisma.fiscalDocument.findFirst.mockResolvedValueOnce(doc);

      await expect(service.emitReturnNote('nfe-orig', 'co-1')).rejects.toThrow(/NF-e/);
    });

    it('cliente interestadual → CFOP 2202', async () => {
      const doc = originalDoc();
      (doc.salesOrder.customer as any).state = 'SP';
      mockPrisma.fiscalDocument.findFirst
        .mockResolvedValueOnce(doc)
        .mockResolvedValueOnce(null);

      await service.emitReturnNote('nfe-orig', 'co-1');

      const payload = mockClient.emitNFe.mock.calls[0][1] as any;
      expect(payload.items[0].cfop).toBe('2202');
    });
  });

  // ─── #757: Nota de Débito/Crédito IBS/CBS (finNFe 5/6) ────────────────────
  describe('emitAdjustmentNote (#757)', () => {
    const CHAVE = '41260730284708000182550010000200021392278324';
    const taxRow = {
      cstIcms: '00', baseIcms: '3000', aliquotaIcms: '12', valorIcms: '360',
      cstIpi: '53', cstPis: '49', cstCofins: '99',
      cClassTrib: '000001', cstCbs: '000', baseCbs: '3000', aliquotaCbs: '0.9', valorCbs: '27',
      cstIbsUf: '000', baseIbsUf: '3000', aliquotaIbsUf: '0.1', valorIbsUf: '3',
      cstIbsMun: '000', baseIbsMun: '3000', aliquotaIbsMun: '0', valorIbsMun: '0',
    };
    const adjOriginal = () => ({
      id: 'nfe-orig',
      companyId: 'co-1',
      type: 'NFE',
      status: 'AUTHORIZED',
      finalidade: 'NORMAL',
      chave: CHAVE,
      number: 20002,
      series: 1,
      items: [
        {
          id: 'fdi-1', productCode: 'COD001', productName: 'Produto A', ncm: '87163900',
          quantity: '1', unitPrice: '3000', totalPrice: '3000', taxes: [{ ...taxRow }],
        },
      ],
      salesOrder: {
        id: 'so-1',
        status: 'INVOICED',
        company: baseOrder.company,
        customer: {
          name: 'Cliente PR', document: '52998224725', state: 'PR', city: 'Curitiba',
          address: 'Rua B', number: '10', neighborhood: 'Centro', zipCode: '80000-000',
          ibgeCode: '4106902', email: null, fiscalEmail: null, ie: null, indIeDest: null,
          razaoSocial: null, complement: null,
        },
      },
    });

    beforeEach(() => {
      mockClient.emitNFe.mockResolvedValue({ status: 'processando_autorizacao' });
      mockPrisma.fiscalDocument.create.mockResolvedValue({ id: 'nfe-adj', companyId: 'co-1' });
      mockPrisma.fiscalDocument.update.mockResolvedValue({});
      mockPrisma.fiscalDocument.findMany.mockResolvedValue([]);
    });

    it('débito AMOUNT (multa e juros): cria doc NOTA_DEBITO vinculado e transmite payload só-IBS/CBS', async () => {
      mockPrisma.fiscalDocument.findFirst.mockResolvedValueOnce(adjOriginal());

      await service.emitAdjustmentNote('nfe-orig', 'co-1', 'DEBITO', {
        tipo: '04',
        spec: { mode: 'AMOUNT', amount: 350, description: 'multa e juros' },
        justificativa: 'atraso 30 dias',
      });

      expect(mockPrisma.fiscalDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'NFE',
          finalidade: 'NOTA_DEBITO',
          tipoNotaDebito: '04',
          referencedDocumentId: 'nfe-orig',
        }),
      });
      expect(mockClient.emitNFe).toHaveBeenCalledTimes(1);
      const [ref, payload] = mockClient.emitNFe.mock.calls[0] as any[];
      expect(ref).toBe('GDR-ADJ-nfe-orig-1');
      expect(payload.finalidade_emissao).toBe('6');
      expect(payload.tipo_nota_debito).toBe('04');
      expect(payload.notas_referenciadas).toEqual([{ chave_nfe: CHAVE }]);
      const item = payload.items[0];
      expect(item.ibs_cbs_base_calculo).toBe(350);
      expect(item.cbs_valor).toBe(3.15); // 0,9% efetiva espelhada
      expect(Object.keys(item).some((k) => k.startsWith('icms_'))).toBe(false);
    });

    it('crédito FULL: estorno integral com finalidade 5', async () => {
      mockPrisma.fiscalDocument.findFirst.mockResolvedValueOnce(adjOriginal());

      await service.emitAdjustmentNote('nfe-orig', 'co-1', 'CREDITO', {
        tipo: '04',
        spec: { mode: 'FULL' },
      });

      const payload = mockClient.emitNFe.mock.calls[0][1] as any;
      expect(payload.finalidade_emissao).toBe('5');
      expect(payload.tipo_nota_credito).toBe('04');
      expect(payload.items[0].ibs_cbs_base_calculo).toBe(3000);
      expect(payload.items[0].cbs_valor).toBe(27);
    });

    it('bloqueia ajuste simultâneo em PENDING/PROCESSING', async () => {
      mockPrisma.fiscalDocument.findFirst.mockResolvedValueOnce(adjOriginal());
      mockPrisma.fiscalDocument.findMany.mockResolvedValueOnce([
        { id: 'adj-1', status: 'PROCESSING', tipoNotaDebito: '04' },
      ]);

      await expect(
        service.emitAdjustmentNote('nfe-orig', 'co-1', 'DEBITO', {
          tipo: '04',
          spec: { mode: 'AMOUNT', amount: 100 },
        }),
      ).rejects.toThrow(/em processamento/);
      expect(mockClient.emitNFe).not.toHaveBeenCalled();
    });

    it('motivo fora do catálogo → erro orientado (crédito só 01-06)', async () => {
      await expect(
        service.emitAdjustmentNote('nfe-orig', 'co-1', 'CREDITO', {
          tipo: '07',
          spec: { mode: 'FULL' },
        }),
      ).rejects.toThrow(/inválido/);
    });

    it('original não-AUTHORIZED → bloqueia', async () => {
      const doc = adjOriginal();
      (doc as any).status = 'CANCELLED';
      mockPrisma.fiscalDocument.findFirst.mockResolvedValueOnce(doc);

      await expect(
        service.emitAdjustmentNote('nfe-orig', 'co-1', 'DEBITO', {
          tipo: '04',
          spec: { mode: 'AMOUNT', amount: 100 },
        }),
      ).rejects.toThrow(/AUTHORIZED/);
    });
  });
});
