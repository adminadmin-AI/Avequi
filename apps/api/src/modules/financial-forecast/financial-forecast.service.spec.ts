import { Test, TestingModule } from '@nestjs/testing';
import { FinancialForecastService } from './financial-forecast.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  demandForecast: { findMany: jest.fn() },
  saleItem: { findMany: jest.fn() },
  product: { findMany: jest.fn() },
  financialEntry: { findMany: jest.fn() },
  budget: { findMany: jest.fn() },
};

// 15/08/2026 → trimestre corrente Q3 (jul-set); mês corrente agosto
const REF = new Date(Date.UTC(2026, 7, 15));

// 12 meses de histórico de despesas, todos 10.000 → slope 0, intercept 10.000
const flatHistory = () => {
  const currentAbs = 2026 * 12 + 7;
  const firstHist = currentAbs - 12;
  return Array.from({ length: 12 }, (_, i) => {
    const abs = firstHist + i;
    return { amount: '10000', dueDate: new Date(Date.UTC(Math.floor(abs / 12), abs % 12, 1)) };
  });
};

describe('FinancialForecastService', () => {
  let service: FinancialForecastService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FinancialForecastService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get(FinancialForecastService);
    jest.clearAllMocks();
    mockPrisma.demandForecast.findMany.mockResolvedValue([]);
    mockPrisma.saleItem.findMany.mockResolvedValue([]);
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.financialEntry.findMany.mockResolvedValue([]);
    mockPrisma.budget.findMany.mockResolvedValue([]);
  });

  it('projeta receita (demanda × preço médio) e despesa (tendência) por trimestre', async () => {
    mockPrisma.demandForecast.findMany.mockResolvedValue([
      { productId: 'p-1', period: '2026-08', quantity: '10' },
      { productId: 'p-1', period: '2026-09', quantity: '20' },
    ]);
    mockPrisma.product.findMany.mockResolvedValue([{ id: 'p-1', salePrice: '500' }]);
    mockPrisma.financialEntry.findMany
      .mockResolvedValueOnce(flatHistory()) // tendência de despesas
      .mockResolvedValueOnce([]); // realizado (despesa paga)
    mockPrisma.budget.findMany.mockResolvedValue([{ year: 2026, month: 8, amount: '12000' }]);

    const r = await service.forecast('co-1', 1, REF);

    expect(r.quarters).toHaveLength(1);
    const q3 = r.quarters[0];
    expect(q3.quarter).toBe('2026-Q3');
    expect(q3.months).toEqual(['2026-07', '2026-08', '2026-09']);
    // receita = (10 + 20) × 500 = 15000 (preço via salePrice, sem realizado)
    expect(q3.revenue).toBe(15000);
    // despesa = 3 meses × 10000 (tendência plana) = 30000
    expect(q3.expenses).toBe(30000);
    expect(q3.result).toBe(-15000);
    expect(q3.budgeted).toBe(12000);
    // tendência: slope 0, intercept 10000
    expect(r.assumptions.expenseTrend.slope).toBe(0);
    expect(r.assumptions.expenseTrend.intercept).toBe(10000);
  });

  it('detecta tendência crescente de despesas (slope positivo)', async () => {
    const currentAbs = 2026 * 12 + 7;
    const firstHist = currentAbs - 12;
    // despesas 1000, 2000, ..., 12000 → slope 1000
    const rising = Array.from({ length: 12 }, (_, i) => {
      const abs = firstHist + i;
      return { amount: String((i + 1) * 1000), dueDate: new Date(Date.UTC(Math.floor(abs / 12), abs % 12, 1)) };
    });
    mockPrisma.financialEntry.findMany.mockResolvedValueOnce(rising).mockResolvedValueOnce([]);

    const r = await service.forecast('co-1', 1, REF);
    expect(r.assumptions.expenseTrend.slope).toBe(1000);
  });

  it('trimestre parcialmente decorrido traz realizado parcial', async () => {
    // realizado só no mês já decorrido (julho); agosto/setembro ainda futuros
    mockPrisma.financialEntry.findMany
      .mockResolvedValueOnce(flatHistory())
      .mockResolvedValueOnce([{ paidAt: new Date(Date.UTC(2026, 6, 20)), paidAmount: '8000', amount: '8000' }]);

    const r = await service.forecast('co-1', 1, REF);
    const q3 = r.quarters[0];
    expect(q3.realized).not.toBeNull();
    expect(q3.realized!.expenses).toBe(8000);
    expect(q3.realized!.partial).toBe(true); // 1 de 3 meses decorrido
  });

  it('trimestre totalmente futuro tem realizado nulo', async () => {
    mockPrisma.financialEntry.findMany
      .mockResolvedValueOnce(flatHistory())
      .mockResolvedValueOnce([]);

    const r = await service.forecast('co-1', 2, REF);
    // Q4 (out-dez 2026) é totalmente futuro
    const q4 = r.quarters[1];
    expect(q4.quarter).toBe('2026-Q4');
    expect(q4.realized).toBeNull();
  });

  it('sem Budget cadastrado, budgeted é nulo', async () => {
    mockPrisma.financialEntry.findMany.mockResolvedValueOnce(flatHistory()).mockResolvedValueOnce([]);
    const r = await service.forecast('co-1', 1, REF);
    expect(r.quarters[0].budgeted).toBeNull();
  });

  it('usa preço médio realizado (ponderado) quando há vendas faturadas', async () => {
    mockPrisma.demandForecast.findMany.mockResolvedValue([{ productId: 'p-1', period: '2026-09', quantity: '10' }]);
    // preço médio ponderado = (2×600 + 3×550) / 5 = 570
    mockPrisma.saleItem.findMany.mockResolvedValue([
      { productId: 'p-1', quantity: '2', unitPrice: '600' },
      { productId: 'p-1', quantity: '3', unitPrice: '550' },
    ]);
    mockPrisma.financialEntry.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const r = await service.forecast('co-1', 1, REF);
    // setembro é futuro → sem realizado contaminando; receita = 10 × 570 = 5700
    expect(r.quarters[0].revenue).toBe(5700);
  });

  it('limita quarters ao intervalo [1,12]', async () => {
    mockPrisma.financialEntry.findMany.mockResolvedValue([]);
    const r = await service.forecast('co-1', 99, REF);
    expect(r.quarters).toHaveLength(12);
  });
});
