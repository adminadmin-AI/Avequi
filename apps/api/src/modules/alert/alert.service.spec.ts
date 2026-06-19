import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AlertType, AlertSeverity } from '@prisma/client';
import { AlertService } from './alert.service';
import { PrismaService } from '../../prisma/prisma.service';

const COMPANY = 'comp-1';

const mockPrisma = {
  alert: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  stockBalance: { findMany: jest.fn() },
  financialEntry: { findMany: jest.fn() },
  productionOrder: { findMany: jest.fn() },
  fiscalDocument: { findMany: jest.fn() },
};

describe('AlertService', () => {
  let service: AlertService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AlertService>(AlertService);
    jest.clearAllMocks();
    mockPrisma.alert.findFirst.mockResolvedValue(null); // sem duplicata por padrão
    mockPrisma.alert.create.mockResolvedValue({ id: 'alert-1' });
  });

  // ─── checkStockMin ─────────────────────────────────────────────────────────

  describe('checkStockMin', () => {
    it('dispara alerta quando available < minStock', async () => {
      mockPrisma.stockBalance.findMany.mockResolvedValue([
        {
          productId: 'p1',
          available: 5,
          reserved: 0,
          product: { id: 'p1', sku: 'SKU-001', name: 'Prod A', minStock: 10 },
        },
      ]);

      const count = await service.checkStockMin(COMPANY);
      expect(count).toBe(1);
      expect(mockPrisma.alert.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: AlertType.STOCK_MIN,
            severity: AlertSeverity.WARNING,
            entityId: 'p1',
          }),
        }),
      );
    });

    it('não dispara quando available >= minStock', async () => {
      mockPrisma.stockBalance.findMany.mockResolvedValue([
        {
          productId: 'p1',
          available: 15,
          reserved: 0,
          product: { id: 'p1', sku: 'SKU-001', name: 'Prod A', minStock: 10 },
        },
      ]);

      const count = await service.checkStockMin(COMPANY);
      expect(count).toBe(0);
      expect(mockPrisma.alert.create).not.toHaveBeenCalled();
    });

    it('ignora produtos com minStock = 0', async () => {
      mockPrisma.stockBalance.findMany.mockResolvedValue([
        {
          productId: 'p1',
          available: 0,
          reserved: 0,
          product: { id: 'p1', sku: 'SKU-001', name: 'Prod A', minStock: 0 },
        },
      ]);

      const count = await service.checkStockMin(COMPANY);
      expect(count).toBe(0);
    });

    it('não cria duplicata se alerta ativo já existe', async () => {
      mockPrisma.stockBalance.findMany.mockResolvedValue([
        {
          productId: 'p1',
          available: 3,
          reserved: 0,
          product: { id: 'p1', sku: 'SKU-001', name: 'Prod A', minStock: 10 },
        },
      ]);
      // alerta já existe
      mockPrisma.alert.findFirst.mockResolvedValue({ id: 'alert-existing' });

      await service.checkStockMin(COMPANY);
      expect(mockPrisma.alert.create).not.toHaveBeenCalled();
    });

    it('agrega disponível de múltiplos armazéns antes de comparar', async () => {
      mockPrisma.stockBalance.findMany.mockResolvedValue([
        {
          productId: 'p1',
          available: 4,
          reserved: 0,
          product: { id: 'p1', sku: 'SKU-001', name: 'Prod A', minStock: 10 },
        },
        {
          productId: 'p1',
          available: 7, // segundo armazém: total = 11 >= 10
          reserved: 0,
          product: { id: 'p1', sku: 'SKU-001', name: 'Prod A', minStock: 10 },
        },
      ]);

      const count = await service.checkStockMin(COMPANY);
      expect(count).toBe(0); // 4+7=11 >= 10
    });
  });

  // ─── checkPayableDue ───────────────────────────────────────────────────────

  describe('checkPayableDue', () => {
    it('dispara alerta WARNING para CP vencendo em 3 dias', async () => {
      const in3days = new Date();
      in3days.setDate(in3days.getDate() + 3);

      mockPrisma.financialEntry.findMany.mockResolvedValue([
        {
          id: 'fe-1',
          amount: 5000,
          dueDate: in3days,
          purchaseOrder: { supplier: { name: 'Forn A' } },
        },
      ]);

      const count = await service.checkPayableDue(COMPANY);
      expect(count).toBe(1);
      expect(mockPrisma.alert.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: AlertType.PAYABLE_DUE,
            severity: AlertSeverity.WARNING,
          }),
        }),
      );
    });

    it('dispara alerta CRITICAL para CP já vencido', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      mockPrisma.financialEntry.findMany.mockResolvedValue([
        {
          id: 'fe-2',
          amount: 2000,
          dueDate: yesterday,
          purchaseOrder: { supplier: { name: 'Forn B' } },
        },
      ]);

      await service.checkPayableDue(COMPANY);
      expect(mockPrisma.alert.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            severity: AlertSeverity.CRITICAL,
          }),
        }),
      );
    });

    it('retorna 0 quando não há CP vencendo', async () => {
      mockPrisma.financialEntry.findMany.mockResolvedValue([]);
      const count = await service.checkPayableDue(COMPANY);
      expect(count).toBe(0);
    });
  });

  // ─── checkProductionLate ───────────────────────────────────────────────────

  describe('checkProductionLate', () => {
    it('dispara alerta para OP IN_PROGRESS com scheduledEnd no passado', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 2);

      mockPrisma.productionOrder.findMany.mockResolvedValue([
        {
          id: 'op-1',
          scheduledEnd: yesterday,
          product: { sku: 'SKU-001', name: 'Prod A' },
        },
      ]);

      const count = await service.checkProductionLate(COMPANY);
      expect(count).toBe(1);
      expect(mockPrisma.alert.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: AlertType.PRODUCTION_LATE,
            entityId: 'op-1',
            entityType: 'ProductionOrder',
          }),
        }),
      );
    });

    it('retorna 0 quando não há OPs atrasadas', async () => {
      mockPrisma.productionOrder.findMany.mockResolvedValue([]);
      const count = await service.checkProductionLate(COMPANY);
      expect(count).toBe(0);
    });
  });

  // ─── checkNfeRejected ──────────────────────────────────────────────────────

  describe('checkNfeRejected', () => {
    it('dispara alerta CRITICAL para NF-e rejeitada', async () => {
      mockPrisma.fiscalDocument.findMany.mockResolvedValue([
        {
          id: 'fd-1',
          rejectionCode: '225',
          rejectionReason: 'CNPJ emitente inválido',
          salesOrder: { customer: { name: 'Cliente X' } },
        },
      ]);

      const count = await service.checkNfeRejected(COMPANY);
      expect(count).toBe(1);
      expect(mockPrisma.alert.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: AlertType.NFE_REJECTED,
            severity: AlertSeverity.CRITICAL,
          }),
        }),
      );
    });
  });

  // ─── notifyMrpRunDone ──────────────────────────────────────────────────────

  describe('notifyMrpRunDone', () => {
    it('cria alerta INFO com contagem de sugestões', async () => {
      await service.notifyMrpRunDone(COMPANY, 'run-1', 15);
      expect(mockPrisma.alert.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: AlertType.MRP_RUN_DONE,
            severity: AlertSeverity.INFO,
          }),
        }),
      );
    });
  });

  // ─── resolve ───────────────────────────────────────────────────────────────

  describe('resolve', () => {
    it('resolve alerta existente', async () => {
      mockPrisma.alert.findFirst.mockResolvedValue({ id: 'alert-1', companyId: COMPANY });
      mockPrisma.alert.update.mockResolvedValue({
        id: 'alert-1',
        resolvedAt: new Date(),
      });

      const result = await service.resolve('alert-1', COMPANY);
      expect(result.resolvedAt).toBeDefined();
      expect(mockPrisma.alert.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'alert-1' } }),
      );
    });

    it('lança NotFoundException quando alerta não existe', async () => {
      mockPrisma.alert.findFirst.mockResolvedValue(null);
      await expect(service.resolve('nao-existe', COMPANY)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── listActive / listAll ──────────────────────────────────────────────────

  describe('listActive', () => {
    it('busca apenas alertas sem resolvedAt', async () => {
      mockPrisma.alert.findMany.mockResolvedValue([
        { id: 'a1', type: AlertType.STOCK_MIN, resolvedAt: null },
      ]);
      const result = await service.listActive(COMPANY);
      expect(result).toHaveLength(1);
      expect(mockPrisma.alert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ resolvedAt: null }),
        }),
      );
    });
  });

  // ─── runAllChecks ──────────────────────────────────────────────────────────

  describe('runAllChecks', () => {
    it('executa todos os checks em paralelo e retorna contagens', async () => {
      mockPrisma.stockBalance.findMany.mockResolvedValue([]);
      mockPrisma.financialEntry.findMany.mockResolvedValue([]);
      mockPrisma.productionOrder.findMany.mockResolvedValue([]);
      mockPrisma.fiscalDocument.findMany.mockResolvedValue([]);

      const result = await service.runAllChecks(COMPANY);
      expect(result).toEqual({
        stockMin: 0,
        payableDue: 0,
        productionLate: 0,
        nfeRejected: 0,
      });
    });
  });
});
