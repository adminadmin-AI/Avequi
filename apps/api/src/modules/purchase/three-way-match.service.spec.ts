import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThreeWayMatchService } from './three-way-match.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  purchaseOrder: {
    findFirst: jest.fn(),
  },
  threeWayMatch: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const buildPO = (overrides: any = {}) => ({
  id: 'po-1',
  companyId: 'co-1',
  items: [
    {
      id: 'poi-1',
      productId: 'p-1',
      quantity: 100,
      unitCost: 50,
      product: { id: 'p-1', name: 'Eixo', ncm: '87089990' },
    },
    {
      id: 'poi-2',
      productId: 'p-2',
      quantity: 200,
      unitCost: 25,
      product: { id: 'p-2', name: 'Parafuso', ncm: '73181500' },
    },
  ],
  receipts: [
    {
      items: [
        { productId: 'p-1', qtyOrdered: 100, qtyReceived: 100 },
        { productId: 'p-2', qtyOrdered: 200, qtyReceived: 200 },
      ],
    },
  ],
  inboundNfes: [
    {
      id: 'nfe-1',
      status: 'MATCHED',
      parsedItems: [
        { ncm: '87089990', description: 'Eixo', quantity: 100, unitPrice: 50, totalPrice: 5000, cfop: '1102', ean: 'SEM GTIN' },
        { ncm: '73181500', description: 'Parafuso', quantity: 200, unitPrice: 25, totalPrice: 5000, cfop: '1102', ean: 'SEM GTIN' },
      ],
    },
  ],
  ...overrides,
});

describe('ThreeWayMatchService', () => {
  let service: ThreeWayMatchService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreeWayMatchService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ThreeWayMatchService>(ThreeWayMatchService);
    jest.clearAllMocks();
  });

  describe('executeMatch', () => {
    it('deve retornar FULL_MATCH quando PO=GR=NF-e', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue(buildPO());

      const result = await service.executeMatch('po-1', 'co-1');

      expect(result.result).toBe('FULL_MATCH');
      expect(result.summary.fullMatchCount).toBe(2);
      expect(result.summary.mismatchCount).toBe(0);
      expect(result.details).toHaveLength(2);
      expect(result.details[0].qtyMatch).toBe('OK');
      expect(result.details[0].priceMatch).toBe('OK');
    });

    it('deve retornar MISMATCH quando GR qty diverge do PO', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue(
        buildPO({
          receipts: [
            {
              items: [
                { productId: 'p-1', qtyOrdered: 100, qtyReceived: 95 },
                { productId: 'p-2', qtyOrdered: 200, qtyReceived: 200 },
              ],
            },
          ],
        }),
      );

      const result = await service.executeMatch('po-1', 'co-1');

      expect(result.result).toBe('MISMATCH');
      expect(result.details[0].qtyMatch).toBe('MISMATCH');
      expect(result.details[0].qtyVariancePct).toBe(5);
    });

    it('deve retornar MISMATCH quando preço NF-e diverge >2% do PO', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue(
        buildPO({
          inboundNfes: [
            {
              id: 'nfe-1',
              status: 'MATCHED',
              parsedItems: [
                { ncm: '87089990', quantity: 100, unitPrice: 55, totalPrice: 5500 },
                { ncm: '73181500', quantity: 200, unitPrice: 25, totalPrice: 5000 },
              ],
            },
          ],
        }),
      );

      const result = await service.executeMatch('po-1', 'co-1');

      expect(result.result).toBe('MISMATCH');
      expect(result.details[0].priceMatch).toBe('MISMATCH');
      expect(result.details[0].priceVariancePct).toBe(10);
    });

    it('deve retornar PARTIAL_MATCH quando divergência dentro da tolerância', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue(
        buildPO({
          inboundNfes: [
            {
              id: 'nfe-1',
              status: 'MATCHED',
              parsedItems: [
                { ncm: '87089990', quantity: 100, unitPrice: 50.5, totalPrice: 5050 },
                { ncm: '73181500', quantity: 200, unitPrice: 25, totalPrice: 5000 },
              ],
            },
          ],
        }),
      );

      const result = await service.executeMatch('po-1', 'co-1', { priceTolerancePct: 2 });

      expect(result.result).toBe('PARTIAL_MATCH');
      expect(result.details[0].priceMatch).toBe('TOLERANCE');
    });

    it('deve retornar FULL_MATCH sem NF-e quando PO=GR', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue(
        buildPO({ inboundNfes: [] }),
      );

      const result = await service.executeMatch('po-1', 'co-1');

      expect(result.result).toBe('FULL_MATCH');
      expect(result.summary.totalNfeValue).toBeNull();
      expect(result.details[0].priceMatch).toBe('N/A');
    });

    it('deve lançar NotFoundException quando PO não existe', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue(null);
      await expect(service.executeMatch('po-x', 'co-1')).rejects.toThrow(NotFoundException);
    });

    it('deve agregar múltiplos GoodsReceipts', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue(
        buildPO({
          receipts: [
            { items: [{ productId: 'p-1', qtyReceived: 60 }, { productId: 'p-2', qtyReceived: 100 }] },
            { items: [{ productId: 'p-1', qtyReceived: 40 }, { productId: 'p-2', qtyReceived: 100 }] },
          ],
        }),
      );

      const result = await service.executeMatch('po-1', 'co-1');

      expect(result.result).toBe('FULL_MATCH');
      expect(result.details[0].grQty).toBe(100);
      expect(result.details[1].grQty).toBe(200);
    });
  });

  describe('getMatchStatus', () => {
    it('deve retornar live match + saved match quando existe', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue(buildPO());
      mockPrisma.threeWayMatch.findFirst.mockResolvedValue({
        id: 'match-1',
        result: 'FULL_MATCH',
        resolvedBy: { id: 'u1', name: 'Admin' },
        resolvedAt: new Date(),
        createdAt: new Date(),
      });

      const result = await service.getMatchStatus('po-1', 'co-1');

      expect(result.result).toBe('FULL_MATCH');
      expect(result.savedMatch).not.toBeNull();
      expect(result.savedMatch!.id).toBe('match-1');
    });
  });
});
