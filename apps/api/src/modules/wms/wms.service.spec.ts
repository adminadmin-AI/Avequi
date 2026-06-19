import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WmsService } from './wms.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  location: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  receivingOrder: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    groupBy: jest.fn(),
  },
  putawayTask: {
    findFirst: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  pickingOrder: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
    groupBy: jest.fn(),
  },
  pickTask: {
    findFirst: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  stockBalance: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
  },
  stockMovement: { create: jest.fn() },
  auditLog: { create: jest.fn() },
  warehouse: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  inventoryCount: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  inventoryCountItem: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
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

  // ─── S18: createPickingOrder ──────────────────────────────────────────────

  describe('createPickingOrder', () => {
    const event = {
      companyId: 'c1',
      userId: 'u1',
      salesOrderId: 'so1',
      warehouseId: 'w1',
      items: [
        { productId: 'p1', quantity: 5, unitPrice: 100 },
        { productId: 'p2', quantity: 0, unitPrice: 200 },
      ],
    };

    it('cria PickingOrder quando wmsEnabled=true', async () => {
      mockPrisma.warehouse.findUnique.mockResolvedValue({ wmsEnabled: true });
      mockPrisma.pickingOrder.create.mockResolvedValue({ id: 'po1', ...event });

      await service.createPickingOrder(event as any);

      expect(mockPrisma.pickingOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            salesOrderId: 'so1',
            warehouseId: 'w1',
            tasks: expect.objectContaining({
              create: expect.arrayContaining([
                expect.objectContaining({ productId: 'p1', qty: 5 }),
              ]),
            }),
          }),
        }),
      );
      // item com quantity=0 deve ser filtrado
      const callArg = mockPrisma.pickingOrder.create.mock.calls[0][0];
      expect(callArg.data.tasks.create).toHaveLength(1);
    });

    it('ignora criação quando wmsEnabled=false', async () => {
      mockPrisma.warehouse.findUnique.mockResolvedValue({ wmsEnabled: false });

      await service.createPickingOrder(event as any);

      expect(mockPrisma.pickingOrder.create).not.toHaveBeenCalled();
    });

    it('ignora criação quando warehouse não existe', async () => {
      mockPrisma.warehouse.findUnique.mockResolvedValue(null);

      await service.createPickingOrder(event as any);

      expect(mockPrisma.pickingOrder.create).not.toHaveBeenCalled();
    });
  });

  // ─── S18: findPickingOrder ────────────────────────────────────────────────

  describe('findPickingOrder', () => {
    it('retorna a order quando encontrada', async () => {
      const order = { id: 'po1', companyId: 'c1', tasks: [] };
      mockPrisma.pickingOrder.findFirst.mockResolvedValue(order);

      const result = await service.findPickingOrder('po1', 'c1');
      expect(result).toEqual(order);
    });

    it('lança NotFoundException quando não encontrada', async () => {
      mockPrisma.pickingOrder.findFirst.mockResolvedValue(null);

      await expect(service.findPickingOrder('po1', 'wrong')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── S18: getPickingReport ────────────────────────────────────────────────

  describe('getPickingReport', () => {
    it('retorna percentuais corretos', async () => {
      const order = {
        id: 'po1',
        status: 'IN_PROGRESS',
        warehouse: { id: 'w1', code: 'WH1', name: 'Armazém 1' },
        salesOrderId: 'so1',
        tasks: [
          { id: 't1', status: 'CONFIRMED', product: {}, qty: 5, location: null, notes: null, confirmedBy: null, confirmedAt: null },
          { id: 't2', status: 'CONFIRMED', product: {}, qty: 3, location: null, notes: null, confirmedBy: null, confirmedAt: null },
          { id: 't3', status: 'PENDING', product: {}, qty: 2, location: null, notes: null, confirmedBy: null, confirmedAt: null },
        ],
      };
      mockPrisma.pickingOrder.findFirst.mockResolvedValue(order);

      const report = await service.getPickingReport('po1', 'c1');

      expect(report.totalTasks).toBe(3);
      expect(report.confirmedTasks).toBe(2);
      expect(report.pendingTasks).toBe(1);
      expect(report.pctComplete).toBe(67);
    });

    it('retorna pctComplete=0 quando sem tasks', async () => {
      const order = {
        id: 'po1',
        status: 'PENDING',
        warehouse: {},
        salesOrderId: 'so1',
        tasks: [],
      };
      mockPrisma.pickingOrder.findFirst.mockResolvedValue(order);

      const report = await service.getPickingReport('po1', 'c1');
      expect(report.pctComplete).toBe(0);
    });
  });

  // ─── S18: confirmPickTask ─────────────────────────────────────────────────

  describe('confirmPickTask', () => {
    const orderId = 'po1';
    const taskId = 'task1';
    const companyId = 'c1';
    const dto = {};

    const buildPickTx = (overrides: Record<string, any> = {}) => ({
      pickTask: {
        findFirst: jest.fn().mockResolvedValue({
          id: taskId,
          status: 'PENDING',
          productId: 'p1',
          qty: 10,
          ...overrides.task,
        }),
        update: jest.fn().mockResolvedValue({ id: taskId, product: {}, location: null }),
        count: jest.fn().mockResolvedValue(0),
      },
      pickingOrder: {
        findUnique: jest.fn().mockResolvedValue({ warehouseId: 'w1' }),
        update: jest.fn(),
      },
      location: {
        findFirst: jest.fn().mockResolvedValue({ id: 'loc1', warehouseId: 'w1', code: 'A-01', isActive: true }),
      },
      auditLog: { create: jest.fn() },
      ...overrides.tx,
    });

    it('happy path: confirma task sem locationId → PickingOrder DONE', async () => {
      const tx = buildPickTx();
      mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.confirmPickTask(orderId, taskId, companyId, dto, 'u1');

      expect(tx.pickTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'CONFIRMED' }),
        }),
      );
      expect(tx.pickingOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'DONE' } }),
      );
    });

    it('PickingOrder → IN_PROGRESS quando ainda há tasks pendentes', async () => {
      const tx = buildPickTx();
      tx.pickTask.count.mockResolvedValue(3);
      mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.confirmPickTask(orderId, taskId, companyId, dto, 'u1');

      expect(tx.pickingOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'IN_PROGRESS' } }),
      );
    });

    it('lança BadRequestException se task já confirmada', async () => {
      const tx = buildPickTx({ task: { status: 'CONFIRMED' } });
      mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(
        service.confirmPickTask(orderId, taskId, companyId, dto, 'u1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('lança NotFoundException se task não existe', async () => {
      const tx = buildPickTx();
      tx.pickTask.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(
        service.confirmPickTask(orderId, taskId, companyId, dto, 'u1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('lança BadRequestException se locationId pertence a outro armazém', async () => {
      const tx = buildPickTx();
      tx.location.findFirst.mockResolvedValue({ id: 'loc1', warehouseId: 'w-other', code: 'X-01', isActive: true });
      mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(
        service.confirmPickTask(orderId, taskId, companyId, { locationId: 'loc1' }, 'u1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── S19: createInventoryCount ────────────────────────────────────────────

  describe('createInventoryCount', () => {
    const dto = { warehouseId: 'w1', type: 'CYCLIC' as any };

    it('cria InventoryCount com itens do StockBalance', async () => {
      mockPrisma.warehouse.findFirst.mockResolvedValue({ id: 'w1' });
      mockPrisma.stockBalance.findMany.mockResolvedValue([
        { productId: 'p1', available: 10 },
        { productId: 'p2', available: 5 },
      ]);
      mockPrisma.inventoryCount.create.mockResolvedValue({
        id: 'ic1',
        type: 'CYCLIC',
        status: 'IN_PROGRESS',
        warehouse: {},
        _count: { items: 2 },
      });

      const result = await service.createInventoryCount(dto, 'c1', 'u1');

      expect(mockPrisma.inventoryCount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'CYCLIC',
            status: 'IN_PROGRESS',
            items: expect.objectContaining({
              create: expect.arrayContaining([
                expect.objectContaining({ productId: 'p1', systemQty: 10 }),
                expect.objectContaining({ productId: 'p2', systemQty: 5 }),
              ]),
            }),
          }),
        }),
      );
      expect(result.id).toBe('ic1');
    });

    it('lança NotFoundException se armazém não existe', async () => {
      mockPrisma.warehouse.findFirst.mockResolvedValue(null);

      await expect(service.createInventoryCount(dto, 'c1')).rejects.toThrow(NotFoundException);
    });

    it('lança BadRequestException se não há saldo para contar', async () => {
      mockPrisma.warehouse.findFirst.mockResolvedValue({ id: 'w1' });
      mockPrisma.stockBalance.findMany.mockResolvedValue([]);

      await expect(service.createInventoryCount(dto, 'c1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── S19: findInventoryCount ──────────────────────────────────────────────

  describe('findInventoryCount', () => {
    it('retorna a contagem quando encontrada', async () => {
      const count = { id: 'ic1', companyId: 'c1', items: [] };
      mockPrisma.inventoryCount.findFirst.mockResolvedValue(count);

      const result = await service.findInventoryCount('ic1', 'c1');
      expect(result).toEqual(count);
    });

    it('lança NotFoundException quando não encontrada', async () => {
      mockPrisma.inventoryCount.findFirst.mockResolvedValue(null);

      await expect(service.findInventoryCount('ic1', 'c1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── S19: recordCount ────────────────────────────────────────────────────

  describe('recordCount', () => {
    it('registra contagem e calcula variância corretamente', async () => {
      mockPrisma.inventoryCountItem.findFirst.mockResolvedValue({
        id: 'item1',
        productId: 'p1',
        systemQty: 10,
        inventoryCount: { status: 'IN_PROGRESS' },
      });
      mockPrisma.inventoryCountItem.update.mockResolvedValue({
        id: 'item1',
        countedQty: 8,
        variance: -2,
        status: 'COUNTED',
        product: {},
      });

      const result = await service.recordCount('ic1', 'item1', 'c1', { countedQty: 8 }, 'u1');

      expect(mockPrisma.inventoryCountItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            countedQty: 8,
            variance: -2,
            status: 'COUNTED',
          }),
        }),
      );
      expect(result.variance).toBe(-2);
    });

    it('lança NotFoundException se item não existe', async () => {
      mockPrisma.inventoryCountItem.findFirst.mockResolvedValue(null);

      await expect(
        service.recordCount('ic1', 'item1', 'c1', { countedQty: 5 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('lança BadRequestException se contagem já reconciliada', async () => {
      mockPrisma.inventoryCountItem.findFirst.mockResolvedValue({
        id: 'item1',
        systemQty: 10,
        inventoryCount: { status: 'RECONCILED' },
      });

      await expect(
        service.recordCount('ic1', 'item1', 'c1', { countedQty: 5 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── S19: getInventoryReport ──────────────────────────────────────────────

  describe('getInventoryReport', () => {
    it('retorna métricas e variâncias corretamente', async () => {
      const count = {
        id: 'ic1',
        type: 'FULL',
        status: 'IN_PROGRESS',
        warehouse: {},
        salesOrderId: null,
        reconciledAt: null,
        items: [
          { id: 'i1', status: 'COUNTED', product: {}, systemQty: 10, countedQty: 8, variance: -2, countedBy: null, countedAt: null },
          { id: 'i2', status: 'COUNTED', product: {}, systemQty: 5, countedQty: 5, variance: 0, countedBy: null, countedAt: null },
          { id: 'i3', status: 'PENDING', product: {}, systemQty: 3, countedQty: null, variance: null, countedBy: null, countedAt: null },
        ],
      };
      mockPrisma.inventoryCount.findFirst.mockResolvedValue(count);

      const report = await service.getInventoryReport('ic1', 'c1');

      expect(report.totalItems).toBe(3);
      expect(report.countedItems).toBe(2);
      expect(report.pendingItems).toBe(1);
      expect(report.itemsWithVariance).toBe(1);
      expect(report.pctComplete).toBe(67);
    });
  });

  // ─── S19: reconcile ───────────────────────────────────────────────────────

  describe('reconcile', () => {
    const buildReconcileTx = (overrides: Record<string, any> = {}) => ({
      inventoryCount: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'ic1',
          warehouseId: 'w1',
          status: 'IN_PROGRESS',
          items: [
            { id: 'i1', productId: 'p1', systemQty: 10, countedQty: 8, variance: -2, status: 'COUNTED', product: { id: 'p1', sku: 'SKU-01' } },
            { id: 'i2', productId: 'p2', systemQty: 5, countedQty: 5, variance: 0, status: 'COUNTED', product: { id: 'p2', sku: 'SKU-02' } },
          ],
          ...overrides.count,
        }),
        update: jest.fn().mockResolvedValue({ id: 'ic1', status: 'RECONCILED', reconciledAt: new Date() }),
      },
      stockBalance: { upsert: jest.fn() },
      stockMovement: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      ...overrides.tx,
    });

    it('happy path: gera ajuste apenas para items com variância ≠ 0', async () => {
      const tx = buildReconcileTx();
      mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

      const result = await service.reconcile('ic1', 'c1', 'u1');

      // só p1 tem variância (-2), p2 não gera ajuste
      expect(tx.stockBalance.upsert).toHaveBeenCalledTimes(1);
      expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
      expect(tx.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'EXIT', quantity: 2, productId: 'p1' }),
        }),
      );
      expect(result.adjustments).toHaveLength(1);
      expect(result.adjustments[0].variance).toBe(-2);
    });

    it('lança NotFoundException se contagem não existe', async () => {
      const tx = buildReconcileTx();
      tx.inventoryCount.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(service.reconcile('ic1', 'c1')).rejects.toThrow(NotFoundException);
    });

    it('lança BadRequestException se já reconciliada', async () => {
      const tx = buildReconcileTx({ count: { status: 'RECONCILED' } });
      mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(service.reconcile('ic1', 'c1')).rejects.toThrow(BadRequestException);
    });

    it('lança BadRequestException se há itens pendentes', async () => {
      const tx = buildReconcileTx({
        count: {
          status: 'IN_PROGRESS',
          items: [
            { id: 'i1', productId: 'p1', systemQty: 10, countedQty: 8, variance: -2, status: 'COUNTED', product: { sku: 'SKU-01' } },
            { id: 'i2', productId: 'p2', systemQty: 5, countedQty: null, variance: null, status: 'PENDING', product: { sku: 'SKU-02' } },
          ],
        },
      });
      mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(service.reconcile('ic1', 'c1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── S20: getDashboard ───────────────────────────────────────────────────

  describe('getDashboard', () => {
    it('retorna KPIs agregados corretamente', async () => {
      mockPrisma.putawayTask.count = jest.fn().mockResolvedValue(3);
      mockPrisma.pickTask.count = jest.fn().mockResolvedValue(5);
      mockPrisma.inventoryCount.count = jest.fn().mockResolvedValue(1);
      mockPrisma.receivingOrder.groupBy = jest.fn().mockResolvedValue([
        { status: 'PENDING', _count: { id: 2 } },
        { status: 'DONE', _count: { id: 8 } },
      ]);
      mockPrisma.pickingOrder.groupBy = jest.fn().mockResolvedValue([
        { status: 'PENDING', _count: { id: 4 } },
      ]);
      mockPrisma.inventoryCount.groupBy = jest.fn().mockResolvedValue([
        { status: 'IN_PROGRESS', _count: { id: 1 } },
        { status: 'RECONCILED', _count: { id: 3 } },
      ]);

      const result = await service.getDashboard('c1');

      expect(result.pendingPutaway).toBe(3);
      expect(result.pendingPick).toBe(5);
      expect(result.activeInventory).toBe(1);
      expect(result.receiving).toEqual({ PENDING: 2, DONE: 8 });
      expect(result.picking).toEqual({ PENDING: 4 });
      expect(result.inventory).toEqual({ IN_PROGRESS: 1, RECONCILED: 3 });
    });
  });

  // ─── S20: toggleLocation ─────────────────────────────────────────────────

  describe('toggleLocation', () => {
    it('desativa location ativa', async () => {
      mockPrisma.location.findFirst.mockResolvedValue({ id: 'loc1', isActive: true });
      mockPrisma.location.update = jest.fn().mockResolvedValue({ id: 'loc1', isActive: false });

      const result = await service.toggleLocation('loc1', 'c1');

      expect(mockPrisma.location.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } }),
      );
      expect(result.isActive).toBe(false);
    });

    it('ativa location inativa', async () => {
      mockPrisma.location.findFirst.mockResolvedValue({ id: 'loc1', isActive: false });
      mockPrisma.location.update = jest.fn().mockResolvedValue({ id: 'loc1', isActive: true });

      const result = await service.toggleLocation('loc1', 'c1');

      expect(mockPrisma.location.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: true } }),
      );
      expect(result.isActive).toBe(true);
    });

    it('lança NotFoundException se location não existe', async () => {
      mockPrisma.location.findFirst.mockResolvedValue(null);

      await expect(service.toggleLocation('loc1', 'c1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── S20: toggleWarehouseWms ──────────────────────────────────────────────

  describe('toggleWarehouseWms', () => {
    it('ativa wmsEnabled', async () => {
      mockPrisma.warehouse.findFirst.mockResolvedValue({ id: 'w1', wmsEnabled: false });
      mockPrisma.warehouse.update = jest.fn().mockResolvedValue({ id: 'w1', wmsEnabled: true });

      const result = await service.toggleWarehouseWms('w1', 'c1');

      expect(mockPrisma.warehouse.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { wmsEnabled: true } }),
      );
      expect(result.wmsEnabled).toBe(true);
    });

    it('lança NotFoundException se armazém não existe', async () => {
      mockPrisma.warehouse.findFirst.mockResolvedValue(null);

      await expect(service.toggleWarehouseWms('w1', 'c1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── S20: cancelInventoryCount ────────────────────────────────────────────

  describe('cancelInventoryCount', () => {
    it('cancela contagem IN_PROGRESS', async () => {
      mockPrisma.inventoryCount.findFirst.mockResolvedValue({ id: 'ic1', status: 'IN_PROGRESS' });
      mockPrisma.inventoryCount.update.mockResolvedValue({ id: 'ic1', status: 'CANCELLED' });

      const result = await service.cancelInventoryCount('ic1', 'c1');

      expect(mockPrisma.inventoryCount.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CANCELLED' } }),
      );
      expect(result.status).toBe('CANCELLED');
    });

    it('lança BadRequestException se já reconciliada', async () => {
      mockPrisma.inventoryCount.findFirst.mockResolvedValue({ id: 'ic1', status: 'RECONCILED' });

      await expect(service.cancelInventoryCount('ic1', 'c1')).rejects.toThrow(BadRequestException);
    });

    it('lança BadRequestException se já cancelada', async () => {
      mockPrisma.inventoryCount.findFirst.mockResolvedValue({ id: 'ic1', status: 'CANCELLED' });

      await expect(service.cancelInventoryCount('ic1', 'c1')).rejects.toThrow(BadRequestException);
    });

    it('lança NotFoundException se não existe', async () => {
      mockPrisma.inventoryCount.findFirst.mockResolvedValue(null);

      await expect(service.cancelInventoryCount('ic1', 'c1')).rejects.toThrow(NotFoundException);
    });
  });
});
