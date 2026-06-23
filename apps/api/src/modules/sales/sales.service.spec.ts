import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SalesOrderStatus } from '@prisma/client';
import { SalesService } from './sales.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SALE_CONFIRMED_EVENT } from './events/sale-confirmed.event';
import { SALE_INVOICED_EVENT } from './events/sale-invoiced.event';

const mockPrisma = {
  salesOrder: {
    create: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  stockBalance: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  stockMovement: {
    create: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockEventEmitter = { emit: jest.fn() };

const baseOrder = {
  id: 'so-1',
  companyId: 'co-1',
  warehouseId: 'wh-1',
  status: SalesOrderStatus.DRAFT,
  items: [
    { id: 'si-1', productId: 'p-1', quantity: 5, unitPrice: 100 },
  ],
};

describe('SalesService', () => {
  let service: SalesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<SalesService>(SalesService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));
  });

  // ─── reserveOrder (S07.03) ────────────────────────────────────────────────

  describe('reserveOrder', () => {
    it('deve lançar NotFoundException quando OV não existe', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(null);
      await expect(service.reserveOrder('so-x', 'co-1', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('deve lançar BadRequestException quando OV não está em DRAFT', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.RESERVED,
      });
      await expect(service.reserveOrder('so-1', 'co-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException quando OV não tem itens', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({ ...baseOrder, items: [] });
      await expect(service.reserveOrder('so-1', 'co-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException quando estoque disponível é insuficiente', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(baseOrder);
      mockPrisma.stockBalance.findUnique.mockResolvedValue({ available: 3, reserved: 0 });

      await expect(service.reserveOrder('so-1', 'co-1', 'user-1')).rejects.toThrow(BadRequestException);
      await expect(service.reserveOrder('so-1', 'co-1', 'user-1')).rejects.toThrow(/insuficiente/);
    });

    it('deve lançar BadRequestException quando não há saldo cadastrado', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(baseOrder);
      mockPrisma.stockBalance.findUnique.mockResolvedValue(null);

      await expect(service.reserveOrder('so-1', 'co-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('deve reservar estoque e mudar status para RESERVED quando há saldo suficiente', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(baseOrder);
      mockPrisma.stockBalance.findUnique.mockResolvedValue({ available: 10, reserved: 0 });
      mockPrisma.stockBalance.update.mockResolvedValue({});
      const reservedOrder = { ...baseOrder, status: SalesOrderStatus.RESERVED, items: [], customer: null, warehouse: {} };
      mockPrisma.salesOrder.update.mockResolvedValue(reservedOrder);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.reserveOrder('so-1', 'co-1', 'user-1');

      expect(result.status).toBe(SalesOrderStatus.RESERVED);
      expect(mockPrisma.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { available: { decrement: 5 }, reserved: { increment: 5 } },
        }),
      );
    });
  });

  // ─── confirmOrder (S07.04a) — confirma e dispara picking ──────────────────

  describe('confirmOrder', () => {
    it('deve lançar NotFoundException quando OV não existe', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(null);
      await expect(service.confirmOrder('so-x', 'co-1', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('deve lançar BadRequestException quando OV não está RESERVED', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(baseOrder); // DRAFT
      await expect(service.confirmOrder('so-1', 'co-1', 'user-1')).rejects.toThrow(BadRequestException);
      await expect(service.confirmOrder('so-1', 'co-1', 'user-1')).rejects.toThrow(/RESERVADAS/);
    });

    it('deve mudar status para AWAITING_PICKING e emitir SALE_CONFIRMED_EVENT', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.RESERVED,
      });
      const confirmedOrder = {
        ...baseOrder,
        companyId: 'co-1',
        warehouseId: 'wh-1',
        status: SalesOrderStatus.AWAITING_PICKING,
        confirmedAt: new Date(),
        items: [{ productId: 'p-1', quantity: 5, unitPrice: 100 }],
        customer: null,
        warehouse: {},
      };
      mockPrisma.salesOrder.update.mockResolvedValue(confirmedOrder);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.confirmOrder('so-1', 'co-1', 'user-1');

      expect(result.status).toBe(SalesOrderStatus.AWAITING_PICKING);
      expect(mockPrisma.stockBalance.update).not.toHaveBeenCalled();
      expect(mockPrisma.stockMovement.create).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        SALE_CONFIRMED_EVENT,
        expect.objectContaining({ salesOrderId: 'so-1', warehouseId: 'wh-1' }),
      );
    });
  });

  // ─── markReadyToInvoice (S07.04a2) ───────────────────────────────────────

  describe('markReadyToInvoice', () => {
    it('deve lançar NotFoundException quando OV não existe', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(null);
      await expect(service.markReadyToInvoice('so-x')).rejects.toThrow(NotFoundException);
    });

    it('deve lançar BadRequestException quando OV não está AWAITING_PICKING', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.CONFIRMED,
      });
      await expect(service.markReadyToInvoice('so-1')).rejects.toThrow(BadRequestException);
    });

    it('deve mudar status para READY_TO_INVOICE com pickedAt', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.AWAITING_PICKING,
      });
      const readyOrder = {
        ...baseOrder,
        status: SalesOrderStatus.READY_TO_INVOICE,
        pickedAt: new Date(),
        items: [],
        customer: null,
        warehouse: {},
      };
      mockPrisma.salesOrder.update.mockResolvedValue(readyOrder);

      const result = await service.markReadyToInvoice('so-1');

      expect(result.status).toBe(SalesOrderStatus.READY_TO_INVOICE);
      expect(mockPrisma.salesOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SalesOrderStatus.READY_TO_INVOICE,
          }),
        }),
      );
    });
  });

  // ─── invoiceOrder (S07.04b) — baixa estoque após picking concluído ────────

  describe('invoiceOrder', () => {
    it('deve lançar BadRequestException quando OV não está READY_TO_INVOICE', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.AWAITING_PICKING,
        pickingOrder: null,
      });
      await expect(service.invoiceOrder('so-1', 'co-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException quando picking não está DONE', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.READY_TO_INVOICE,
        pickingOrder: { status: 'IN_PROGRESS' },
      });
      await expect(service.invoiceOrder('so-1', 'co-1', 'user-1')).rejects.toThrow(BadRequestException);
      await expect(service.invoiceOrder('so-1', 'co-1', 'user-1')).rejects.toThrow(/Picking não concluído/);
    });

    it('deve lançar BadRequestException quando não tem picking order', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.READY_TO_INVOICE,
        pickingOrder: null,
      });
      await expect(service.invoiceOrder('so-1', 'co-1', 'user-1')).rejects.toThrow(BadRequestException);
      await expect(service.invoiceOrder('so-1', 'co-1', 'user-1')).rejects.toThrow(/Picking não concluído/);
    });

    it('deve baixar reservado, criar StockMovement EXIT, mudar para INVOICED e emitir evento', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.READY_TO_INVOICE,
        pickingOrder: { status: 'DONE' },
      });
      mockPrisma.stockBalance.update.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue({});
      const invoicedOrder = {
        ...baseOrder,
        status: SalesOrderStatus.INVOICED,
        invoicedAt: new Date(),
        items: [{ productId: 'p-1', quantity: 5, unitPrice: 100 }],
        customer: null,
        warehouse: {},
      };
      mockPrisma.salesOrder.update.mockResolvedValue(invoicedOrder);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.invoiceOrder('so-1', 'co-1', 'user-1');

      expect(result.status).toBe(SalesOrderStatus.INVOICED);

      expect(mockPrisma.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { reserved: { decrement: 5 } } }),
      );

      expect(mockPrisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'EXIT', quantity: 5 }),
        }),
      );

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        SALE_INVOICED_EVENT,
        expect.objectContaining({ salesOrderId: 'so-1', warehouseId: 'wh-1' }),
      );
    });
  });

  // ─── returnOrder (S07.06) ─────────────────────────────────────────────────

  describe('returnOrder', () => {
    it('deve lançar BadRequestException quando OV não está INVOICED', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(baseOrder); // DRAFT
      await expect(
        service.returnOrder('so-1', 'co-1', { reason: 'Defeito' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve criar StockMovement IN e mudar status para RETURNED', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.INVOICED,
      });
      mockPrisma.stockBalance.update.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue({});
      const returnedOrder = { ...baseOrder, status: SalesOrderStatus.RETURNED, items: [], customer: null, warehouse: {} };
      mockPrisma.salesOrder.update.mockResolvedValue(returnedOrder);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.returnOrder('so-1', 'co-1', { reason: 'Produto com defeito' }, 'user-1');

      expect(result.status).toBe(SalesOrderStatus.RETURNED);

      expect(mockPrisma.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { available: { increment: 5 } } }),
      );

      expect(mockPrisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'ENTRY', quantity: 5 }),
        }),
      );
    });
  });

  // ─── cancelOrder (S07.05) ─────────────────────────────────────────────────

  describe('cancelOrder', () => {
    it('deve lançar BadRequestException para OV INVOICED (usar devolução)', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.INVOICED,
      });
      await expect(service.cancelOrder('so-1', 'co-1', 'user-1')).rejects.toThrow(BadRequestException);
      await expect(service.cancelOrder('so-1', 'co-1', 'user-1')).rejects.toThrow(/devolução/);
    });

    it('deve lançar BadRequestException para OV já cancelada', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.CANCELLED,
      });
      await expect(service.cancelOrder('so-1', 'co-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('deve cancelar OV em DRAFT sem alterar estoque', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(baseOrder);
      const cancelled = { ...baseOrder, status: SalesOrderStatus.CANCELLED, items: [], customer: null, warehouse: {} };
      mockPrisma.salesOrder.update.mockResolvedValue(cancelled);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.cancelOrder('so-1', 'co-1', 'user-1');
      expect(result.status).toBe(SalesOrderStatus.CANCELLED);
      expect(mockPrisma.stockBalance.update).not.toHaveBeenCalled();
    });

    it('deve devolver reservado para disponível ao cancelar OV RESERVED', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.RESERVED,
      });
      mockPrisma.stockBalance.update.mockResolvedValue({});
      const cancelled = { ...baseOrder, status: SalesOrderStatus.CANCELLED, items: [], customer: null, warehouse: {} };
      mockPrisma.salesOrder.update.mockResolvedValue(cancelled);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.cancelOrder('so-1', 'co-1', 'user-1');

      expect(result.status).toBe(SalesOrderStatus.CANCELLED);
      expect(mockPrisma.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { reserved: { decrement: 5 }, available: { increment: 5 } },
        }),
      );
    });

    it('deve devolver reservado para disponível ao cancelar OV AWAITING_PICKING', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.AWAITING_PICKING,
      });
      mockPrisma.stockBalance.update.mockResolvedValue({});
      const cancelled = { ...baseOrder, status: SalesOrderStatus.CANCELLED, items: [], customer: null, warehouse: {} };
      mockPrisma.salesOrder.update.mockResolvedValue(cancelled);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.cancelOrder('so-1', 'co-1', 'user-1');

      expect(result.status).toBe(SalesOrderStatus.CANCELLED);
      expect(mockPrisma.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { reserved: { decrement: 5 }, available: { increment: 5 } },
        }),
      );
    });

    it('deve devolver reservado para disponível ao cancelar OV READY_TO_INVOICE', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.READY_TO_INVOICE,
      });
      mockPrisma.stockBalance.update.mockResolvedValue({});
      const cancelled = { ...baseOrder, status: SalesOrderStatus.CANCELLED, items: [], customer: null, warehouse: {} };
      mockPrisma.salesOrder.update.mockResolvedValue(cancelled);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.cancelOrder('so-1', 'co-1', 'user-1');

      expect(result.status).toBe(SalesOrderStatus.CANCELLED);
      expect(mockPrisma.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { reserved: { decrement: 5 }, available: { increment: 5 } },
        }),
      );
    });
  });
});
