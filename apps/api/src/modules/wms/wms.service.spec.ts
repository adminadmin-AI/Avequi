import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WmsService } from './wms.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  location: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  receivingOrder: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  putawayTask: {
    findFirst: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  stockBalance: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  stockMovement: { create: jest.fn() },
  auditLog: { create: jest.fn() },
  warehouse: { findUnique: jest.fn() },
  $transaction: jest.fn(),
};

describe('WmsService', () => {
  let service: WmsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WmsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WmsService>(WmsService);
    jest.clearAllMocks();
  });

  // ─── createLocation ───────────────────────────────────────────────────────

  describe('createLocation', () => {
    it('cria uma location com sucesso', async () => {
      const dto = { companyId: 'c1', warehouseId: 'w1', code: 'A-01', description: 'Rack A' };
      const created = { id: 'loc1', ...dto, type: 'STORAGE', isActive: true };
      mockPrisma.location.create.mockResolvedValue(created);

      const result = await service.createLocation(dto);

      expect(mockPrisma.location.create).toHaveBeenCalledWith({
        data: {
          companyId: 'c1',
          warehouseId: 'w1',
          code: 'A-01',
          description: 'Rack A',
          type: 'STORAGE',
        },
      });
      expect(result).toEqual(created);
    });

    it('usa STORAGE como type padrão quando não informado', async () => {
      const dto = { companyId: 'c1', warehouseId: 'w1', code: 'B-01' };
      mockPrisma.location.create.mockResolvedValue({ id: 'loc2', type: 'STORAGE' });

      await service.createLocation(dto);

      expect(mockPrisma.location.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'STORAGE' }) }),
      );
    });
  });

  // ─── createReceivingOrder ─────────────────────────────────────────────────

  describe('createReceivingOrder', () => {
    const event = {
      companyId: 'c1',
      userId: 'u1',
      purchaseOrderId: 'po1',
      goodsReceiptId: 'gr1',
      warehouseId: 'w1',
      items: [
        { productId: 'p1', qtyReceived: 10, unitCost: 5 },
        { productId: 'p2', qtyReceived: 0, unitCost: 0 },
      ],
    };

    it('cria ReceivingOrder quando wmsEnabled=true', async () => {
      mockPrisma.warehouse.findUnique.mockResolvedValue({ wmsEnabled: true });
      mockPrisma.receivingOrder.create.mockResolvedValue({ id: 'ro1', ...event });

      await service.createReceivingOrder(event as any);

      expect(mockPrisma.receivingOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            goodsReceiptId: 'gr1',
            warehouseId: 'w1',
            tasks: expect.objectContaining({
              create: expect.arrayContaining([
                expect.objectContaining({ productId: 'p1', qty: 10 }),
              ]),
            }),
          }),
        }),
      );
      // item com qtyReceived=0 deve ser filtrado
      const callArg = mockPrisma.receivingOrder.create.mock.calls[0][0];
      expect(callArg.data.tasks.create).toHaveLength(1);
    });

    it('ignora criação quando wmsEnabled=false', async () => {
      mockPrisma.warehouse.findUnique.mockResolvedValue({ wmsEnabled: false });

      await service.createReceivingOrder(event as any);

      expect(mockPrisma.receivingOrder.create).not.toHaveBeenCalled();
    });

    it('ignora criação quando warehouse não existe', async () => {
      mockPrisma.warehouse.findUnique.mockResolvedValue(null);

      await service.createReceivingOrder(event as any);

      expect(mockPrisma.receivingOrder.create).not.toHaveBeenCalled();
    });
  });

  // ─── findReceivingOrder ───────────────────────────────────────────────────

  describe('findReceivingOrder', () => {
    it('retorna a order quando encontrada', async () => {
      const order = { id: 'ro1', companyId: 'c1', tasks: [] };
      mockPrisma.receivingOrder.findFirst.mockResolvedValue(order);

      const result = await service.findReceivingOrder('ro1', 'c1');
      expect(result).toEqual(order);
    });

    it('lança NotFoundException quando company não confere', async () => {
      mockPrisma.receivingOrder.findFirst.mockResolvedValue(null);

      await expect(service.findReceivingOrder('ro1', 'wrong-company')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── getReceivingReport ───────────────────────────────────────────────────

  describe('getReceivingReport', () => {
    it('retorna percentuais corretos', async () => {
      const order = {
        id: 'ro1',
        status: 'IN_PROGRESS',
        warehouse: { id: 'w1', code: 'WH1', name: 'Armazém 1' },
        goodsReceiptId: 'gr1',
        tasks: [
          { id: 't1', status: 'CONFIRMED', product: {}, qty: 5, location: null, confirmedBy: null, confirmedAt: null },
          { id: 't2', status: 'CONFIRMED', product: {}, qty: 3, location: null, confirmedBy: null, confirmedAt: null },
          { id: 't3', status: 'PENDING', product: {}, qty: 2, location: null, confirmedBy: null, confirmedAt: null },
        ],
      };
      mockPrisma.receivingOrder.findFirst.mockResolvedValue(order);

      const report = await service.getReceivingReport('ro1', 'c1');

      expect(report.totalTasks).toBe(3);
      expect(report.confirmedTasks).toBe(2);
      expect(report.pendingTasks).toBe(1);
      expect(report.pctComplete).toBe(67);
    });

    it('retorna pctComplete=0 quando sem tasks', async () => {
      const order = {
        id: 'ro1',
        status: 'PENDING',
        warehouse: {},
        goodsReceiptId: 'gr1',
        tasks: [],
      };
      mockPrisma.receivingOrder.findFirst.mockResolvedValue(order);

      const report = await service.getReceivingReport('ro1', 'c1');
      expect(report.pctComplete).toBe(0);
    });
  });

  // ─── confirmPutaway ───────────────────────────────────────────────────────

  describe('confirmPutaway', () => {
    const orderId = 'ro1';
    const taskId = 'task1';
    const companyId = 'c1';
    const dto = { locationId: 'loc1' };

    const buildTx = (overrides: Record<string, any> = {}) => ({
      putawayTask: {
        findFirst: jest.fn().mockResolvedValue({
          id: taskId,
          status: 'PENDING',
          productId: 'p1',
          qty: 10,
          receivingOrder: { warehouseId: 'w1' },
          ...overrides.task,
        }),
        update: jest.fn().mockResolvedValue({ id: taskId, product: {}, location: {} }),
        count: jest.fn().mockResolvedValue(0),
      },
      location: {
        findFirst: jest.fn().mockResolvedValue({ id: 'loc1', warehouseId: 'w1', code: 'A-01', isActive: true }),
      },
      stockBalance: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sb1' }),
        update: jest.fn(),
      },
      stockMovement: { create: jest.fn() },
      receivingOrder: { update: jest.fn() },
      auditLog: { create: jest.fn() },
      ...overrides.tx,
    });

    it('happy path: pendingPutaway → available + StockMovement + RO→DONE', async () => {
      const tx = buildTx();
      mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.confirmPutaway(orderId, taskId, companyId, dto, 'u1');

      expect(tx.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { pendingPutaway: { decrement: 10 }, available: { increment: 10 } },
        }),
      );
      expect(tx.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'ENTRY', quantity: 10 }),
        }),
      );
      expect(tx.receivingOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'DONE' } }),
      );
    });

    it('RO → IN_PROGRESS quando ainda há tasks pendentes', async () => {
      const tx = buildTx();
      tx.putawayTask.count.mockResolvedValue(2);
      mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.confirmPutaway(orderId, taskId, companyId, dto, 'u1');

      expect(tx.receivingOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'IN_PROGRESS' } }),
      );
    });

    it('lança BadRequestException se task já confirmada', async () => {
      const tx = buildTx({ task: { status: 'CONFIRMED' } });
      mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(
        service.confirmPutaway(orderId, taskId, companyId, dto, 'u1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('lança NotFoundException se task não existe', async () => {
      const tx = buildTx();
      tx.putawayTask.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(
        service.confirmPutaway(orderId, taskId, companyId, dto, 'u1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('lança BadRequestException se location pertence a outro armazém', async () => {
      const tx = buildTx();
      tx.location.findFirst.mockResolvedValue({ id: 'loc1', warehouseId: 'w-other', code: 'X-01', isActive: true });
      mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(
        service.confirmPutaway(orderId, taskId, companyId, dto, 'u1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
