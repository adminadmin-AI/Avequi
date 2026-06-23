import { Test, TestingModule } from '@nestjs/testing';
import { ExportService } from './export.service';
import { DashboardService } from '../dashboard.service';
import { WidgetDataService } from '../widget-data.service';

const mockDashboardService = {
  findOne: jest.fn(),
};

const mockWidgetDataService = {
  resolveDashboard: jest.fn(),
};

const COMPANY = 'company-1';
const DASHBOARD_ID = 'dash-1';
const USER_ID = 'user-1';

const sampleData = [
  { product: 'Reboque 1', quantity: 10, revenue: 50000 },
  { product: 'Reboque 2', quantity: 5, revenue: 25000 },
];

const sampleColumns = [
  { key: 'product', label: 'Produto' },
  { key: 'quantity', label: 'Quantidade' },
  { key: 'revenue', label: 'Receita' },
];

describe('ExportService', () => {
  let service: ExportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExportService,
        { provide: DashboardService, useValue: mockDashboardService },
        { provide: WidgetDataService, useValue: mockWidgetDataService },
      ],
    }).compile();

    service = module.get<ExportService>(ExportService);
    jest.clearAllMocks();
  });

  // ─── exportCsv ─────────────────────────────────────────────────────────────

  describe('exportCsv()', () => {
    it('generates CSV with header row', () => {
      const csv = service.exportCsv(sampleData, sampleColumns);
      const lines = csv.split('\n');
      expect(lines[0]).toBe('Produto,Quantidade,Receita');
    });

    it('generates correct data rows', () => {
      const csv = service.exportCsv(sampleData, sampleColumns);
      const lines = csv.split('\n');
      expect(lines).toHaveLength(3); // header + 2 rows
      expect(lines[1]).toBe('Reboque 1,10,50000');
      expect(lines[2]).toBe('Reboque 2,5,25000');
    });

    it('escapes values containing commas', () => {
      const data = [{ name: 'Item, with comma', value: 100 }];
      const cols = [
        { key: 'name', label: 'Name' },
        { key: 'value', label: 'Value' },
      ];
      const csv = service.exportCsv(data, cols);
      expect(csv).toContain('"Item, with comma"');
    });

    it('escapes values containing double quotes', () => {
      const data = [{ name: 'Item "quoted"', value: 1 }];
      const cols = [{ key: 'name', label: 'Name' }, { key: 'value', label: 'V' }];
      const csv = service.exportCsv(data, cols);
      expect(csv).toContain('"Item ""quoted"""');
    });

    it('handles empty dataset with just header', () => {
      const csv = service.exportCsv([], sampleColumns);
      expect(csv).toBe('Produto,Quantidade,Receita');
    });

    it('handles missing fields with empty string', () => {
      const data = [{ product: 'P1' }] as Record<string, unknown>[];
      const csv = service.exportCsv(data, sampleColumns);
      expect(csv).toContain('P1,,');
    });
  });

  // ─── exportXlsx ────────────────────────────────────────────────────────────

  describe('exportXlsx()', () => {
    it('generates tab-separated values with header', () => {
      const result = service.exportXlsx(sampleData, sampleColumns);
      const lines = result.split('\n');
      expect(lines[0]).toBe('Produto\tQuantidade\tReceita');
    });

    it('generates correct data rows', () => {
      const result = service.exportXlsx(sampleData, sampleColumns);
      const lines = result.split('\n');
      expect(lines[1]).toBe('Reboque 1\t10\t50000');
    });

    it('handles empty dataset', () => {
      const result = service.exportXlsx([], sampleColumns);
      expect(result).toBe('Produto\tQuantidade\tReceita');
    });
  });

  // ─── exportHtmlReport ──────────────────────────────────────────────────────

  describe('exportHtmlReport()', () => {
    it('generates valid HTML with title', () => {
      const html = service.exportHtmlReport('Relatório de Vendas', sampleData, sampleColumns);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Relatório de Vendas');
    });

    it('includes table headers', () => {
      const html = service.exportHtmlReport('Test', sampleData, sampleColumns);
      expect(html).toContain('Produto');
      expect(html).toContain('Quantidade');
      expect(html).toContain('Receita');
    });

    it('includes table data rows', () => {
      const html = service.exportHtmlReport('Test', sampleData, sampleColumns);
      expect(html).toContain('Reboque 1');
      expect(html).toContain('50000');
    });

    it('escapes HTML special characters in data', () => {
      const data = [{ name: '<script>alert("xss")</script>', value: 1 }];
      const cols = [{ key: 'name', label: 'Name' }, { key: 'value', label: 'V' }];
      const html = service.exportHtmlReport('Test', data, cols);
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('includes metadata when provided', () => {
      const metadata = { generatedAt: '2026-06-22T00:00:00Z', companyId: COMPANY };
      const html = service.exportHtmlReport('Test', sampleData, sampleColumns, metadata);
      expect(html).toContain('2026-06-22T00:00:00Z');
    });

    it('includes Avequi ERP footer', () => {
      const html = service.exportHtmlReport('Test', [], sampleColumns);
      expect(html).toContain('Avequi ERP');
    });
  });

  // ─── exportDashboardData ───────────────────────────────────────────────────

  describe('exportDashboardData()', () => {
    const mockDashboard = { id: DASHBOARD_ID, name: 'Painel Principal' };
    const mockWidgets = [
      { title: 'Vendas', data: [{ product: 'P1', revenue: 1000 }] },
    ];

    it('exports as CSV with correct mimeType', async () => {
      mockDashboardService.findOne.mockResolvedValue(mockDashboard);
      mockWidgetDataService.resolveDashboard.mockResolvedValue(mockWidgets);

      const result = await service.exportDashboardData(COMPANY, DASHBOARD_ID, 'CSV', USER_ID);
      expect(result.mimeType).toBe('text/csv');
      expect(result.filename).toContain('.csv');
      expect(result.content).toBeTruthy();
    });

    it('exports as HTML with correct mimeType', async () => {
      mockDashboardService.findOne.mockResolvedValue(mockDashboard);
      mockWidgetDataService.resolveDashboard.mockResolvedValue(mockWidgets);

      const result = await service.exportDashboardData(COMPANY, DASHBOARD_ID, 'HTML', USER_ID);
      expect(result.mimeType).toBe('text/html');
      expect(result.content).toContain('<!DOCTYPE html>');
    });

    it('exports as XLSX with correct mimeType', async () => {
      mockDashboardService.findOne.mockResolvedValue(mockDashboard);
      mockWidgetDataService.resolveDashboard.mockResolvedValue(mockWidgets);

      const result = await service.exportDashboardData(COMPANY, DASHBOARD_ID, 'XLSX', USER_ID);
      expect(result.mimeType).toContain('spreadsheetml');
      expect(result.filename).toContain('.xlsx');
    });

    it('throws BusinessException when dashboard not found', async () => {
      mockDashboardService.findOne.mockResolvedValue(null);

      await expect(
        service.exportDashboardData(COMPANY, 'nonexistent', 'CSV', USER_ID),
      ).rejects.toThrow();
    });

    it('uses dashboard name in filename', async () => {
      mockDashboardService.findOne.mockResolvedValue(mockDashboard);
      mockWidgetDataService.resolveDashboard.mockResolvedValue([]);

      const result = await service.exportDashboardData(COMPANY, DASHBOARD_ID, 'CSV', USER_ID);
      expect(result.filename).toContain('painel');
    });
  });
});
