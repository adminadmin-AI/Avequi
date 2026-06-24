import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InboundNfeStatus, PurchaseOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchNfeDto } from './dto/match-nfe.dto';
import { UploadNfeDto } from './dto/upload-nfe.dto';
import { InboundNfeService } from './inbound-nfe.service';
import { parseNfeXml } from './nfe-xml.parser';

// ─── Sample NF-e XML ─────────────────────────────────────────────────────────

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260619999999999999550010000001231234567890">
      <ide>
        <nNF>123</nNF>
        <serie>1</serie>
        <dhEmi>2026-06-19T10:00:00-03:00</dhEmi>
      </ide>
      <emit>
        <CNPJ>12345678000199</CNPJ>
        <xNome>Fornecedor Teste LTDA</xNome>
      </emit>
      <det nItem="1">
        <prod>
          <cEAN>7891234560001</cEAN>
          <xProd>Produto Alpha</xProd>
          <NCM>84821010</NCM>
          <CFOP>1101</CFOP>
          <qCom>10.000</qCom>
          <vUnCom>50.00</vUnCom>
          <vProd>500.00</vProd>
        </prod>
      </det>
      <det nItem="2">
        <prod>
          <cEAN>SEM GTIN</cEAN>
          <xProd>Produto Beta</xProd>
          <NCM>84822000</NCM>
          <CFOP>1101</CFOP>
          <qCom>5.000</qCom>
          <vUnCom>200.00</vUnCom>
          <vProd>1000.00</vProd>
        </prod>
      </det>
      <total>
        <ICMSTot>
          <vNF>1500.00</vNF>
        </ICMSTot>
      </total>
    </infNFe>
  </NFe>
</nfeProc>`;

const CHAVE_NFE = '35260619999999999999550010000001231234567890';

// ─── Mock Prisma ─────────────────────────────────────────────────────────────

const mockEventEmitter = { emit: jest.fn() };

const mockPrisma = {
  inboundNfe: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  purchaseOrder: {
    findFirst: jest.fn(),
  },
  goodsReceipt: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  warehouse: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
  },
  stockBalance: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  stockMovement: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

// ─── Base fixtures ────────────────────────────────────────────────────────────

const baseNfe = {
  id: 'nfe-1',
  companyId: 'co-1',
  chaveNfe: CHAVE_NFE,
  nfeNumber: '123',
  series: '1',
  supplierCnpj: '12345678000199',
  supplierName: 'Fornecedor Teste LTDA',
  issueDate: new Date('2026-06-19T10:00:00-03:00'),
  totalValue: 1500,
  status: InboundNfeStatus.PENDING,
  purchaseOrderId: null,
  goodsReceiptId: null,
  xmlContent: SAMPLE_XML,
  parsedItems: [],
  rejectReason: null,
  importedById: null,
  importedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const basePoItem = {
  id: 'poi-1',
  purchaseOrderId: 'po-1',
  productId: 'prod-1',
  quantity: 10,
  unitCost: 50,
  unit: 'UN',
  product: { id: 'prod-1', ncm: '84821010', name: 'Produto Alpha' },
};

const basePo = {
  id: 'po-1',
  companyId: 'co-1',
  supplierId: 'sup-1',
  status: PurchaseOrderStatus.APPROVED,
  supplier: { id: 'sup-1', cnpj: '12345678000199', name: 'Fornecedor Teste LTDA' },
  items: [basePoItem],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('parseNfeXml', () => {
  it('should parse chaveNfe from Id attribute', () => {
    const result = parseNfeXml(SAMPLE_XML);
    expect(result.chaveNfe).toBe(CHAVE_NFE);
  });

  it('should parse supplier fields', () => {
    const result = parseNfeXml(SAMPLE_XML);
    expect(result.supplierCnpj).toBe('12345678000199');
    expect(result.supplierName).toBe('Fornecedor Teste LTDA');
  });

  it('should parse nfeNumber and series', () => {
    const result = parseNfeXml(SAMPLE_XML);
    expect(result.nfeNumber).toBe('123');
    expect(result.series).toBe('1');
  });

  it('should parse totalValue', () => {
    const result = parseNfeXml(SAMPLE_XML);
    expect(result.totalValue).toBe(1500);
  });

  it('should parse two items', () => {
    const result = parseNfeXml(SAMPLE_XML);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].ncm).toBe('84821010');
    expect(result.items[0].description).toBe('Produto Alpha');
    expect(result.items[0].quantity).toBe(10);
    expect(result.items[0].unitPrice).toBe(50);
    expect(result.items[0].totalPrice).toBe(500);
    expect(result.items[0].cfop).toBe('1101');
    expect(result.items[1].ean).toBe('SEM GTIN');
  });

  it('should parse issueDate', () => {
    const result = parseNfeXml(SAMPLE_XML);
    expect(result.issueDate).toContain('2026-06-19');
  });

  it('should return empty chaveNfe for invalid xml', () => {
    const result = parseNfeXml('<xml></xml>');
    expect(result.chaveNfe).toBe('');
    expect(result.items).toHaveLength(0);
  });
});

describe('InboundNfeService', () => {
  let service: InboundNfeService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboundNfeService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<InboundNfeService>(InboundNfeService);
  });

  // ─── upload ──────────────────────────────────────────────────────────────

  describe('upload', () => {
    const dto: UploadNfeDto = {
      xmlContent: SAMPLE_XML,
      warehouseId: 'wh-1',
    };

    it('should upload and auto-match when APPROVED PO found with matching CNPJ', async () => {
      mockPrisma.inboundNfe.findUnique.mockResolvedValue(null);
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue(basePo);
      mockPrisma.inboundNfe.create.mockResolvedValue({
        ...baseNfe,
        status: InboundNfeStatus.MATCHED,
        purchaseOrderId: 'po-1',
        purchaseOrder: basePo,
      });

      const result = await service.upload('co-1', dto, 'user-1');

      expect(mockPrisma.inboundNfe.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: InboundNfeStatus.MATCHED,
            purchaseOrderId: 'po-1',
          }),
        }),
      );
      expect(result.status).toBe(InboundNfeStatus.MATCHED);
    });

    it('should upload with PENDING status when no matching PO found', async () => {
      mockPrisma.inboundNfe.findUnique.mockResolvedValue(null);
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue(null);
      mockPrisma.inboundNfe.create.mockResolvedValue({
        ...baseNfe,
        status: InboundNfeStatus.PENDING,
        purchaseOrder: null,
      });

      const result = await service.upload('co-1', dto);

      expect(mockPrisma.inboundNfe.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: InboundNfeStatus.PENDING,
            purchaseOrderId: null,
          }),
        }),
      );
      expect(result.status).toBe(InboundNfeStatus.PENDING);
    });

    it('should throw BadRequestException for duplicate chaveNfe', async () => {
      mockPrisma.inboundNfe.findUnique.mockResolvedValue(baseNfe);

      await expect(service.upload('co-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for invalid XML (no chaveNfe)', async () => {
      const badDto: UploadNfeDto = {
        xmlContent: '<xml>invalid but long enough for the dto validator aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</xml>',
        warehouseId: 'wh-1',
      };

      await expect(service.upload('co-1', badDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── matchToPo ───────────────────────────────────────────────────────────

  describe('matchToPo', () => {
    const dto: MatchNfeDto = { purchaseOrderId: 'po-1' };

    it('should match NF-e to a PO and set status MATCHED', async () => {
      mockPrisma.inboundNfe.findFirst.mockResolvedValue(baseNfe);
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue(basePo);
      mockPrisma.inboundNfe.update.mockResolvedValue({
        ...baseNfe,
        status: InboundNfeStatus.MATCHED,
        purchaseOrderId: 'po-1',
        purchaseOrder: basePo,
      });

      const result = await service.matchToPo('nfe-1', 'co-1', dto);

      expect(mockPrisma.inboundNfe.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: InboundNfeStatus.MATCHED,
            purchaseOrderId: 'po-1',
          }),
        }),
      );
      expect(result.status).toBe(InboundNfeStatus.MATCHED);
    });

    it('should throw NotFoundException when NF-e not found', async () => {
      mockPrisma.inboundNfe.findFirst.mockResolvedValue(null);

      await expect(service.matchToPo('nfe-x', 'co-1', dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when PO not found for company', async () => {
      mockPrisma.inboundNfe.findFirst.mockResolvedValue(baseNfe);
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue(null);

      await expect(service.matchToPo('nfe-1', 'co-1', dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when NF-e is already IMPORTED', async () => {
      mockPrisma.inboundNfe.findFirst.mockResolvedValue({
        ...baseNfe,
        status: InboundNfeStatus.IMPORTED,
      });

      await expect(service.matchToPo('nfe-1', 'co-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── reject ──────────────────────────────────────────────────────────────

  describe('reject', () => {
    it('should reject NF-e with reason', async () => {
      mockPrisma.inboundNfe.findFirst.mockResolvedValue(baseNfe);
      mockPrisma.inboundNfe.update.mockResolvedValue({
        ...baseNfe,
        status: InboundNfeStatus.REJECTED,
        rejectReason: 'Divergência de preço',
      });

      const result = await service.reject('nfe-1', 'co-1', 'Divergência de preço');

      expect(mockPrisma.inboundNfe.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: InboundNfeStatus.REJECTED,
            rejectReason: 'Divergência de preço',
          }),
        }),
      );
      expect(result.status).toBe(InboundNfeStatus.REJECTED);
    });

    it('should throw NotFoundException when NF-e not found', async () => {
      mockPrisma.inboundNfe.findFirst.mockResolvedValue(null);

      await expect(
        service.reject('nfe-x', 'co-1', 'reason'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when NF-e is already IMPORTED', async () => {
      mockPrisma.inboundNfe.findFirst.mockResolvedValue({
        ...baseNfe,
        status: InboundNfeStatus.IMPORTED,
      });

      await expect(
        service.reject('nfe-1', 'co-1', 'reason'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── importAsGr ──────────────────────────────────────────────────────────

  describe('importAsGr', () => {
    const matchedNfe = {
      ...baseNfe,
      status: InboundNfeStatus.MATCHED,
      purchaseOrderId: 'po-1',
      purchaseOrder: {
        ...basePo,
        items: [basePoItem],
      },
      parsedItems: [
        {
          ncm: '84821010',
          description: 'Produto Alpha',
          quantity: 10,
          unitPrice: 50,
          totalPrice: 500,
          cfop: '1101',
          ean: '7891234560001',
        },
      ],
    };

    const grResult = {
      id: 'gr-1',
      companyId: 'co-1',
      purchaseOrderId: 'po-1',
      warehouseId: 'wh-1',
      notes: `Importado via NF-e ${CHAVE_NFE}`,
      items: [{ id: 'gri-1', goodsReceiptId: 'gr-1', poItemId: 'poi-1', productId: 'prod-1', qtyOrdered: 10, qtyReceived: 10 }],
    };

    it('should create GoodsReceipt, update stock, emit event and mark IMPORTED', async () => {
      mockPrisma.inboundNfe.findFirst.mockResolvedValue(matchedNfe);
      mockPrisma.goodsReceipt.findFirst.mockResolvedValue({ warehouseId: 'wh-1' });
      mockPrisma.warehouse.findUnique.mockResolvedValue({ wmsEnabled: false });
      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        const txPrisma = {
          goodsReceipt: { create: jest.fn().mockResolvedValue(grResult) },
          inboundNfe: {
            update: jest.fn().mockResolvedValue({
              ...matchedNfe,
              status: InboundNfeStatus.IMPORTED,
              goodsReceiptId: 'gr-1',
              importedAt: new Date(),
            }),
          },
          stockBalance: {
            findUnique: jest.fn().mockResolvedValue({ available: 10, reserved: 0 }),
            create: jest.fn(),
            update: jest.fn(),
          },
          stockMovement: { create: jest.fn() },
        };
        return fn(txPrisma);
      });

      const result = await service.importAsGr('nfe-1', 'co-1', 'user-1');

      expect(result.goodsReceipt.id).toBe('gr-1');
      expect(result.inboundNfe.status).toBe(InboundNfeStatus.IMPORTED);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'purchase.goods_received',
        expect.objectContaining({
          companyId: 'co-1',
          goodsReceiptId: 'gr-1',
          purchaseOrderId: 'po-1',
        }),
      );
    });

    it('should throw BadRequestException if status is not MATCHED', async () => {
      mockPrisma.inboundNfe.findFirst.mockResolvedValue({
        ...matchedNfe,
        status: InboundNfeStatus.PENDING,
      });

      await expect(
        service.importAsGr('nfe-1', 'co-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when NF-e not found', async () => {
      mockPrisma.inboundNfe.findFirst.mockResolvedValue(null);

      await expect(
        service.importAsGr('nfe-x', 'co-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getStats ─────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return correct stats structure', async () => {
      mockPrisma.inboundNfe.findMany.mockResolvedValue([
        { status: InboundNfeStatus.PENDING },
        { status: InboundNfeStatus.MATCHED },
        { status: InboundNfeStatus.IMPORTED },
        { status: InboundNfeStatus.IMPORTED },
        { status: InboundNfeStatus.REJECTED },
      ]);

      const stats = await service.getStats('co-1');

      expect(stats.total).toBe(5);
      expect(stats.pending).toBe(1);
      expect(stats.matched).toBe(1);
      expect(stats.imported).toBe(2);
      expect(stats.rejected).toBe(1);
      expect(stats.autoMatchRate).toBe(60); // (1 matched + 2 imported) / 5 * 100
    });

    it('should return zero autoMatchRate when no records', async () => {
      mockPrisma.inboundNfe.findMany.mockResolvedValue([]);

      const stats = await service.getStats('co-1');

      expect(stats.total).toBe(0);
      expect(stats.autoMatchRate).toBe(0);
    });
  });
});
