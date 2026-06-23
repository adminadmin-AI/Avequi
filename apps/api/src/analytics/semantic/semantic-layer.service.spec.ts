import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { SemanticLayerService } from './semantic-layer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/filters/business-exception.filter';

const COMPANY = 'company-1';

const mockCustomMetric = {
  id: 'metric-custom-1',
  companyId: COMPANY,
  name: 'avg_cost',
  displayName: 'Custo Médio',
  description: null,
  dataSource: 'sales',
  expression: 'AVG(costPrice)',
  unit: 'BRL',
  format: 'currency',
  isBuiltIn: false,
  category: 'FINANCIAL',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockCustomDimension = {
  id: 'dim-custom-1',
  companyId: COMPANY,
  name: 'sales_rep',
  displayName: 'Representante',
  description: null,
  dataSource: 'sales',
  field: 'salesRepId',
  hierarchy: null,
  isBuiltIn: false,
  createdAt: new Date(),
};

const mockPrisma = {
  metricDefinition: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  dimensionDefinition: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
  },
};

describe('SemanticLayerService', () => {
  let service: SemanticLayerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SemanticLayerService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SemanticLayerService>(SemanticLayerService);
    jest.clearAllMocks();
  });

  // ─── getBuiltInMetrics ─────────────────────────────────────────────────────

  describe('getBuiltInMetrics()', () => {
    it('returns 15 built-in metrics', () => {
      const metrics = service.getBuiltInMetrics();
      expect(metrics).toHaveLength(15);
    });

    it('all built-in metrics have required fields', () => {
      const metrics = service.getBuiltInMetrics();
      for (const m of metrics) {
        expect(m.name).toBeTruthy();
        expect(m.displayName).toBeTruthy();
        expect(m.dataSource).toBeTruthy();
        expect(m.expression).toBeTruthy();
        expect(m.isBuiltIn).toBe(true);
      }
    });

    it('includes revenue metric with correct format', () => {
      const metrics = service.getBuiltInMetrics();
      const revenue = metrics.find((m) => m.name === 'revenue');
      expect(revenue).toBeDefined();
      expect(revenue?.unit).toBe('BRL');
      expect(revenue?.format).toBe('currency');
      expect(revenue?.category).toBe('COMMERCIAL');
    });

    it('includes profit_margin with percent format', () => {
      const metrics = service.getBuiltInMetrics();
      const pm = metrics.find((m) => m.name === 'profit_margin');
      expect(pm).toBeDefined();
      expect(pm?.format).toBe('percent');
      expect(pm?.unit).toBe('%');
    });

    it('includes metrics from all categories', () => {
      const metrics = service.getBuiltInMetrics();
      const categories = new Set(metrics.map((m) => m.category));
      expect(categories.has('COMMERCIAL')).toBe(true);
      expect(categories.has('OPERATIONAL')).toBe(true);
      expect(categories.has('FINANCIAL')).toBe(true);
    });
  });

  // ─── getBuiltInDimensions ──────────────────────────────────────────────────

  describe('getBuiltInDimensions()', () => {
    it('returns 8 built-in dimensions', () => {
      const dims = service.getBuiltInDimensions();
      expect(dims).toHaveLength(8);
    });

    it('all built-in dimensions have required fields', () => {
      const dims = service.getBuiltInDimensions();
      for (const d of dims) {
        expect(d.name).toBeTruthy();
        expect(d.displayName).toBeTruthy();
        expect(d.field).toBeTruthy();
        expect(d.isBuiltIn).toBe(true);
      }
    });

    it('region dimension has hierarchy', () => {
      const dims = service.getBuiltInDimensions();
      const region = dims.find((d) => d.name === 'region');
      expect(region?.hierarchy).toBeTruthy();
    });

    it('includes product, customer, warehouse dimensions', () => {
      const dims = service.getBuiltInDimensions();
      const names = dims.map((d) => d.name);
      expect(names).toContain('product');
      expect(names).toContain('customer');
      expect(names).toContain('warehouse');
    });
  });

  // ─── findMetrics ───────────────────────────────────────────────────────────

  describe('findMetrics()', () => {
    it('returns built-in + custom metrics', async () => {
      mockPrisma.metricDefinition.findMany.mockResolvedValue([mockCustomMetric]);

      const result = await service.findMetrics(COMPANY);
      // 15 built-in + 1 custom
      expect(result.length).toBe(16);
      expect(result.find((m) => m.name === 'avg_cost')).toBeDefined();
      expect(result.find((m) => m.name === 'revenue')).toBeDefined();
    });

    it('queries only non-built-in metrics from db', async () => {
      mockPrisma.metricDefinition.findMany.mockResolvedValue([]);

      await service.findMetrics(COMPANY);

      expect(mockPrisma.metricDefinition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: COMPANY, isBuiltIn: false },
        }),
      );
    });
  });

  // ─── createMetric ──────────────────────────────────────────────────────────

  describe('createMetric()', () => {
    const dto = {
      name: 'avg_cost',
      displayName: 'Custo Médio',
      dataSource: 'sales',
      expression: 'AVG(costPrice)',
      unit: 'BRL',
      format: 'currency',
      category: 'FINANCIAL',
    };

    it('creates a custom metric', async () => {
      mockPrisma.metricDefinition.findFirst.mockResolvedValue(null);
      mockPrisma.metricDefinition.create.mockResolvedValue(mockCustomMetric);

      const result = await service.createMetric(COMPANY, dto);
      expect(result.name).toBe('avg_cost');
      expect(mockPrisma.metricDefinition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: COMPANY,
            name: 'avg_cost',
            isBuiltIn: false,
          }),
        }),
      );
    });

    it('throws CONFLICT if metric name already exists', async () => {
      mockPrisma.metricDefinition.findFirst.mockResolvedValue(mockCustomMetric);

      await expect(service.createMetric(COMPANY, dto)).rejects.toThrow(BusinessException);

      const err = await service.createMetric(COMPANY, dto).catch((e) => e);
      expect(err.status).toBe(HttpStatus.CONFLICT);
    });

    it('throws CONFLICT when trying to override built-in metric', async () => {
      mockPrisma.metricDefinition.findFirst.mockResolvedValue(null);

      await expect(
        service.createMetric(COMPANY, { ...dto, name: 'revenue' }),
      ).rejects.toThrow(BusinessException);
    });
  });

  // ─── findDimensions ────────────────────────────────────────────────────────

  describe('findDimensions()', () => {
    it('returns built-in + custom dimensions', async () => {
      mockPrisma.dimensionDefinition.findMany.mockResolvedValue([mockCustomDimension]);

      const result = await service.findDimensions(COMPANY);
      // 8 built-in + 1 custom
      expect(result.length).toBe(9);
    });

    it('queries only non-built-in dimensions', async () => {
      mockPrisma.dimensionDefinition.findMany.mockResolvedValue([]);

      await service.findDimensions(COMPANY);

      expect(mockPrisma.dimensionDefinition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: COMPANY, isBuiltIn: false },
        }),
      );
    });
  });

  // ─── createDimension ───────────────────────────────────────────────────────

  describe('createDimension()', () => {
    const dto = {
      name: 'sales_rep',
      displayName: 'Representante de Vendas',
      dataSource: 'sales',
      field: 'salesRepId',
    };

    it('creates a custom dimension', async () => {
      mockPrisma.dimensionDefinition.findFirst.mockResolvedValue(null);
      mockPrisma.dimensionDefinition.create.mockResolvedValue(mockCustomDimension);

      const result = await service.createDimension(COMPANY, dto);
      expect(result.name).toBe('sales_rep');
    });

    it('throws CONFLICT if dimension already exists', async () => {
      mockPrisma.dimensionDefinition.findFirst.mockResolvedValue(mockCustomDimension);

      await expect(service.createDimension(COMPANY, dto)).rejects.toThrow(BusinessException);
    });

    it('throws CONFLICT when trying to override built-in dimension', async () => {
      mockPrisma.dimensionDefinition.findFirst.mockResolvedValue(null);

      await expect(
        service.createDimension(COMPANY, { ...dto, name: 'product' }),
      ).rejects.toThrow(BusinessException);
    });
  });

  // ─── getDataDictionary ─────────────────────────────────────────────────────

  describe('getDataDictionary()', () => {
    it('returns metrics and dimensions with generatedAt', async () => {
      mockPrisma.metricDefinition.findMany.mockResolvedValue([]);
      mockPrisma.dimensionDefinition.findMany.mockResolvedValue([]);

      const dict = await service.getDataDictionary(COMPANY);

      expect(dict.metrics).toHaveLength(15);
      expect(dict.dimensions).toHaveLength(8);
      expect(dict.generatedAt).toBeTruthy();
    });

    it('includes custom entries in dictionary', async () => {
      mockPrisma.metricDefinition.findMany.mockResolvedValue([mockCustomMetric]);
      mockPrisma.dimensionDefinition.findMany.mockResolvedValue([mockCustomDimension]);

      const dict = await service.getDataDictionary(COMPANY);

      expect(dict.metrics.find((m) => m.name === 'avg_cost')).toBeDefined();
      expect(dict.dimensions.find((d) => d.name === 'sales_rep')).toBeDefined();
    });

    it('each metric entry has all required fields', async () => {
      mockPrisma.metricDefinition.findMany.mockResolvedValue([]);
      mockPrisma.dimensionDefinition.findMany.mockResolvedValue([]);

      const dict = await service.getDataDictionary(COMPANY);
      const metric = dict.metrics[0];

      expect(metric).toHaveProperty('name');
      expect(metric).toHaveProperty('displayName');
      expect(metric).toHaveProperty('dataSource');
      expect(metric).toHaveProperty('expression');
      expect(metric).toHaveProperty('isBuiltIn');
    });
  });
});
