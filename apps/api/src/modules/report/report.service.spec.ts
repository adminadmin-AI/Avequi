import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { ReportService } from './report.service';
import { PrismaService } from '../../prisma/prisma.service';
import { REPORT_QUEUE } from './report.types';

const COMPANY = 'comp-1';

const mockPrisma = {
  product: { findMany: jest.fn() },
  customer: { findMany: jest.fn() },
  supplier: { findMany: jest.fn() },
  salesOrder: { findMany: jest.fn() },
  purchaseOrder: { findMany: jest.fn() },
  stockBalance: { findMany: jest.fn() },
  financialEntry: { findMany: jest.fn() },
  pOItem: { findMany: jest.fn() },
  stockMovement: { findMany: jest.fn(), groupBy: jest.fn() },
  productionOrder: { findMany: jest.fn() },
};

const mockJob = {
  id: '1',
  progress: jest.fn().mockReturnValue(100),
  getState: jest.fn().mockResolvedValue('completed'),
  returnvalue: null as unknown,
  failedReason: null,
};

const mockQueue = {
  add: jest.fn().mockResolvedValue({ id: '42' }),
  getJob: jest.fn().mockResolvedValue(mockJob),
};

describe('ReportService', () => {
  let service: ReportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken(REPORT_QUEUE), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<ReportService>(ReportService);
    jest.clearAllMocks();
    mockJob.returnvalue = null;
    mockJob.getState.mockResolvedValue('completed');
  });

  // ─── Exports síncronos ────────────────────────────────────────────────────

  describe('exportProducts', () => {
    it('retorna StreamableFile com produtos', async () => {
      mockPrisma.product.findMany.mockResolvedValue([
        {
          id: 'p1',
          sku: 'SKU-001',
          name: 'Produto A',
          unit: 'UN',
          type: 'FINISHED',
          costPrice: 10,
          salePrice: 20,
          avgCost: 11,
          isActive: true,
          stockBalances: [{ available: 50, reserved: 5 }],
        },
      ]);
      const result = await service.exportProducts(COMPANY);
      expect(result).toBeDefined();
      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: COMPANY } }),
      );
    });
  });

  describe('exportCustomers', () => {
    it('retorna StreamableFile com clientes', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([
        {
          id: 'c1',
          name: 'Cliente A',
          document: '12345678000100',
          email: 'a@a.com',
          phone: '11999',
          city: 'SP',
          state: 'SP',
          isActive: true,
        },
      ]);
      const result = await service.exportCustomers(COMPANY);
      expect(result).toBeDefined();
    });
  });

  describe('exportSuppliers', () => {
    it('retorna StreamableFile com fornecedores', async () => {
      mockPrisma.supplier.findMany.mockResolvedValue([
        {
          id: 's1',
          name: 'Fornecedor A',
          cnpj: '12345678000100',
          email: 'f@f.com',
          phone: '11888',
          leadTimeDays: 5,
          isActive: true,
        },
      ]);
      const result = await service.exportSuppliers(COMPANY);
      expect(result).toBeDefined();
    });
  });

  describe('exportSales', () => {
    it('calcula total a partir dos itens e retorna StreamableFile', async () => {
      mockPrisma.salesOrder.findMany.mockResolvedValue([
        {
          id: 'so-aabbccdd11223344',
          status: 'INVOICED',
          createdAt: new Date('2026-01-01'),
          customer: { name: 'Cliente X' },
          createdBy: { name: 'User A' },
          items: [
            { quantity: 2, unitPrice: 100 },
            { quantity: 1, unitPrice: 50 },
          ],
        },
      ]);
      const result = await service.exportSales(COMPANY);
      expect(result).toBeDefined();
    });
  });

  describe('exportPurchases', () => {
    it('calcula total a partir dos itens e retorna StreamableFile', async () => {
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([
        {
          id: 'po-aabbccdd11223344',
          status: 'RECEIVED',
          createdAt: new Date('2026-01-01'),
          supplier: { name: 'Fornecedor Y' },
          items: [{ quantity: 10, unitCost: 25 }],
        },
      ]);
      const result = await service.exportPurchases(COMPANY);
      expect(result).toBeDefined();
    });
  });

  describe('exportStock', () => {
    it('retorna StreamableFile com saldos de estoque', async () => {
      mockPrisma.stockBalance.findMany.mockResolvedValue([
        {
          productId: 'p1',
          available: 100,
          reserved: 10,
          inTransit: 0,
          product: { sku: 'SKU-001', name: 'Produto A', unit: 'UN', avgCost: 10 },
          warehouse: { code: 'ALM-FAB', name: 'Almoxarifado Fábrica' },
        },
      ]);
      const result = await service.exportStock(COMPANY);
      expect(result).toBeDefined();
    });
  });

  describe('exportAging', () => {
    it('retorna StreamableFile com entradas vencidas', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 45);

      mockPrisma.financialEntry.findMany.mockResolvedValue([
        {
          id: 'fe1',
          amount: 1500,
          dueDate: pastDate,
          salesOrder: {
            id: 'so-aabb11223344',
            customer: { name: 'Devedor' },
          },
        },
      ]);
      const result = await service.exportAging(COMPANY);
      expect(result).toBeDefined();
      expect(mockPrisma.financialEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: COMPANY, type: 'RECEIVABLE', status: 'OVERDUE' },
        }),
      );
    });
  });

  describe('exportPurchasesBySupplier', () => {
    it('agrupa itens por fornecedor e retorna StreamableFile', async () => {
      mockPrisma.pOItem.findMany.mockResolvedValue([
        {
          quantity: 10,
          unitCost: 50,
          purchaseOrder: { supplier: { name: 'Forn A' } },
          product: { sku: 'SKU-001', name: 'Prod A' },
        },
        {
          quantity: 5,
          unitCost: 50,
          purchaseOrder: { supplier: { name: 'Forn A' } },
          product: { sku: 'SKU-001', name: 'Prod A' },
        },
      ]);
      const result = await service.exportPurchasesBySupplier(COMPANY);
      expect(result).toBeDefined();
    });
  });

  // ─── Assíncronos ─────────────────────────────────────────────────────────

  describe('enqueueReport', () => {
    it('enfileira job e retorna jobId', async () => {
      const result = await service.enqueueReport(COMPANY, 'stock-abc');
      expect(result.jobId).toBe('42');
      expect(result.message).toContain('stock-abc');
      expect(mockQueue.add).toHaveBeenCalledWith(
        'stock-abc',
        expect.objectContaining({ companyId: COMPANY }),
        expect.any(Object),
      );
    });
  });

  describe('getJobStatus', () => {
    it('retorna status completed com downloadUrl', async () => {
      mockJob.returnvalue = { filePath: '/tmp/gdr-report-test.xlsx' };
      const result = await service.getJobStatus('1');
      expect(result.status).toBe('completed');
      expect(result.downloadUrl).toContain('/api/reports/1/download');
    });

    it('lança NotFoundException quando job não existe', async () => {
      mockQueue.getJob.mockResolvedValueOnce(null);
      await expect(service.getJobStatus('999')).rejects.toThrow(NotFoundException);
    });

    it('retorna status pending sem downloadUrl', async () => {
      mockJob.getState.mockResolvedValueOnce('waiting');
      mockJob.returnvalue = null;
      const result = await service.getJobStatus('1');
      expect(result.status).toBe('waiting');
      expect(result.downloadUrl).toBeUndefined();
    });
  });

  describe('downloadReport', () => {
    it('lança NotFoundException quando job não existe', async () => {
      mockQueue.getJob.mockResolvedValueOnce(null);
      await expect(service.downloadReport('999')).rejects.toThrow(NotFoundException);
    });

    it('lança NotFoundException quando job não está completed', async () => {
      mockJob.getState.mockResolvedValueOnce('active');
      await expect(service.downloadReport('1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Geradores pesados ────────────────────────────────────────────────────

  describe('generateCostHistory', () => {
    it('gera arquivo xlsx e retorna caminho', async () => {
      mockPrisma.stockMovement.findMany.mockResolvedValue([
        {
          productId: 'p1',
          quantity: 100,
          createdAt: new Date('2026-01-15'),
          product: { sku: 'SKU-001', name: 'Prod A', unit: 'UN', avgCost: 12 },
        },
        {
          productId: 'p1',
          quantity: 50,
          createdAt: new Date('2026-02-10'),
          product: { sku: 'SKU-001', name: 'Prod A', unit: 'UN', avgCost: 14 },
        },
      ]);
      const filePath = await service.generateCostHistory(COMPANY);
      expect(filePath).toMatch(/custo-historico.*\.xlsx$/);
      expect(mockPrisma.stockMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: COMPANY, type: 'ENTRY' } }),
      );
      // limpeza
      const fs = await import('fs');
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
  });

  describe('generateStockAbc', () => {
    it('gera curva ABC e retorna caminho do arquivo', async () => {
      mockPrisma.stockBalance.findMany.mockResolvedValue([
        {
          productId: 'p1',
          available: 100,
          reserved: 0,
          product: { sku: 'SKU-001', name: 'Prod A', unit: 'UN', salePrice: 20, avgCost: 10 },
        },
        {
          productId: 'p2',
          available: 5,
          reserved: 0,
          product: { sku: 'SKU-002', name: 'Prod B', unit: 'UN', salePrice: 5, avgCost: 3 },
        },
      ]);
      mockPrisma.stockMovement.groupBy.mockResolvedValue([
        { productId: 'p1', _sum: { quantity: 200 }, _count: { id: 10 } },
        { productId: 'p2', _sum: { quantity: 10 }, _count: { id: 2 } },
      ]);

      const filePath = await service.generateStockAbc(COMPANY);
      expect(filePath).toMatch(/estoque-abc.*\.xlsx$/);
      const fs = await import('fs');
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
  });

  describe('generateProductionEfficiency', () => {
    it('gera relatório de eficiência e retorna caminho', async () => {
      mockPrisma.productionOrder.findMany.mockResolvedValue([
        {
          id: 'op-aabbccdd11223344',
          plannedQty: 100,
          producedQty: 95,
          completedAt: new Date('2026-03-01'),
          product: { sku: 'SKU-001', name: 'Prod A' },
          cost: { materialCost: 500, totalCost: 600, costPerUnit: 6 },
          logs: [{}, {}, {}],
        },
        {
          id: 'op-eeff55667788',
          plannedQty: 50,
          producedQty: 40,
          completedAt: new Date('2026-03-15'),
          product: { sku: 'SKU-002', name: 'Prod B' },
          cost: null,
          logs: [{}],
        },
      ]);

      const filePath = await service.generateProductionEfficiency(COMPANY);
      expect(filePath).toMatch(/eficiencia-producao.*\.xlsx$/);
      const fs = await import('fs');
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
  });
});
