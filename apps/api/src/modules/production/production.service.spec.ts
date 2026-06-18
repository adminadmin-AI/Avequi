import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ProductionService } from './production.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockTx = {
  productionOrder: { findFirst: jest.fn(), update: jest.fn() },
  productionOrderItem: { update: jest.fn() },
  stockBalance: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  stockMovement: { create: jest.fn() },
  auditLog: { create: jest.fn() },
};

const mockPrisma = {
  product: { findFirst: jest.fn() },
  warehouse: { findFirst: jest.fn() },
  bomVersion: { findFirst: jest.fn() },
  productionOrder: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  productionOrderItem: { update: jest.fn() },
  productionLog: { create: jest.fn(), findMany: jest.fn() },
  routingStep: { findFirst: jest.fn() },
  stockBalance: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  stockMovement: { create: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn((fn: (tx: any) => any) => fn(mockTx)),
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const product = { id: 'p-1', sku: 'PA001', name: 'Reboque 3 Eixos', unit: 'UN' };
const warehouse = { id: 'wh-1', code: 'ALM-FAB', name: 'Almoxarifado Fábrica' };

const baseOrder = {
  id: 'op-1',
  companyId: 'co-1',
  productId: 'p-1',
  warehouseId: 'wh-1',
  plannedQty: '5',
  producedQty: '0',
  status: 'DRAFT',
  items: [
    { id: 'poi-1', componentId: 'c-1', plannedQty: '10', unit: 'UN' },
    { id: 'poi-2', componentId: 'c-2', plannedQty: '20', unit: 'KG' },
  ],
  product,
  warehouse,
  createdBy: null,
  mrpSuggestion: null,
};

describe('ProductionService', () => {
  let service: ProductionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductionService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<ProductionService>(ProductionService);
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockTx.auditLog.create.mockResolvedValue({});
    mockTx.stockMovement.create.mockResolvedValue({});
    mockTx.productionOrderItem.update.mockResolvedValue({});
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto = { companyId: 'co-1', productId: 'p-1', warehouseId: 'wh-1', plannedQty: 5 };

    it('deve criar OP com itens do BOM ativo', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(product);
      mockPrisma.warehouse.findFirst.mockResolvedValue(warehouse);
      mockPrisma.bomVersion.findFirst.mockResolvedValue({
        items: [
          { componentId: 'c-1', quantity: '2', scrapPct: '0', unit: 'UN' },
          { componentId: 'c-2', quantity: '3', scrapPct: '10', unit: 'KG' },
        ],
      });
      mockPrisma.productionOrder.create.mockResolvedValue(baseOrder);

      const result = await service.create(dto, 'u-1');

      expect(mockPrisma.productionOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productId: 'p-1',
            plannedQty: 5,
            items: {
              create: expect.arrayContaining([
                expect.objectContaining({ componentId: 'c-1', plannedQty: 10 }),  // 2 × 5 × 1.0
                expect.objectContaining({ componentId: 'c-2', plannedQty: 16.5 }), // 3 × 5 × 1.1
              ]),
            },
          }),
        }),
      );
      expect(result.id).toBe('op-1');
    });

    it('deve criar OP sem itens quando produto não tem BOM ativo', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(product);
      mockPrisma.warehouse.findFirst.mockResolvedValue(warehouse);
      mockPrisma.bomVersion.findFirst.mockResolvedValue(null);
      mockPrisma.productionOrder.create.mockResolvedValue({ ...baseOrder, items: [] });

      await service.create(dto, 'u-1');

      expect(mockPrisma.productionOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ items: { create: [] } }),
        }),
      );
    });

    it('deve lançar NotFoundException para produto inexistente', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);
      await expect(service.create(dto, 'u-1')).rejects.toThrow(NotFoundException);
    });

    it('deve lançar NotFoundException para armazém inexistente', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(product);
      mockPrisma.warehouse.findFirst.mockResolvedValue(null);
      await expect(service.create(dto, 'u-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── release ──────────────────────────────────────────────────────────────

  describe('release', () => {
    it('deve reservar componentes e mudar status para RELEASED', async () => {
      mockTx.productionOrder.findFirst.mockResolvedValue(baseOrder);
      mockTx.stockBalance.findUnique
        .mockResolvedValueOnce({ available: '15' }) // c-1: 15 disponível, precisa 10 ✅
        .mockResolvedValueOnce({ available: '25' }); // c-2: 25 disponível, precisa 20 ✅
      mockTx.stockBalance.update.mockResolvedValue({});
      mockTx.productionOrder.update.mockResolvedValue({ ...baseOrder, status: 'RELEASED' });

      const result = await service.release('op-1', 'co-1', 'u-1');

      expect(mockTx.stockBalance.update).toHaveBeenCalledTimes(2);
      expect(mockTx.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { available: { decrement: 10 }, reserved: { increment: 10 } },
        }),
      );
      expect(result.status).toBe('RELEASED');
    });

    it('deve lançar BadRequest para status diferente de DRAFT', async () => {
      mockTx.productionOrder.findFirst.mockResolvedValue({ ...baseOrder, status: 'RELEASED' });
      await expect(service.release('op-1', 'co-1')).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequest quando estoque de componente é insuficiente', async () => {
      mockTx.productionOrder.findFirst.mockResolvedValue(baseOrder);
      mockTx.stockBalance.findUnique.mockResolvedValue({ available: '5' }); // precisa 10
      await expect(service.release('op-1', 'co-1')).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequest para OP sem itens', async () => {
      mockTx.productionOrder.findFirst.mockResolvedValue({ ...baseOrder, items: [] });
      await expect(service.release('op-1', 'co-1')).rejects.toThrow(BadRequestException);
    });

    it('deve lançar NotFoundException para OP inexistente', async () => {
      mockTx.productionOrder.findFirst.mockResolvedValue(null);
      await expect(service.release('op-x', 'co-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── start ────────────────────────────────────────────────────────────────

  describe('start', () => {
    it('deve mudar status para IN_PROGRESS e registrar startedAt', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue({ ...baseOrder, status: 'RELEASED' });
      mockPrisma.productionOrder.update.mockResolvedValue({ ...baseOrder, status: 'IN_PROGRESS' });

      const result = await service.start('op-1', 'co-1', 'u-1');

      expect(mockPrisma.productionOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'IN_PROGRESS', startedAt: expect.any(Date) }),
        }),
      );
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('deve lançar BadRequest para status diferente de RELEASED', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue({ ...baseOrder, status: 'DRAFT' });
      await expect(service.start('op-1', 'co-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── complete ─────────────────────────────────────────────────────────────

  describe('complete', () => {
    const inProgressOrder = { ...baseOrder, status: 'IN_PROGRESS' };

    it('deve dar EXIT nos componentes e ENTRY no produto acabado', async () => {
      mockTx.productionOrder.findFirst.mockResolvedValue(inProgressOrder);
      mockTx.stockBalance.findUnique.mockResolvedValue({ available: '0' }); // PA ainda sem saldo
      mockTx.stockBalance.update.mockResolvedValue({});
      mockTx.stockBalance.create.mockResolvedValue({});
      mockTx.productionOrder.update.mockResolvedValue({ ...inProgressOrder, status: 'DONE', producedQty: '5' });

      const result = await service.complete('op-1', 'co-1', undefined, 'u-1');

      // 2 EXIT (componentes) + 1 ENTRY (PA)
      expect(mockTx.stockMovement.create).toHaveBeenCalledTimes(3);
      expect(mockTx.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'EXIT', productId: 'c-1' }) }),
      );
      expect(mockTx.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'ENTRY', productId: 'p-1' }) }),
      );
      expect(result.status).toBe('DONE');
    });

    it('deve usar producedQty informado quando fornecido', async () => {
      mockTx.productionOrder.findFirst.mockResolvedValue(inProgressOrder);
      mockTx.stockBalance.findUnique.mockResolvedValue({ available: '2' });
      mockTx.stockBalance.update.mockResolvedValue({});
      mockTx.productionOrder.update.mockResolvedValue({ ...inProgressOrder, status: 'DONE', producedQty: '3' });

      await service.complete('op-1', 'co-1', 3, 'u-1');

      expect(mockTx.productionOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ producedQty: 3 }),
        }),
      );
    });

    it('deve lançar BadRequest para status diferente de IN_PROGRESS', async () => {
      mockTx.productionOrder.findFirst.mockResolvedValue({ ...baseOrder, status: 'RELEASED' });
      await expect(service.complete('op-1', 'co-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── cancel ───────────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('deve cancelar OP em DRAFT sem estornar reserva', async () => {
      mockTx.productionOrder.findFirst.mockResolvedValue({ ...baseOrder, status: 'DRAFT' });
      mockTx.productionOrder.update.mockResolvedValue({ ...baseOrder, status: 'CANCELLED' });

      const result = await service.cancel('op-1', 'co-1', 'u-1');

      expect(mockTx.stockBalance.update).not.toHaveBeenCalled();
      expect(result.status).toBe('CANCELLED');
    });

    it('deve estornar reserva ao cancelar OP em RELEASED', async () => {
      mockTx.productionOrder.findFirst.mockResolvedValue({ ...baseOrder, status: 'RELEASED' });
      mockTx.stockBalance.update.mockResolvedValue({});
      mockTx.productionOrder.update.mockResolvedValue({ ...baseOrder, status: 'CANCELLED' });

      await service.cancel('op-1', 'co-1', 'u-1');

      expect(mockTx.stockBalance.update).toHaveBeenCalledTimes(2);
      expect(mockTx.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { reserved: { decrement: 10 }, available: { increment: 10 } },
        }),
      );
    });

    it('deve estornar reserva ao cancelar OP em IN_PROGRESS', async () => {
      mockTx.productionOrder.findFirst.mockResolvedValue({ ...baseOrder, status: 'IN_PROGRESS' });
      mockTx.stockBalance.update.mockResolvedValue({});
      mockTx.productionOrder.update.mockResolvedValue({ ...baseOrder, status: 'CANCELLED' });

      await service.cancel('op-1', 'co-1');
      expect(mockTx.stockBalance.update).toHaveBeenCalledTimes(2);
    });

    it('deve lançar BadRequest ao tentar cancelar OP DONE', async () => {
      mockTx.productionOrder.findFirst.mockResolvedValue({ ...baseOrder, status: 'DONE' });
      await expect(service.cancel('op-1', 'co-1')).rejects.toThrow(BadRequestException);
    });

    it('deve lançar NotFoundException para OP inexistente', async () => {
      mockTx.productionOrder.findFirst.mockResolvedValue(null);
      await expect(service.cancel('op-x', 'co-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('deve listar OPs filtrando por companyId', async () => {
      mockPrisma.productionOrder.findMany.mockResolvedValue([baseOrder]);

      const result = await service.findAll('co-1');

      expect(mockPrisma.productionOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: 'co-1' } }),
      );
      expect(result).toHaveLength(1);
    });

    it('deve filtrar por status quando fornecido', async () => {
      mockPrisma.productionOrder.findMany.mockResolvedValue([]);

      await service.findAll('co-1', 'DRAFT' as any);

      expect(mockPrisma.productionOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: 'co-1', status: 'DRAFT' } }),
      );
    });
  });

  // ─── isolamento por companyId ─────────────────────────────────────────────

  describe('isolamento multi-tenant', () => {
    it('findOne lança NotFoundException para OP de outra empresa', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue(null);
      await expect(service.findOne('op-1', 'co-outro')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── S14: addLog ──────────────────────────────────────────────────────────

  describe('addLog', () => {
    const inProgressOrder = {
      ...baseOrder,
      status: 'IN_PROGRESS',
      plannedQty: '10',
      producedQty: '0',
    };
    const baseLog = {
      id: 'log-1',
      productionOrderId: 'op-1',
      qty: '3',
      routingStepId: null,
      stepOrder: null,
      workCenter: null,
      notes: null,
      loggedAt: new Date(),
      user: null,
      routingStep: null,
    };

    it('deve registrar apontamento e acumular producedQty', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue(inProgressOrder);
      mockPrisma.routingStep.findFirst.mockResolvedValue(null);
      mockPrisma.productionLog.create.mockResolvedValue(baseLog);
      mockPrisma.productionOrder.update.mockResolvedValue({});

      const result = await service.addLog('op-1', 'co-1', { qty: 3 }, 'u-1');

      expect(mockPrisma.productionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ productionOrderId: 'op-1', qty: 3 }),
        }),
      );
      expect(mockPrisma.productionOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { producedQty: { increment: 3 } },
        }),
      );
      expect(result.id).toBe('log-1');
    });

    it('deve registrar stepOrder quando routingStepId é informado', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue(inProgressOrder);
      mockPrisma.routingStep.findFirst.mockResolvedValue({ id: 'rs-1', stepOrder: 2 });
      mockPrisma.productionLog.create.mockResolvedValue({ ...baseLog, routingStepId: 'rs-1', stepOrder: 2 });
      mockPrisma.productionOrder.update.mockResolvedValue({});

      await service.addLog('op-1', 'co-1', { qty: 2, routingStepId: 'rs-1' }, 'u-1');

      expect(mockPrisma.productionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ routingStepId: 'rs-1', stepOrder: 2 }),
        }),
      );
    });

    it('deve lançar BadRequest quando qty excede saldo pendente', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue({
        ...inProgressOrder,
        plannedQty: '5',
        producedQty: '4',
      });

      await expect(
        service.addLog('op-1', 'co-1', { qty: 2 }, 'u-1'), // 4 + 2 > 5
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequest para OP não IN_PROGRESS', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue({ ...inProgressOrder, status: 'RELEASED' });
      await expect(service.addLog('op-1', 'co-1', { qty: 1 })).rejects.toThrow(BadRequestException);
    });

    it('deve lançar NotFoundException para OP inexistente', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue(null);
      await expect(service.addLog('op-x', 'co-1', { qty: 1 })).rejects.toThrow(NotFoundException);
    });
  });

  // ─── S14: getLogs ─────────────────────────────────────────────────────────

  describe('getLogs', () => {
    it('deve listar logs da OP em ordem cronológica', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue(baseOrder);
      mockPrisma.productionLog.findMany.mockResolvedValue([
        { id: 'log-1', qty: '3', loggedAt: new Date('2026-06-18T10:00:00Z') },
        { id: 'log-2', qty: '2', loggedAt: new Date('2026-06-18T11:00:00Z') },
      ]);

      const result = await service.getLogs('op-1', 'co-1');

      expect(mockPrisma.productionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { productionOrderId: 'op-1' },
          orderBy: { loggedAt: 'asc' },
        }),
      );
      expect(result).toHaveLength(2);
    });

    it('deve lançar NotFoundException para OP de outra empresa', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue(null);
      await expect(service.getLogs('op-1', 'co-outro')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── S14: getProgress ─────────────────────────────────────────────────────

  describe('getProgress', () => {
    it('deve retornar percentual de conclusão correto', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: 'IN_PROGRESS',
        plannedQty: '10',
        producedQty: '7',
        logs: [],
        product,
      });

      const result = await service.getProgress('op-1', 'co-1');

      expect(result.plannedQty).toBe(10);
      expect(result.producedQty).toBe(7);
      expect(result.pctComplete).toBe(70);
    });

    it('deve agregar qty por etapa do roteiro', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: 'IN_PROGRESS',
        plannedQty: '10',
        producedQty: '5',
        product,
        logs: [
          { id: 'l1', qty: '3', stepOrder: 1, routingStepId: 'rs-1', routingStep: { id: 'rs-1', stepOrder: 1, name: 'Corte' } },
          { id: 'l2', qty: '2', stepOrder: 2, routingStepId: 'rs-2', routingStep: { id: 'rs-2', stepOrder: 2, name: 'Solda' } },
          { id: 'l3', qty: '1', stepOrder: 1, routingStepId: 'rs-1', routingStep: { id: 'rs-1', stepOrder: 1, name: 'Corte' } },
        ],
      });

      const result = await service.getProgress('op-1', 'co-1');

      expect(result.byStep).toHaveLength(2);
      const corte = result.byStep.find((s) => s.stepName === 'Corte');
      expect(corte?.totalQty).toBe(4); // 3 + 1
      expect(corte?.entries).toBe(2);
    });

    it('deve lançar NotFoundException para OP inexistente', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue(null);
      await expect(service.getProgress('op-x', 'co-1')).rejects.toThrow(NotFoundException);
    });
  });
});
