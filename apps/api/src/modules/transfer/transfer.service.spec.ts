import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SerialStatus, TransferStatus } from '@prisma/client';
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
  serialNumber: { findMany: jest.fn(), updateMany: jest.fn() },
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
    mockPrisma.serialNumber.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.serialNumber.findMany.mockResolvedValue([]);

    // Simular $transaction executando o callback diretamente
    mockPrisma.$transaction.mockImplementation((cb: any) =>
      cb({
        stockBalance: mockPrisma.stockBalance,
        stockMovement: mockPrisma.stockMovement,
        serialNumber: mockPrisma.serialNumber,
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
          fromWarehouseId: 'wh-factory',
          toWarehouseId: 'wh-store',
          items: [{ productId: 'p-1', quantity: 10 }],
        },
        'co-1',
        'u-1',
      );

      expect(result.status).toBe(TransferStatus.DRAFT);
      expect(mockPrisma.storeTransfer.create).toHaveBeenCalled();
    });

    it('deve rejeitar se origem e destino são iguais', async () => {
      await expect(
        service.create(
          {
            fromWarehouseId: 'wh-same',
            toWarehouseId: 'wh-same',
            items: [{ productId: 'p-1', quantity: 1 }],
          },
          'co-1',
          'u-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('IDOR: ignora companyId externo injetado no payload e usa o do JWT', async () => {
      mockPrisma.storeTransfer.create.mockResolvedValue({ ...baseTransfer });

      await service.create(
        {
          companyId: 'co-VITIMA',
          fromWarehouseId: 'wh-factory',
          toWarehouseId: 'wh-store',
          items: [{ productId: 'p-1', quantity: 10 }],
        } as any,
        'co-1',
        'u-1',
      );

      const createArg = mockPrisma.storeTransfer.create.mock.calls[0][0];
      expect(createArg.data.companyId).toBe('co-1');
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

  // ─── #628: movimentação de chassis (SerialNumber) na transferência ─────────

  describe('movimentação de chassis (#628)', () => {
    // Transferência de produto rastreável (reboque) — 2 unidades
    const serialTransfer = {
      ...baseTransfer,
      items: [
        {
          id: 'ti-s',
          productId: 'p-reb',
          quantity: '2',
          unit: 'UN',
          product: {
            id: 'p-reb',
            sku: 'REB01',
            name: 'Reboque Basculante',
            ncm: '87164000',
            unit: 'UN',
            avgCost: '50000',
            costPrice: '50000',
            tracksSerial: true,
          },
        },
      ],
    };

    const primeDispatchStock = () => {
      mockPrisma.stockBalance.findUnique.mockResolvedValue({ available: '5', reserved: '0', inTransit: '0' });
      mockPrisma.stockBalance.upsert.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue({});
      mockPrisma.storeTransfer.update.mockResolvedValue({ ...serialTransfer, status: TransferStatus.DISPATCHED });
    };

    it('dispatch FIFO: pega N chassis IN_STOCK mais antigos na origem e move p/ IN_TRANSIT no destino', async () => {
      mockPrisma.storeTransfer.findFirst.mockResolvedValue(serialTransfer);
      primeDispatchStock();
      mockPrisma.serialNumber.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
      mockPrisma.serialNumber.updateMany.mockResolvedValue({ count: 2 });

      await service.dispatch('tr-1', 'co-1', 'u-1');

      // FIFO: IN_STOCK na origem, ordenado por createdAt asc, take = qty
      expect(mockPrisma.serialNumber.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: 'co-1',
            productId: 'p-reb',
            warehouseId: 'wh-factory',
            status: SerialStatus.IN_STOCK,
          }),
          take: 2,
          orderBy: { createdAt: 'asc' },
        }),
      );
      // move os 2 chassis para IN_TRANSIT no destino, vinculados à transferência
      expect(mockPrisma.serialNumber.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['s1', 's2'] } },
        data: {
          warehouseId: 'wh-store',
          status: SerialStatus.IN_TRANSIT,
          storeTransferId: 'tr-1',
        },
      });
    });

    it('dispatch override: usa exatamente os chassis informados (scan do operador)', async () => {
      mockPrisma.storeTransfer.findFirst.mockResolvedValue(serialTransfer);
      primeDispatchStock();
      mockPrisma.serialNumber.findMany.mockResolvedValue([
        { id: 's9', serial: 'CHS9', warehouseId: 'wh-factory', status: SerialStatus.IN_STOCK },
        { id: 's8', serial: 'CHS8', warehouseId: 'wh-factory', status: SerialStatus.IN_STOCK },
      ]);
      mockPrisma.serialNumber.updateMany.mockResolvedValue({ count: 2 });

      await service.dispatch('tr-1', 'co-1', 'u-1', {
        serials: [{ productId: 'p-reb', serialIds: ['s9', 's8'] }],
      });

      // busca pelos ids informados (não FIFO)
      expect(mockPrisma.serialNumber.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['s9', 's8'] }, companyId: 'co-1', productId: 'p-reb' },
        }),
      );
      expect(mockPrisma.serialNumber.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['s9', 's8'] } } }),
      );
    });

    it('dispatch: rejeita quando faltam chassis disponíveis (qtd × serial)', async () => {
      mockPrisma.storeTransfer.findFirst.mockResolvedValue(serialTransfer);
      primeDispatchStock();
      mockPrisma.serialNumber.findMany.mockResolvedValue([{ id: 's1' }]); // só 1 p/ qty 2

      await expect(service.dispatch('tr-1', 'co-1', 'u-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.serialNumber.updateMany).not.toHaveBeenCalled();
    });

    it('dispatch override: rejeita se nº de chassis informados difere da quantidade', async () => {
      mockPrisma.storeTransfer.findFirst.mockResolvedValue(serialTransfer);
      primeDispatchStock();

      await expect(
        service.dispatch('tr-1', 'co-1', 'u-1', {
          serials: [{ productId: 'p-reb', serialIds: ['s9'] }], // 1 p/ qty 2
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('dispatch override: rejeita chassi que não está na origem', async () => {
      mockPrisma.storeTransfer.findFirst.mockResolvedValue(serialTransfer);
      primeDispatchStock();
      mockPrisma.serialNumber.findMany.mockResolvedValue([
        { id: 's9', serial: 'CHS9', warehouseId: 'wh-outra', status: SerialStatus.IN_STOCK },
        { id: 's8', serial: 'CHS8', warehouseId: 'wh-factory', status: SerialStatus.IN_STOCK },
      ]);

      await expect(
        service.dispatch('tr-1', 'co-1', 'u-1', {
          serials: [{ productId: 'p-reb', serialIds: ['s9', 's8'] }],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.serialNumber.updateMany).not.toHaveBeenCalled();
    });

    it('receive: consolida chassis IN_TRANSIT da transferência como IN_STOCK no destino', async () => {
      mockPrisma.storeTransfer.findFirst.mockResolvedValue({
        ...serialTransfer,
        status: TransferStatus.DISPATCHED,
      });
      mockPrisma.stockBalance.update.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue({});
      mockPrisma.storeTransfer.update.mockResolvedValue({ ...serialTransfer, status: TransferStatus.RECEIVED });
      mockPrisma.serialNumber.updateMany.mockResolvedValue({ count: 2 });

      await service.receive('tr-1', 'co-1', 'u-1');

      expect(mockPrisma.serialNumber.updateMany).toHaveBeenCalledWith({
        where: { storeTransferId: 'tr-1', status: SerialStatus.IN_TRANSIT },
        data: { status: SerialStatus.IN_STOCK, storeTransferId: null },
      });
    });

    it('cancel DISPATCHED: devolve os chassis em trânsito p/ IN_STOCK na origem', async () => {
      mockPrisma.storeTransfer.findFirst.mockResolvedValue({
        ...serialTransfer,
        status: TransferStatus.DISPATCHED,
      });
      mockPrisma.stockBalance.update.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue({});
      mockPrisma.storeTransfer.update.mockResolvedValue({ ...serialTransfer, status: TransferStatus.CANCELLED });
      mockPrisma.serialNumber.updateMany.mockResolvedValue({ count: 2 });

      await service.cancel('tr-1', 'co-1', 'u-1');

      expect(mockPrisma.serialNumber.updateMany).toHaveBeenCalledWith({
        where: { storeTransferId: 'tr-1', status: SerialStatus.IN_TRANSIT },
        data: {
          warehouseId: 'wh-factory',
          status: SerialStatus.IN_STOCK,
          storeTransferId: null,
        },
      });
    });
  });
});
