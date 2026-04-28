import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SalesOrderStatus } from '@prisma/client';
import { SalesService } from './sales.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SALE_CONFIRMED_EVENT } from './events/sale-confirmed.event';

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

    // S07.03: critério de aceite — estoque insuficiente bloqueia reserva
    it('deve lançar BadRequestException quando estoque disponível é insuficiente', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(baseOrder);
      mockPrisma.stockBalance.findUnique.mockResolvedValue({ available: 3, reserved: 0 }); // < 5

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
      // disponível decrementado, reservado incrementado
      expect(mockPrisma.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { available: { decrement: 5 }, reserved: { increment: 5 } },
        }),
      );
    });
  });

  // ─── confirmOrder (S07.04) ────────────────────────────────────────────────

  describe('confirmOrder', () => {
    it('deve lançar BadRequestException quando OV não está RESERVED', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(baseOrder); // DRAFT
      await expect(service.confirmOrder('so-1', 'co-1', 'user-1')).rejects.toThrow(BadRequestException);
      await expect(service.confirmOrder('so-1', 'co-1', 'user-1')).rejects.toThrow(/RESERVADAS/);
    });

    it('deve baixar estoque reservado, criar StockMovement EXIT e emitir evento', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.RESERVED,
      });
      mockPrisma.stockBalance.update.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue({});
      const confirmedOrder = {
        ...baseOrder,
        status: SalesOrderStatus.CONFIRMED,
        confirmedAt: new Date(),
        items: [{ productId: 'p-1', quantity: 5, unitPrice: 100 }],
        customer: null,
        warehouse: {},
      };
      mockPrisma.salesOrder.update.mockResolvedValue(confirmedOrder);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.confirmOrder('so-1', 'co-1', 'user-1');

      expect(result.status).toBe(SalesOrderStatus.CONFIRMED);

      // reservado decrementado
      expect(mockPrisma.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { reserved: { decrement: 5 } } }),
      );

      // movimento EXIT criado
      expect(mockPrisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'EXIT', quantity: 5 }),
        }),
      );

      // evento emitido após commit
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        SALE_CONFIRMED_EVENT,
        expect.objectContaining({ salesOrderId: 'so-1', warehouseId: 'wh-1' }),
      );
    });
  });

  // ─── cancelOrder (S07.05) ─────────────────────────────────────────────────

  describe('cancelOrder', () => {
    it('deve lançar BadRequestException para OV já confirmada', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.CONFIRMED,
      });
      await expect(service.cancelOrder('so-1', 'co-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException para OV já cancelada', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.CANCELLED,
      });
      await expect(service.cancelOrder('so-1', 'co-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('deve cancelar OV em DRAFT sem alterar estoque', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(baseOrder); // DRAFT
      const cancelled = { ...baseOrder, status: SalesOrderStatus.CANCELLED, items: [], customer: null, warehouse: {} };
      mockPrisma.salesOrder.update.mockResolvedValue(cancelled);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.cancelOrder('so-1', 'co-1', 'user-1');
      expect(result.status).toBe(SalesOrderStatus.CANCELLED);
      expect(mockPrisma.stockBalance.update).not.toHaveBeenCalled();
    });

    // S07.05: critério de aceite — cancelamento restaura saldo
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
      // reservado decrementado e disponível incrementado
      expect(mockPrisma.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { reserved: { decrement: 5 }, available: { increment: 5 } },
        }),
      );
    });
  });
});
