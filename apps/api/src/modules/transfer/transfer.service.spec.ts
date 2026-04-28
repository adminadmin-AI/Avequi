import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TransferStatus } from '@prisma/client';
import { TransferService } from './transfer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TRANSFER_DISPATCHED_EVENT } from './events/transfer-dispatched.event';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  storeTransfer: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  stockBalance: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  },
  stockMovement: { create: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn(),
};

const mockEventEmitter = { emit: jest.fn() };

const baseTransfer = {
  id: 'tr-1',
  companyId: 'co-1',
  fromWarehouseId: 'wh-factory',
  toWarehouseId: 'wh-store',
  status: TransferStatus.DRAFT,
  items: [
    {
      id: 'ti-1',
      productId: 'p-1',
      quantity: '10',
      unit: 'UN',
      product: {
        id: 'p-1',
        sku: 'SKU01',
        name: 'Bolsa Premium',
        ncm: '42022900',
        unit: 'UN',
        avgCost: '250',
        costPrice: '250',
      },
    },
  ],
};

describe('TransferService', () => {
  let service: TransferService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransferService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<TransferService>(TransferService);
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});

    // Simular $transaction executando o callback diretamente
    mockPrisma.$transaction.mockImplementation((cb: any) =>
      cb({
        stockBalance: mockPrisma.stockBalance,
        stockMovement: mockPrisma.stockMovement,
        storeTransfer: mockPrisma.storeTransfer,
        auditLog: mockPrisma.auditLog,
      }),
    );
  });

  // ─── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    it('deve criar transferência em DRAFT', async () => {
      mockPrisma.storeTransfer.create.mockResolvedValue({ ...baseTransfer });

      const result = await service.create(
        {
          companyId: 'co-1',
          fromWarehouseId: 'wh-factory',
          toWarehouseId: 'wh-store',
          items: [{ productId: 'p-1', quantity: 10 }],
        },
        'u-1',
      );

      expect(result.status).toBe(TransferStatus.DRAFT);
      expect(mockPrisma.storeTransfer.create).toHaveBeenCalled();
    });

    it('deve rejeitar se origem e destino são iguais', async () => {
      await expect(
        service.create(
          {
            companyId: 'co-1',
            fromWarehouseId: 'wh-same',
            toWarehouseId: 'wh-same',
            items: [{ productId: 'p-1', quantity: 1 }],
          },
          'u-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── dispatch ─────────────────────────────────────────────────────────────

  describe('dispatch', () => {
    it('deve despachar, atualizar saldos e emitir evento', async () => {
      mockPrisma.storeTransfer.findFirst.mockResolvedValue(baseTransfer);
      mockPrisma.stockBalance.findUnique.mockResolvedValue({ available: '20', reserved: '0', inTransit: '0' });
      mockPrisma.stockBalance.upsert.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue({});
      mockPrisma.storeTransfer.update.mockResolvedValue({ ...baseTransfer, status: TransferStatus.DISPATCHED });

      await service.dispatch('tr-1', 'co-1', 'u-1');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.stockBalance.upsert).toHaveBeenCalledTimes(2); // origem + destino
      expect(mockPrisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'TRANSFER_OUT' }) }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        TRANSFER_DISPATCHED_EVENT,
        expect.objectContaining({ storeTransferId: 'tr-1' }),
      );
    });

    it('deve lançar BadRequestException quando saldo é insuficiente', async () => {
      mockPrisma.storeTransfer.findFirst.mockResolvedValue(baseTransfer);
      mockPrisma.stockBalance.findUnique.mockResolvedValue({ available: '5', reserved: '0', inTransit: '0' });

      await expect(service.dispatch('tr-1', 'co-1', 'u-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('deve lançar BadRequestException se status não é DRAFT', async () => {
      mockPrisma.storeTransfer.findFirst.mockResolvedValue({
        ...baseTransfer,
        status: TransferStatus.DISPATCHED,
      });

      await expect(service.dispatch('tr-1', 'co-1', 'u-1')).rejects.toThrow(BadRequestException);
    });

    it('deve lançar NotFoundException para transferência inexistente', async () => {
      mockPrisma.storeTransfer.findFirst.mockResolvedValue(null);
      await expect(service.dispatch('tr-x', 'co-1', 'u-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── receive ──────────────────────────────────────────────────────────────

  describe('receive', () => {
    it('deve confirmar recebimento: inTransit → available', async () => {
      mockPrisma.storeTransfer.findFirst.mockResolvedValue({
        ...baseTransfer,
        status: TransferStatus.DISPATCHED,
      });
      mockPrisma.stockBalance.update.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue({});
      mockPrisma.storeTransfer.update.mockResolvedValue({ ...baseTransfer, status: TransferStatus.RECEIVED });

      await service.receive('tr-1', 'co-1', 'u-1');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            inTransit: { decrement: 10 },
            available: { increment: 10 },
          }),
        }),
      );
      expect(mockPrisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'TRANSFER_IN' }) }),
      );
    });

    it('deve lançar BadRequestException se status não é DISPATCHED', async () => {
      mockPrisma.storeTransfer.findFirst.mockResolvedValue(baseTransfer); // DRAFT

      await expect(service.receive('tr-1', 'co-1', 'u-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── cancel ───────────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('deve cancelar DRAFT sem alterar estoque', async () => {
      mockPrisma.storeTransfer.findFirst.mockResolvedValue(baseTransfer);
      mockPrisma.storeTransfer.update.mockResolvedValue({ ...baseTransfer, status: TransferStatus.CANCELLED });

      await service.cancel('tr-1', 'co-1', 'u-1');

      expect(mockPrisma.stockBalance.update).not.toHaveBeenCalled();
    });

    it('deve reverter estoque ao cancelar DISPATCHED', async () => {
      mockPrisma.storeTransfer.findFirst.mockResolvedValue({
        ...baseTransfer,
        status: TransferStatus.DISPATCHED,
      });
      mockPrisma.stockBalance.update.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue({});
      mockPrisma.storeTransfer.update.mockResolvedValue({ ...baseTransfer, status: TransferStatus.CANCELLED });

      await service.cancel('tr-1', 'co-1', 'u-1');

      // 2 updates de balance (origem + destino) + 1 movement REVERSAL
      expect(mockPrisma.stockBalance.update).toHaveBeenCalledTimes(2);
      expect(mockPrisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'REVERSAL' }) }),
      );
    });

    it('deve lançar BadRequestException para transferência RECEIVED', async () => {
      mockPrisma.storeTransfer.findFirst.mockResolvedValue({
        ...baseTransfer,
        status: TransferStatus.RECEIVED,
      });
      await expect(service.cancel('tr-1', 'co-1', 'u-1')).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException para transferência já CANCELLED', async () => {
      mockPrisma.storeTransfer.findFirst.mockResolvedValue({
        ...baseTransfer,
        status: TransferStatus.CANCELLED,
      });
      await expect(service.cancel('tr-1', 'co-1', 'u-1')).rejects.toThrow(BadRequestException);
    });
  });
});
