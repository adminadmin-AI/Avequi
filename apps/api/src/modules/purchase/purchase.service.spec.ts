import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PurchaseOrderStatus } from '@prisma/client';
import { PurchaseService } from './purchase.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GOODS_RECEIVED_EVENT } from '../stock/events/goods-received.event';

const mockPrisma = {
  purchaseOrder: {
    create: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  pOItem: {
    count: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  goodsReceipt: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  stockBalance: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    aggregate: jest.fn(),
  },
  stockMovement: {
    create: jest.fn(),
  },
  product: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  supplierPriceHistory: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  purchaseRequest: {
    create: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  warehouse: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockEventEmitter = {
  emit: jest.fn(),
};

const basePO = {
  id: 'po-1',
  companyId: 'co-1',
  supplierId: 'sup-1',
  status: PurchaseOrderStatus.DRAFT,
  items: [
    { id: 'poi-1', productId: 'p-1', quantity: 10, unitCost: 5, receivedQuantity: 0 },
  ],
};

describe('PurchaseService', () => {
  let service: PurchaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<PurchaseService>(PurchaseService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));
    // S17: default sem WMS para não quebrar testes existentes
    mockPrisma.warehouse.findUnique.mockResolvedValue({ wmsEnabled: false });
    // #190: defaults for partial receiving
    mockPrisma.pOItem.update.mockResolvedValue({});
    mockPrisma.pOItem.findMany.mockResolvedValue([
      { id: 'poi-1', quantity: 10, receivedQuantity: 10 },
    ]);
  });

  // ─── approvePO ────────────────────────────────────────────────────────────

  describe('approvePO', () => {
    it('deve lançar ForbiddenException para usuário sem permissão de aprovação', async () => {
      await expect(
        service.approvePO('po-1', 'co-1', 'user-1', 'STORE'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar ForbiddenException para perfil WAREHOUSE', async () => {
      await expect(
        service.approvePO('po-1', 'co-1', 'user-1', 'WAREHOUSE'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar NotFoundException quando PO não existe', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue(null);
      await expect(
        service.approvePO('po-x', 'co-1', 'user-1', 'DIRECTOR'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deve lançar BadRequestException quando PO não está em DRAFT', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        ...basePO,
        status: PurchaseOrderStatus.APPROVED,
      });
      await expect(
        service.approvePO('po-1', 'co-1', 'user-1', 'DIRECTOR'),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException para PO sem itens', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({ ...basePO, items: undefined });
      mockPrisma.pOItem.count.mockResolvedValue(0);
      await expect(
        service.approvePO('po-1', 'co-1', 'user-1', 'MANAGER'),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve aprovar PO em DRAFT com itens (DIRECTOR)', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue(basePO);
      mockPrisma.pOItem.count.mockResolvedValue(1);
      const approvedPO = { ...basePO, status: PurchaseOrderStatus.APPROVED, approvedById: 'user-1' };
      mockPrisma.purchaseOrder.update.mockResolvedValue(approvedPO);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.approvePO('po-1', 'co-1', 'user-1', 'DIRECTOR');
      expect(result.status).toBe(PurchaseOrderStatus.APPROVED);
      expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: PurchaseOrderStatus.APPROVED }),
        }),
      );
    });

    it('deve aprovar PO com MANAGER', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue(basePO);
      mockPrisma.pOItem.count.mockResolvedValue(2);
      mockPrisma.purchaseOrder.update.mockResolvedValue({ ...basePO, status: PurchaseOrderStatus.APPROVED });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.approvePO('po-1', 'co-1', 'user-2', 'MANAGER');
      expect(result.status).toBe(PurchaseOrderStatus.APPROVED);
    });
  });

  // ─── cancelPO ────────────────────────────────────────────────────────────

  describe('cancelPO', () => {
    it('deve cancelar PO em DRAFT', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue(basePO);
      mockPrisma.purchaseOrder.update.mockResolvedValue({ ...basePO, status: PurchaseOrderStatus.CANCELLED });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.cancelPO('po-1', 'co-1', 'user-1');
      expect(result.status).toBe(PurchaseOrderStatus.CANCELLED);
    });

    it('deve lançar BadRequestException para PO já recebida', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        ...basePO,
        status: PurchaseOrderStatus.RECEIVED,
      });
      await expect(service.cancelPO('po-1', 'co-1', 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── createReceipt (S05.04 + S06) ────────────────────────────────────────

  describe('createReceipt', () => {
    it('deve rejeitar recebimento de PO não aprovada (DRAFT)', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(basePO);

      await expect(
        service.createReceipt(
          { purchaseOrderId: 'po-1', warehouseId: 'wh-1', items: [] },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createReceipt(
          { purchaseOrderId: 'po-1', warehouseId: 'wh-1', items: [] },
          'user-1',
        ),
      ).rejects.toThrow(/APROVADOS|PARCIALMENTE/);
    });

    it('deve rejeitar recebimento de PO cancelada', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...basePO,
        status: PurchaseOrderStatus.CANCELLED,
      });

      await expect(
        service.createReceipt(
          { purchaseOrderId: 'po-1', warehouseId: 'wh-1', items: [] },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve rejeitar item de PO inexistente no pedido', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...basePO,
        status: PurchaseOrderStatus.APPROVED,
      });

      await expect(
        service.createReceipt(
          {
            purchaseOrderId: 'po-1',
            warehouseId: 'wh-1',
            items: [{ poItemId: 'poi-inexistente', qtyReceived: 5 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('deve rejeitar divergência de quantidade sem motivo obrigatório', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...basePO,
        status: PurchaseOrderStatus.APPROVED,
      });

      await expect(
        service.createReceipt(
          {
            purchaseOrderId: 'po-1',
            warehouseId: 'wh-1',
            items: [{ poItemId: 'poi-1', qtyReceived: 7 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(/motivo obrigatório/);
    });

    // S06.02 + S06.03: estoque atualizado e custo médio recalculado
    it('deve criar entrada no estoque, recalcular avgCost e emitir evento', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...basePO,
        status: PurchaseOrderStatus.APPROVED,
      });

      const receipt = {
        id: 'gr-2',
        companyId: 'co-1',
        purchaseOrderId: 'po-1',
        warehouseId: 'wh-1',
        items: [],
        warehouse: {},
      };
      mockPrisma.goodsReceipt.create.mockResolvedValue(receipt);
      mockPrisma.stockBalance.findUnique.mockResolvedValue({ id: 'bal-1', available: 5, reserved: 0 });
      mockPrisma.stockBalance.aggregate.mockResolvedValue({ _sum: { available: 5 } });
      mockPrisma.product.findUnique.mockResolvedValue({ avgCost: 8, costPrice: 6 });
      mockPrisma.product.update.mockResolvedValue({});
      mockPrisma.stockBalance.update.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue({});
      mockPrisma.purchaseOrder.update.mockResolvedValue({
        ...basePO,
        status: PurchaseOrderStatus.RECEIVED,
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.createReceipt(
        {
          purchaseOrderId: 'po-1',
          warehouseId: 'wh-1',
          items: [{ poItemId: 'poi-1', qtyReceived: 10 }],
        },
        'user-1',
      );

      expect(result.id).toBe('gr-2');

      // S06.02: movimento de entrada criado
      expect(mockPrisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'ENTRY', quantity: 10 }),
        }),
      );

      // S06.02: saldo incrementado
      expect(mockPrisma.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { available: { increment: 10 } },
        }),
      );

      // S06.03: produto atualizado com novo avgCost
      // prevQty=5 @ avgCost=8, incoming=10 @ unitCost=5 → (5*8 + 10*5) / 15 = 90/15 = 6.00
      expect(mockPrisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p-1' },
          data: expect.objectContaining({ avgCost: expect.any(Number) }),
        }),
      );

      // S06.01: evento emitido após transação
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        GOODS_RECEIVED_EVENT,
        expect.objectContaining({
          purchaseOrderId: 'po-1',
          goodsReceiptId: 'gr-2',
          warehouseId: 'wh-1',
        }),
      );

      // PO marcada como RECEIVED
      expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: PurchaseOrderStatus.RECEIVED },
        }),
      );
    });

    // S06.03: custo médio zero quando saldo anterior é zero (primeiro recebimento)
    it('deve usar custo unitário como avgCost no primeiro recebimento (saldo zero)', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...basePO,
        status: PurchaseOrderStatus.APPROVED,
      });

      const receipt = {
        id: 'gr-3',
        companyId: 'co-1',
        purchaseOrderId: 'po-1',
        warehouseId: 'wh-1',
        items: [],
        warehouse: {},
      };
      mockPrisma.goodsReceipt.create.mockResolvedValue(receipt);
      mockPrisma.stockBalance.findUnique.mockResolvedValue(null);
      mockPrisma.stockBalance.create.mockResolvedValue({ id: 'bal-new', available: 0 });
      mockPrisma.stockBalance.aggregate.mockResolvedValue({ _sum: { available: null } }); // sem saldo anterior
      mockPrisma.product.findUnique.mockResolvedValue({ avgCost: null, costPrice: null });
      mockPrisma.product.update.mockResolvedValue({});
      mockPrisma.stockBalance.update.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue({});
      mockPrisma.purchaseOrder.update.mockResolvedValue({ ...basePO, status: PurchaseOrderStatus.RECEIVED });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.createReceipt(
        {
          purchaseOrderId: 'po-1',
          warehouseId: 'wh-1',
          items: [{ poItemId: 'poi-1', qtyReceived: 10 }],
        },
        'user-1',
      );

      // No primeiro recebimento: prevQty=0, prevAvgCost=0, qty=10, unitCost=5 → avgCost=5
      expect(mockPrisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { avgCost: 5 },
        }),
      );
    });

    it('deve aceitar divergência com motivo informado', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        ...basePO,
        status: PurchaseOrderStatus.APPROVED,
      });

      const receipt = { id: 'gr-1', companyId: 'co-1', purchaseOrderId: 'po-1', warehouseId: 'wh-1', items: [], warehouse: { id: 'wh-1', name: 'Geral' } };
      mockPrisma.goodsReceipt.create.mockResolvedValue(receipt);
      mockPrisma.stockBalance.findUnique.mockResolvedValue(null);
      mockPrisma.stockBalance.create.mockResolvedValue({ id: 'bal-1', available: 0 });
      mockPrisma.stockBalance.aggregate.mockResolvedValue({ _sum: { available: null } });
      mockPrisma.product.findUnique.mockResolvedValue({ avgCost: null, costPrice: null });
      mockPrisma.product.update.mockResolvedValue({});
      mockPrisma.stockBalance.update.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue({});
      mockPrisma.purchaseOrder.update.mockResolvedValue({ ...basePO, status: PurchaseOrderStatus.RECEIVED });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.createReceipt(
        {
          purchaseOrderId: 'po-1',
          warehouseId: 'wh-1',
          items: [
            { poItemId: 'poi-1', qtyReceived: 7, divergenceReason: 'Transportadora danificou 3 unidades' },
          ],
        },
        'user-1',
      );

      expect(result).toEqual(receipt);
      expect(mockPrisma.goodsReceipt.create).toHaveBeenCalled();
    });
  });

  // ─── #190: Recebimento parcial ─────────────────────────────────────────────

  describe('createReceipt — partial receiving (#190)', () => {
    const approvedPO = {
      ...basePO,
      status: PurchaseOrderStatus.APPROVED,
      items: [
        { id: 'poi-1', productId: 'p-1', quantity: 100, unitCost: 5, receivedQuantity: 0 },
      ],
    };

    const setupReceiptMocks = () => {
      const receipt = {
        id: 'gr-p1',
        companyId: 'co-1',
        purchaseOrderId: 'po-1',
        warehouseId: 'wh-1',
        items: [],
        warehouse: {},
      };
      mockPrisma.goodsReceipt.create.mockResolvedValue(receipt);
      mockPrisma.stockBalance.findUnique.mockResolvedValue({ id: 'bal-1', available: 0 });
      mockPrisma.stockBalance.aggregate.mockResolvedValue({ _sum: { available: 0 } });
      mockPrisma.product.findUnique.mockResolvedValue({ avgCost: null, costPrice: null });
      mockPrisma.product.update.mockResolvedValue({});
      mockPrisma.stockBalance.update.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue({});
      mockPrisma.purchaseOrder.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});
      return receipt;
    };

    it('PO 100 un, recebe 60 → PARTIALLY_RECEIVED', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(approvedPO);
      setupReceiptMocks();
      // After receiving 60, only 60 of 100 received
      mockPrisma.pOItem.findMany.mockResolvedValue([
        { id: 'poi-1', quantity: 100, receivedQuantity: 60 },
      ]);

      await service.createReceipt(
        {
          purchaseOrderId: 'po-1',
          warehouseId: 'wh-1',
          items: [{ poItemId: 'poi-1', qtyReceived: 60, divergenceReason: 'Entrega parcial' }],
        },
        'user-1',
      );

      // receivedQuantity incrementado
      expect(mockPrisma.pOItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'poi-1' },
          data: { receivedQuantity: { increment: 60 } },
        }),
      );

      // Status → PARTIALLY_RECEIVED
      expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'PARTIALLY_RECEIVED' },
        }),
      );
    });

    it('PO parcialmente recebida (60/100), recebe mais 40 → RECEIVED', async () => {
      const partialPO = {
        ...approvedPO,
        status: 'PARTIALLY_RECEIVED' as PurchaseOrderStatus,
        items: [
          { id: 'poi-1', productId: 'p-1', quantity: 100, unitCost: 5, receivedQuantity: 60 },
        ],
      };
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(partialPO);
      setupReceiptMocks();
      // After receiving 40 more, 100 of 100 received
      mockPrisma.pOItem.findMany.mockResolvedValue([
        { id: 'poi-1', quantity: 100, receivedQuantity: 100 },
      ]);

      await service.createReceipt(
        {
          purchaseOrderId: 'po-1',
          warehouseId: 'wh-1',
          items: [{ poItemId: 'poi-1', qtyReceived: 40 }],
        },
        'user-1',
      );

      // Status → RECEIVED (fully received)
      expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: PurchaseOrderStatus.RECEIVED },
        }),
      );
    });

    it('deve rejeitar recebimento acima do pendente', async () => {
      const partialPO = {
        ...approvedPO,
        status: 'PARTIALLY_RECEIVED' as PurchaseOrderStatus,
        items: [
          { id: 'poi-1', productId: 'p-1', quantity: 100, unitCost: 5, receivedQuantity: 80 },
        ],
      };
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(partialPO);

      await expect(
        service.createReceipt(
          {
            purchaseOrderId: 'po-1',
            warehouseId: 'wh-1',
            items: [{ poItemId: 'poi-1', qtyReceived: 30 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(/excede o pendente/);
    });
  });

  // ─── getReceivingStatus (#190) ────────────────────────────────────────────

  describe('getReceivingStatus', () => {
    it('deve retornar status de recebimento por item', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        companyId: 'co-1',
        status: 'PARTIALLY_RECEIVED',
        items: [
          { id: 'poi-1', product: { id: 'p-1', name: 'Aço', sku: 'ACO-01' }, quantity: 100, receivedQuantity: 60 },
          { id: 'poi-2', product: { id: 'p-2', name: 'Parafuso', sku: 'PAR-01' }, quantity: 50, receivedQuantity: 50 },
        ],
      });

      const result = await service.getReceivingStatus('po-1', 'co-1');
      expect(result.allFullyReceived).toBe(false);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].pendingQty).toBe(40);
      expect(result.items[0].fullyReceived).toBe(false);
      expect(result.items[1].pendingQty).toBe(0);
      expect(result.items[1].fullyReceived).toBe(true);
    });
  });

  // ─── updatePO ─────────────────────────────────────────────────────────────

  describe('updatePO', () => {
    it('deve lançar BadRequestException ao tentar editar PO aprovada', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        ...basePO,
        status: PurchaseOrderStatus.APPROVED,
      });
      await expect(
        service.updatePO('po-1', { notes: 'nova nota' }, 'co-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
