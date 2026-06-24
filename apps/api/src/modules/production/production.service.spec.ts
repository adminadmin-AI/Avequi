import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { ProductionService } from './production.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockTx = {
  productionOrder: { findFirst: jest.fn(), update: jest.fn() },
  productionOrderItem: { update: jest.fn() },
  productionCost: { create: jest.fn() },
  productionLog: { findMany: jest.fn() },
  workCenter: { findMany: jest.fn() },
  stockBalance: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  stockMovement: { create: jest.fn() },
  product: { update: jest.fn() },
  inspection: { create: jest.fn(), updateMany: jest.fn() },
  nonConformance: { create: jest.fn() },
  auditLog: { create: jest.fn() },
};

const mockPrisma = {
  product: { findFirst: jest.fn() },
  warehouse: { findFirst: jest.fn() },
  bomVersion: { findFirst: jest.fn() },
  productionOrder: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  productionOrderItem: { update: jest.fn() },
  productionCost: { findUnique: jest.fn() },
  productionLog: { create: jest.fn(), findMany: jest.fn() },
  routingStep: { findFirst: jest.fn() },
  stockBalance: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  stockMovement: { create: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn((fn: (tx: any) => any) => fn(mockTx)),
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const product = { id: 'p-1', sku: 'PA001', name: 'Reboque 3 Eixos', unit: 'UN', avgCost: null };
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
    {
      id: 'poi-1',
      componentId: 'c-1',
      plannedQty: '10',
      consumedQty: '0',
      unit: 'UN',
      component: { id: 'c-1', sku: 'MP001', name: 'Chapa de Aço', unit: 'UN', avgCost: '5.00' },
    },
    {
      id: 'poi-2',
      componentId: 'c-2',
      plannedQty: '20',
      consumedQty: '0',
      unit: 'KG',
      component: { id: 'c-2', sku: 'MP002', name: 'Tinta Esmalte', unit: 'KG', avgCost: '3.00' },
    },
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
      providers: [
        ProductionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<ProductionService>(ProductionService);
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockTx.auditLog.create.mockResolvedValue({});
    mockTx.stockMovement.create.mockResolvedValue({});
    mockTx.productionOrderItem.update.mockResolvedValue({});
    mockTx.productionCost.create.mockResolvedValue({});
    mockTx.productionLog.findMany.mockResolvedValue([]);
    mockTx.workCenter.findMany.mockResolvedValue([]);
    mockTx.product.update.mockResolvedValue({});
    mockTx.inspection.create.mockResolvedValue({});
    mockTx.inspection.updateMany.mockResolvedValue({});
    mockTx.nonConformance.create.mockResolvedValue({});
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
                expect.objectContaining({ componentId: 'c-1', plannedQty: 10 }),
                expect.objectContaining({ componentId: 'c-2', plannedQty: 16.5 }),
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
        .mockResolvedValueOnce({ available: '15' })
        .mockResolvedValueOnce({ available: '25' });
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
      mockTx.stockBalance.findUnique.mockResolvedValue({ available: '5' });
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

  // ─── complete (S13 + S16) ─────────────────────────────────────────────────

  describe('complete', () => {
    const inProgressOrder = { ...baseOrder, status: 'IN_PROGRESS' };

    it('deve dar EXIT nos componentes, ENTRY no PA e registrar custo', async () => {
      mockTx.productionOrder.findFirst.mockResolvedValue(inProgressOrder);
      mockTx.stockBalance.findUnique.mockResolvedValue({ available: '0' });
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

      // Custo: 10×5.00 + 20×3.00 = 110, costPerUnit = 22
      expect(mockTx.productionCost.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productionOrderId: 'op-1',
            materialCost: 110,
            totalCost: 110,
            costPerUnit: 22,
          }),
        }),
      );

      expect(result.status).toBe('DONE');
    });

    it('deve consumir proporcionalmente ao encerrar parcialmente (3 de 5)', async () => {
      // ratio = 3/5 = 0.6 → c-1: 10×0.6=6, excess=4; c-2: 20×0.6=12, excess=8
      mockTx.productionOrder.findFirst.mockResolvedValue(inProgressOrder);
      mockTx.stockBalance.findUnique.mockResolvedValue({ available: '10' });
      mockTx.stockBalance.update.mockResolvedValue({});
      mockTx.productionOrder.update.mockResolvedValue({ ...inProgressOrder, status: 'DONE', producedQty: '3' });

      await service.complete('op-1', 'co-1', 3, 'u-1');

      // Excedente de c-1 (4) devolvido ao disponível
      expect(mockTx.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ warehouseId_productId: expect.objectContaining({ productId: 'c-1' }) }),
          data: {
            reserved: { decrement: 10 },
            available: { increment: 4 },
          },
        }),
      );

      // Custo: 6×5 + 12×3 = 66, costPerUnit = 66/3 = 22
      expect(mockTx.productionCost.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            materialCost: 66,
            totalCost: 66,
            costPerUnit: 22,
          }),
        }),
      );
    });

    it('deve atualizar avgCost do PA quando custo > 0 (sem estoque prévio)', async () => {
      mockTx.productionOrder.findFirst.mockResolvedValue(inProgressOrder);
      mockTx.stockBalance.findUnique.mockResolvedValue(null); // PA sem saldo
      mockTx.stockBalance.create.mockResolvedValue({});
      mockTx.productionOrder.update.mockResolvedValue({ ...inProgressOrder, status: 'DONE', producedQty: '5' });

      await service.complete('op-1', 'co-1', undefined, 'u-1');

      // newAvgCost = (0×0 + 5×22) / 5 = 22
      expect(mockTx.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p-1' },
          data: { avgCost: 22 },
        }),
      );
    });

    it('deve calcular CMPC ponderado quando PA já tem estoque', async () => {
      // Estoque existente: 10 un a R$20.00; nova produção: 5 un a R$22.00
      // newAvgCost = (10×20 + 5×22) / 15 ≈ 20.6667
      const orderWithCost = {
        ...inProgressOrder,
        product: { ...product, avgCost: '20.00' },
      };
      mockTx.productionOrder.findFirst.mockResolvedValue(orderWithCost);
      mockTx.stockBalance.findUnique.mockResolvedValue({ available: '10' });
      mockTx.stockBalance.update.mockResolvedValue({});
      mockTx.productionOrder.update.mockResolvedValue({ ...inProgressOrder, status: 'DONE', producedQty: '5' });

      await service.complete('op-1', 'co-1', undefined, 'u-1');

      expect(mockTx.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { avgCost: expect.closeTo(20.6667, 3) },
        }),
      );
    });

    it('deve lançar BadRequest quando producedQty > plannedQty', async () => {
      mockTx.productionOrder.findFirst.mockResolvedValue(inProgressOrder); // plannedQty=5
      await expect(service.complete('op-1', 'co-1', 10, 'u-1')).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequest quando producedQty = 0', async () => {
      mockTx.productionOrder.findFirst.mockResolvedValue(inProgressOrder);
      await expect(service.complete('op-1', 'co-1', 0, 'u-1')).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequest para status diferente de IN_PROGRESS', async () => {
      mockTx.productionOrder.findFirst.mockResolvedValue({ ...baseOrder, status: 'RELEASED' });
      await expect(service.complete('op-1', 'co-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── complete — custo MOD (#182) ────────────────────────────────────────

  describe('complete — labor cost (#182)', () => {
    const inProgressOrder = { ...baseOrder, status: 'IN_PROGRESS' };

    it('deve calcular custo MOD somando hoursWorked × costPerHour por WorkCenter', async () => {
      mockTx.productionOrder.findFirst.mockResolvedValue(inProgressOrder);
      mockTx.stockBalance.findUnique.mockResolvedValue({ available: '0' });
      mockTx.stockBalance.create.mockResolvedValue({});
      mockTx.productionOrder.update.mockResolvedValue({ ...inProgressOrder, status: 'DONE', producedQty: '5' });

      // Logs com horas por WorkCenter
      mockTx.productionLog.findMany.mockResolvedValue([
        { workCenter: 'CORTE', hoursWorked: '2.0' },
        { workCenter: 'CORTE', hoursWorked: '1.5' },
        { workCenter: 'SOLDA', hoursWorked: '3.0' },
      ]);
      // WorkCenter custos
      mockTx.workCenter.findMany.mockResolvedValue([
        { code: 'CORTE', costPerHour: '50.00' },
        { code: 'SOLDA', costPerHour: '80.00' },
      ]);

      await service.complete('op-1', 'co-1', undefined, 'u-1');

      // laborCost = (3.5h × R$50) + (3h × R$80) = 175 + 240 = 415
      // materialCost = 10×5 + 20×3 = 110
      // totalCost = 110 + 415 = 525
      expect(mockTx.productionCost.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            materialCost: 110,
            laborCost: 415,
            totalCost: 525,
            costPerUnit: 105, // 525/5
          }),
        }),
      );
    });

    it('deve manter laborCost=0 quando logs não têm hoursWorked', async () => {
      mockTx.productionOrder.findFirst.mockResolvedValue(inProgressOrder);
      mockTx.stockBalance.findUnique.mockResolvedValue({ available: '0' });
      mockTx.stockBalance.create.mockResolvedValue({});
      mockTx.productionOrder.update.mockResolvedValue({ ...inProgressOrder, status: 'DONE', producedQty: '5' });
      mockTx.productionLog.findMany.mockResolvedValue([
        { workCenter: null, hoursWorked: null },
      ]);

      await service.complete('op-1', 'co-1', undefined, 'u-1');

      expect(mockTx.productionCost.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            laborCost: 0,
            totalCost: 110,
          }),
        }),
      );
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
        service.addLog('op-1', 'co-1', { qty: 2 }, 'u-1'),
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

  // ─── addLog com refugo e tempo (#184) ──────────────────────────────────────

  describe('addLog — scrap & time (#184)', () => {
    const inProgressOrder = {
      ...baseOrder,
      status: 'IN_PROGRESS',
      plannedQty: '10',
      producedQty: '0',
    };
    const baseLog = {
      id: 'log-1',
      productionOrderId: 'op-1',
      qty: '5',
      scrapQuantity: '2',
      scrapReason: 'Trinca',
      startTime: new Date('2026-06-24T08:00:00Z'),
      endTime: new Date('2026-06-24T11:30:00Z'),
      hoursWorked: '3.5',
      routingStepId: null,
      stepOrder: null,
      workCenter: null,
      notes: null,
      loggedAt: new Date(),
      user: null,
      routingStep: null,
    };

    it('deve registrar refugo e acumular apenas quantidade boa', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue(inProgressOrder);
      mockPrisma.productionLog.create.mockResolvedValue(baseLog);
      mockPrisma.productionOrder.update.mockResolvedValue({});

      await service.addLog('op-1', 'co-1', { qty: 5, scrapQuantity: 2, scrapReason: 'Trinca' }, 'u-1');

      expect(mockPrisma.productionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            qty: 5,
            scrapQuantity: 2,
            scrapReason: 'Trinca',
          }),
        }),
      );
      // Acumula apenas 3 boas (5 - 2 refugo)
      expect(mockPrisma.productionOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { producedQty: { increment: 3 } },
        }),
      );
    });

    it('deve calcular hoursWorked a partir de startTime/endTime', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue(inProgressOrder);
      mockPrisma.productionLog.create.mockResolvedValue(baseLog);
      mockPrisma.productionOrder.update.mockResolvedValue({});

      await service.addLog('op-1', 'co-1', {
        qty: 3,
        startTime: '2026-06-24T08:00:00Z',
        endTime: '2026-06-24T11:30:00Z',
      }, 'u-1');

      expect(mockPrisma.productionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            startTime: expect.any(Date),
            endTime: expect.any(Date),
            hoursWorked: 3.5,
          }),
        }),
      );
    });

    it('deve lançar BadRequest quando refugo > qty total', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue(inProgressOrder);

      await expect(
        service.addLog('op-1', 'co-1', { qty: 3, scrapQuantity: 5 }, 'u-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequest quando endTime < startTime', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue(inProgressOrder);

      await expect(
        service.addLog('op-1', 'co-1', {
          qty: 3,
          startTime: '2026-06-24T12:00:00Z',
          endTime: '2026-06-24T08:00:00Z',
        }, 'u-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequest quando qty boa excede saldo pendente', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue({
        ...inProgressOrder,
        plannedQty: '5',
        producedQty: '4',
      });

      // qty=3, scrap=1 → goodQty=2, alreadyProduced=4, total=6 > planned=5
      await expect(
        service.addLog('op-1', 'co-1', { qty: 3, scrapQuantity: 1 }, 'u-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getScrapMetrics (#184) ───────────────────────────────────────────────

  describe('getScrapMetrics', () => {
    it('deve retornar métricas de refugo agrupadas por workCenter e reason', async () => {
      mockPrisma.productionLog.findMany.mockResolvedValue([
        { qty: '10', scrapQuantity: '2', scrapReason: 'Trinca', workCenter: 'WC-01', productionOrderId: 'op-1', loggedAt: new Date() },
        { qty: '8', scrapQuantity: '1', scrapReason: 'Trinca', workCenter: 'WC-01', productionOrderId: 'op-2', loggedAt: new Date() },
        { qty: '5', scrapQuantity: '3', scrapReason: 'Dimensional', workCenter: 'WC-02', productionOrderId: 'op-3', loggedAt: new Date() },
      ]);

      const result = await service.getScrapMetrics('co-1', {});

      expect(result.totalQty).toBe(23);
      expect(result.totalScrap).toBe(6);
      expect(result.scrapPct).toBeCloseTo(26.09, 1);
      expect(result.byWorkCenter).toHaveLength(2);
      expect(result.byReason).toHaveLength(2);
      expect(result.byReason[0].reason).toBe('Trinca');
      expect(result.byReason[0].scrap).toBe(3);
    });
  });

  // ─── inspeção final (#185) ──────────────────────────────────────────────

  describe('complete — inspection (#185)', () => {
    it('deve ir para PENDING_INSPECTION quando produto requer inspeção', async () => {
      const orderWithInspection = {
        ...baseOrder,
        status: 'IN_PROGRESS',
        product: { ...product, requiresFinalInspection: true },
      };
      mockTx.productionOrder.findFirst.mockResolvedValue(orderWithInspection);
      mockTx.stockBalance.findUnique.mockResolvedValue({ available: '0' });
      mockTx.productionOrder.update.mockResolvedValue({ ...orderWithInspection, status: 'PENDING_INSPECTION', producedQty: '5' });

      const result = await service.complete('op-1', 'co-1', undefined, 'u-1');

      expect(mockTx.productionOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING_INSPECTION' }),
        }),
      );
      expect(mockTx.inspection.create).toHaveBeenCalled();
      // Não deve criar stockMovement de ENTRY
      expect(mockTx.stockMovement.create).toHaveBeenCalledTimes(2); // só EXIT dos componentes
    });
  });

  describe('approveInspection (#185)', () => {
    it('deve dar entrada no estoque e mudar status para DONE', async () => {
      const pendingOrder = { ...baseOrder, status: 'PENDING_INSPECTION', producedQty: '5', product };
      mockTx.productionOrder.findFirst.mockResolvedValue(pendingOrder);
      mockTx.stockBalance.findUnique.mockResolvedValue({ available: '0' });
      mockTx.stockBalance.update.mockResolvedValue({});
      mockTx.productionOrder.update.mockResolvedValue({ ...pendingOrder, status: 'DONE' });

      const result = await service.approveInspection('op-1', 'co-1', 'u-1');

      expect(mockTx.stockBalance.update).toHaveBeenCalled();
      expect(mockTx.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'ENTRY', quantity: 5 }) }),
      );
      expect(mockTx.inspection.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PASSED' }) }),
      );
    });
  });

  describe('rejectInspection (#185)', () => {
    it('deve criar NCR e cancelar OP', async () => {
      const pendingOrder = { ...baseOrder, status: 'PENDING_INSPECTION', producedQty: '5' };
      mockTx.productionOrder.findFirst.mockResolvedValue(pendingOrder);
      mockTx.productionOrder.update.mockResolvedValue({ ...pendingOrder, status: 'CANCELLED' });

      await service.rejectInspection('op-1', 'co-1', 'Defeito visual', 'u-1');

      expect(mockTx.inspection.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
      );
      expect(mockTx.nonConformance.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ description: 'Defeito visual', severity: 'MAJOR' }) }),
      );
      expect(mockTx.productionOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
      );
    });

    it('deve lançar BadRequest se OP não está PENDING_INSPECTION', async () => {
      mockTx.productionOrder.findFirst.mockResolvedValue({ ...baseOrder, status: 'DONE' });
      await expect(service.rejectInspection('op-1', 'co-1', 'teste')).rejects.toThrow(BadRequestException);
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
      expect(corte?.totalQty).toBe(4);
      expect(corte?.entries).toBe(2);
    });

    it('deve lançar NotFoundException para OP inexistente', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue(null);
      await expect(service.getProgress('op-x', 'co-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── S16: getCost ─────────────────────────────────────────────────────────

  describe('getCost', () => {
    const doneOrder = {
      id: 'op-1',
      status: 'DONE',
      plannedQty: '5',
      producedQty: '5',
      completedAt: new Date('2026-06-18T15:00:00Z'),
    };

    const costRecord = {
      id: 'cost-1',
      productionOrderId: 'op-1',
      materialCost: '110.00',
      laborCost: '0.00',
      totalCost: '110.00',
      costPerUnit: '22.00',
      breakdown: [
        { componentId: 'c-1', sku: 'MP001', qty: 10, unitCost: 5, totalCost: 50 },
        { componentId: 'c-2', sku: 'MP002', qty: 20, unitCost: 3, totalCost: 60 },
      ],
    };

    it('deve retornar custo da OP encerrada com breakdown', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue(doneOrder);
      mockPrisma.productionCost.findUnique.mockResolvedValue(costRecord);

      const result = await service.getCost('op-1', 'co-1');

      expect(result.orderId).toBe('op-1');
      expect(result.totalCost).toBe(110);
      expect(result.costPerUnit).toBe(22);
      expect(result.materialCost).toBe(110);
      expect(result.laborCost).toBe(0);
      expect(result.breakdown).toHaveLength(2);
    });

    it('deve lançar NotFoundException se OP não tem custo ainda', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue({ ...doneOrder, status: 'IN_PROGRESS' });
      mockPrisma.productionCost.findUnique.mockResolvedValue(null);

      await expect(service.getCost('op-1', 'co-1')).rejects.toThrow(NotFoundException);
    });

    it('deve lançar NotFoundException para OP de outra empresa', async () => {
      mockPrisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(service.getCost('op-x', 'co-outro')).rejects.toThrow(NotFoundException);
    });
  });
});
