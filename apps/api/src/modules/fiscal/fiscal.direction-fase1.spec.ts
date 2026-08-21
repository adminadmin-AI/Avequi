/**
 * Fase 1 — notas de entrada em FiscalDocument (21/08/2026).
 *
 * O que este spec garante:
 *   1. Todo caminho de EMISSÃO grava `direction = EMITIDA` e `issuerCnpj` =
 *      CNPJ da company (só dígitos), nunca `RECEBIDA`.
 *   2. Sem CNPJ válido não há emissão (falha alto, sem criar documento).
 *   3. O filtro `direction` de listagem/exportação é opcional e aditivo:
 *      sem ele, o `where` é o de sempre.
 *
 * Nunca toca em banco: PrismaService é mockado (convenção do projeto).
 */
import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { FiscalDirection, FiscalDocumentType, FiscalStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TaxCalculationService } from '../tax/tax-calculation.service';
import { EMISSOR_PORT } from './emissor.port';
import { parseDirection } from './fiscal.controller';
import { FiscalService } from './fiscal.service';
import { IbsCbsAdjustmentService } from './ibscbs-adjustment.service';

const mockPrisma = {
  fiscalDocument: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  salesOrder: { findUnique: jest.fn() },
  storeTransfer: { findUnique: jest.fn() },
  company: { findUnique: jest.fn() },
  auditLog: { create: jest.fn() },
  fiscalDocumentItem: { create: jest.fn() },
  fiscalDocumentItemTax: { create: jest.fn() },
};
const mockClient = {
  emitNFCe: jest.fn(),
  emitNFe: jest.fn(),
  cancelNFe: jest.fn(),
  sendCCe: jest.fn(),
  voidRange: jest.fn(),
  getStatus: jest.fn(),
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

const company = {
  cnpj: '11.222.333/0001-81', // formatado de propósito: o emitente deve sair só com dígitos
  name: 'GDR Indústria Ltda',
  razaoSocial: 'GDR Ltda',
  ie: 'ISENTO',
  crt: 3,
  street: 'Rua A',
  number: '1',
  complement: null,
  neighborhood: 'Centro',
  city: 'Cascavel',
  state: 'PR',
  zipCode: '85807-030',
  ibgeCode: '4104808',
  phone: '4532221234',
};

const order = {
  id: 'so-1',
  companyId: 'co-1',
  customer: null,
  company,
  items: [
    {
      product: { sku: 'COD001', name: 'Produto A', ncm: '61099000', unit: 'UN', type: 'FINISHED_GOOD' },
      quantity: '2',
      unitPrice: '150',
    },
  ],
};

const transfer = {
  id: 'tr-1',
  companyId: 'co-1',
  company: { ...company, cnpj: '46247069000115' },
  fromWarehouseId: 'wh-1',
  fromWarehouse: { id: 'wh-1', name: 'Almoxarifado' },
  toWarehouseId: 'wh-2',
  toWarehouse: { id: 'wh-2', name: 'Loja', company: { ...company, cnpj: '46247069000204', ie: null } },
  items: [
    {
      quantity: '1',
      unit: 'UN',
      product: { sku: 'MOD-CAR-001', name: 'Reboque', ncm: '87163900', type: 'FINISHED_GOOD', avgCost: '150', costPrice: '120', origem: 0 },
    },
  ],
};

const createdDoc = {
  id: 'fd-1',
  companyId: 'co-1',
  salesOrderId: 'so-1',
  type: FiscalDocumentType.NFCE,
  status: FiscalStatus.PENDING,
  focusRef: 'GDR-SO-so-1',
  retryCount: 0,
};

/** Dados passados ao `fiscalDocument.create` na chamada N. */
const createData = (n = 0) => mockPrisma.fiscalDocument.create.mock.calls[n][0].data;

describe('Fase 1 — direction e issuerCnpj na emissão', () => {
  let service: FiscalService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiscalService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EMISSOR_PORT, useValue: mockClient },
        { provide: TaxCalculationService, useValue: mockTaxCalc },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: IbsCbsAdjustmentService, useValue: { buildAdjustmentItems: jest.fn() } },
      ],
    }).compile();
    service = module.get(FiscalService);

    mockPrisma.fiscalDocument.findUnique.mockResolvedValue(null);
    mockPrisma.fiscalDocument.findFirst.mockResolvedValue(null);
    mockPrisma.fiscalDocument.create.mockResolvedValue(createdDoc);
    mockPrisma.fiscalDocument.update.mockResolvedValue(createdDoc);
    mockPrisma.fiscalDocumentItem.create.mockResolvedValue({ id: 'fdi-1' });
    mockPrisma.fiscalDocumentItemTax.create.mockResolvedValue({ id: 'fdt-1' });
    mockClient.emitNFCe.mockResolvedValue({ status: 'processando_autorizacao' });
    mockClient.emitNFe.mockResolvedValue({ status: 'processando_autorizacao' });
  });

  describe('emitForSale', () => {
    it('grava direction EMITIDA e issuerCnpj = CNPJ da company só com dígitos', async () => {
      mockPrisma.salesOrder.findUnique.mockResolvedValue(order);

      await service.emitForSale('so-1');

      expect(mockPrisma.fiscalDocument.create).toHaveBeenCalledTimes(1);
      expect(createData()).toMatchObject({
        companyId: 'co-1',
        direction: FiscalDirection.EMITIDA,
        issuerCnpj: '11222333000181',
      });
    });

    it('usa o CNPJ já carregado na OV — não consulta a company de novo', async () => {
      mockPrisma.salesOrder.findUnique.mockResolvedValue(order);

      await service.emitForSale('so-1');

      expect(mockPrisma.company.findUnique).not.toHaveBeenCalled();
    });

    it('sem CNPJ na OV, busca a company; sem CNPJ válido em lugar nenhum, falha antes de criar', async () => {
      mockPrisma.salesOrder.findUnique.mockResolvedValue({ ...order, company: { ...company, cnpj: null } });
      mockPrisma.company.findUnique.mockResolvedValue({ cnpj: '123' }); // inválido

      await expect(service.emitForSale('so-1')).rejects.toBeInstanceOf(BadRequestException);

      expect(mockPrisma.company.findUnique).toHaveBeenCalledWith({ where: { id: 'co-1' }, select: { cnpj: true } });
      expect(mockPrisma.fiscalDocument.create).not.toHaveBeenCalled();
      expect(mockClient.emitNFCe).not.toHaveBeenCalled();
    });

  });

  describe('emitterCnpj (helper usado pelos 4 caminhos de emissão)', () => {
    const helper = (companyId: string, known?: string | null) =>
      (service as unknown as { emitterCnpj: (c: string, k?: string | null) => Promise<string> }).emitterCnpj(companyId, known);

    it('normaliza o CNPJ já conhecido para só dígitos, sem consultar o banco', async () => {
      await expect(helper('co-1', '11.222.333/0001-81')).resolves.toBe('11222333000181');
      expect(mockPrisma.company.findUnique).not.toHaveBeenCalled();
    });

    it('sem CNPJ conhecido, busca no cadastro da company (fluxos de devolução/ajuste)', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({ cnpj: '46.247.069/0001-15' });
      await expect(helper('co-1')).resolves.toBe('46247069000115');
      expect(mockPrisma.company.findUnique).toHaveBeenCalledWith({ where: { id: 'co-1' }, select: { cnpj: true } });
    });

    it('CNPJ inválido em todo lugar → BadRequestException', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({ cnpj: null });
      await expect(helper('co-1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('emitForTransfer', () => {
    it('grava direction EMITIDA e issuerCnpj da company de origem', async () => {
      mockPrisma.storeTransfer.findUnique.mockResolvedValue(transfer);
      mockPrisma.fiscalDocument.create.mockResolvedValue({ ...createdDoc, focusRef: 'GDR-TR-tr-1', salesOrderId: null });

      await service.emitForTransfer('tr-1');

      expect(createData()).toMatchObject({
        companyId: 'co-1',
        direction: FiscalDirection.EMITIDA,
        issuerCnpj: '46247069000115',
      });
    });
  });

  describe('invariante: emissão nunca grava RECEBIDA', () => {
    it('em todas as criações dos fluxos de venda e transferência', async () => {
      mockPrisma.salesOrder.findUnique.mockResolvedValue(order);
      await service.emitForSale('so-1');

      mockPrisma.storeTransfer.findUnique.mockResolvedValue(transfer);
      mockPrisma.fiscalDocument.create.mockResolvedValue({ ...createdDoc, focusRef: 'GDR-TR-tr-1', salesOrderId: null });
      await service.emitForTransfer('tr-1');

      const directions = mockPrisma.fiscalDocument.create.mock.calls.map((c) => c[0].data.direction);
      expect(directions).toHaveLength(2);
      expect(directions.every((d) => d === FiscalDirection.EMITIDA)).toBe(true);
      expect(directions).not.toContain(FiscalDirection.RECEBIDA);
    });
  });

  describe('findAll — filtro opcional por direction (contrato aditivo)', () => {
    it('sem direction: where só com companyId (comportamento de sempre)', async () => {
      mockPrisma.fiscalDocument.findMany.mockResolvedValue([]);
      await service.findAll('co-1');
      const where = mockPrisma.fiscalDocument.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ companyId: 'co-1' });
      expect(where).not.toHaveProperty('direction');
    });

    it('com direction RECEBIDA: where filtra por direction', async () => {
      mockPrisma.fiscalDocument.findMany.mockResolvedValue([]);
      await service.findAll('co-1', FiscalDirection.RECEBIDA);
      expect(mockPrisma.fiscalDocument.findMany.mock.calls[0][0].where).toEqual({
        companyId: 'co-1',
        direction: FiscalDirection.RECEBIDA,
      });
    });
  });

  describe('listXmlsForExport — filtro opcional por direction', () => {
    const from = new Date('2026-08-01T00:00:00-03:00');
    const to = new Date('2026-08-31T23:59:59-03:00');

    it('sem direction: where não tem a chave direction', async () => {
      mockPrisma.fiscalDocument.findMany.mockResolvedValue([]);
      await service.listXmlsForExport('co-1', from, to);
      expect(mockPrisma.fiscalDocument.findMany.mock.calls[0][0].where).not.toHaveProperty('direction');
    });

    it('com direction EMITIDA: where inclui direction', async () => {
      mockPrisma.fiscalDocument.findMany.mockResolvedValue([]);
      await service.listXmlsForExport('co-1', from, to, undefined, FiscalDirection.EMITIDA);
      expect(mockPrisma.fiscalDocument.findMany.mock.calls[0][0].where.direction).toBe(FiscalDirection.EMITIDA);
    });
  });
});

describe('Fase 1 — parseDirection (query string do controller)', () => {
  it('ausente ou vazio → undefined (sem filtro)', () => {
    expect(parseDirection(undefined)).toBeUndefined();
    expect(parseDirection('')).toBeUndefined();
  });

  it('valores do enum passam', () => {
    expect(parseDirection('EMITIDA')).toBe(FiscalDirection.EMITIDA);
    expect(parseDirection('RECEBIDA')).toBe(FiscalDirection.RECEBIDA);
  });

  it('valor fora do enum → 400, não um where inválido', () => {
    expect(() => parseDirection('entrada')).toThrow(BadRequestException);
  });
});
