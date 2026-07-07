import { Test } from '@nestjs/testing';
import { FinanceKpiService } from './finance-kpi.service';
import { PrismaService } from '../../prisma/prisma.service';

const dias = (n: number) => n * 86_400_000;

const mockPrisma = {
  financialEntry: {
    findMany: jest.fn(),
    groupBy: jest.fn(),
    aggregate: jest.fn(),
  },
  bankAccount: { findMany: jest.fn() },
  stockBalance: { findMany: jest.fn() },
  saleItem: { findMany: jest.fn() },
  fiscalDocumentItem: { findMany: jest.fn() },
};

describe('FinanceKpiService (#382/#387)', () => {
  let service: FinanceKpiService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [FinanceKpiService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(FinanceKpiService);
    jest.clearAllMocks();
    // defaults: tudo vazio
    mockPrisma.financialEntry.findMany.mockResolvedValue([]);
    mockPrisma.financialEntry.groupBy.mockResolvedValue([]);
    mockPrisma.financialEntry.aggregate.mockResolvedValue({ _sum: { paidAmount: null, amount: null } });
    mockPrisma.bankAccount.findMany.mockResolvedValue([]);
    mockPrisma.stockBalance.findMany.mockResolvedValue([]);
    mockPrisma.saleItem.findMany.mockResolvedValue([]);
    mockPrisma.fiscalDocumentItem.findMany.mockResolvedValue([]);
  });

  it('calcula PMP e PMR como média de paidAt − createdAt em dias', async () => {
    const base = new Date('2026-06-01T12:00:00Z');
    // PAYABLE: 30 e 40 dias → PMP 35; RECEIVABLE: 10 e 20 → PMR 15
    mockPrisma.financialEntry.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.type === 'PAYABLE'
          ? [
              { createdAt: base, paidAt: new Date(base.getTime() + dias(30)) },
              { createdAt: base, paidAt: new Date(base.getTime() + dias(40)) },
            ]
          : [
              { createdAt: base, paidAt: new Date(base.getTime() + dias(10)) },
              { createdAt: base, paidAt: new Date(base.getTime() + dias(20)) },
            ],
      ),
    );
    const kpis = await service.getKpis('co-1');
    expect(kpis.pmp).toBe(35);
    expect(kpis.pmr).toBe(15);
    // ciclo = PMR + PME(0, sem estoque) − PMP = 15 − 35 = −20
    expect(kpis.cicloFinanceiro).toBe(-20);
  });

  it('cash runway = caixa / média de saídas diárias (90d) (#387)', async () => {
    mockPrisma.bankAccount.findMany.mockResolvedValue([{ balance: 90000 }]);
    // R$ 90.000 pagos em 90d → média 1.000/dia → runway 90 dias
    mockPrisma.financialEntry.aggregate.mockResolvedValue({ _sum: { paidAmount: 90000, amount: 90000 } });
    const kpis = await service.getKpis('co-1');
    expect(kpis.mediaSaidasDiarias).toBe(1000);
    expect(kpis.cashRunwayDias).toBe(90);
  });

  it('endividamento líquido e liquidez corrente a partir dos abertos (#387)', async () => {
    mockPrisma.bankAccount.findMany.mockResolvedValue([{ balance: 50000 }]);
    mockPrisma.financialEntry.groupBy.mockResolvedValue([
      { type: 'RECEIVABLE', _sum: { amount: 40000, paidAmount: 10000 } }, // 30k abertos
      { type: 'PAYABLE', _sum: { amount: 20000, paidAmount: 0 } }, // 20k abertos
    ]);
    const kpis = await service.getKpis('co-1');
    expect(kpis.recebiveisAbertos).toBe(30000);
    expect(kpis.pagaveisAbertos).toBe(20000);
    // endividamento = 20k − 50k = −30k (mais caixa que dívida)
    expect(kpis.endividamentoLiquido).toBe(-30000);
    // liquidez = (50k + 30k) / 20k = 4
    expect(kpis.liquidezCorrente).toBe(4);
  });

  it('PME por giro: estoque R$10k, CPV R$30k em 90d → 30 dias', async () => {
    mockPrisma.stockBalance.findMany.mockResolvedValue([
      { available: 10, product: { avgCost: 1000 } }, // estoque 10k
    ]);
    mockPrisma.saleItem.findMany.mockResolvedValue([
      { quantity: 30, product: { avgCost: 1000 } }, // CPV 30k
    ]);
    const kpis = await service.getKpis('co-1', { from: '2026-04-01', to: '2026-06-30' });
    // (10000/30000) × 90 = 30 dias (período de 90 dias, ±1 por fuso)
    expect(kpis.pme).toBeGreaterThanOrEqual(29.5);
    expect(kpis.pme).toBeLessThanOrEqual(30.5);
  });

  it('sem dados retorna nulls e zeros sem quebrar', async () => {
    const kpis = await service.getKpis('co-1');
    expect(kpis.pmp).toBeNull();
    expect(kpis.pmr).toBeNull();
    expect(kpis.pme).toBeNull();
    expect(kpis.cicloFinanceiro).toBeNull();
    expect(kpis.cashRunwayDias).toBeNull();
    expect(kpis.liquidezCorrente).toBeNull();
    expect(kpis.caixaDisponivel).toBe(0);
    expect(kpis.endividamentoLiquido).toBe(0);
  });

  // ─── Margem de contribuição por SKU (#386) ────────────────────────────────

  it('margem por SKU: receita − custo − impostos, ordenada por margem', async () => {
    mockPrisma.saleItem.findMany.mockResolvedValue([
      { productId: 'p1', quantity: 2, unitPrice: 5000, product: { sku: 'MOD-CAR-001', name: 'Carga 1,5m', avgCost: 3000 } },
      { productId: 'p1', quantity: 1, unitPrice: 5000, product: { sku: 'MOD-CAR-001', name: 'Carga 1,5m', avgCost: 3000 } },
      { productId: 'p2', quantity: 1, unitPrice: 800, product: { sku: 'ACC-001', name: 'Acessório', avgCost: 900 } },
    ]);
    mockPrisma.fiscalDocumentItem.findMany.mockResolvedValue([
      { productId: 'p1', taxes: [{ valorIcms: 1800, valorIpi: 0, valorPis: 0, valorCofins: 0, difalValor: 0, difalFcpValor: 0 }] },
      { productId: 'p2', taxes: [{ valorIcms: 96, valorPis: 5.2, valorCofins: 24 }] },
    ]);

    const result = await service.getMarginBySku('co-1');
    expect(result.items).toHaveLength(2);
    const p1 = result.items[0];
    // receita 15000, custo 9000, impostos 1800 → margem 4200 (28%)
    expect(p1.sku).toBe('MOD-CAR-001');
    expect(p1.quantidade).toBe(3);
    expect(p1.receita).toBe(15000);
    expect(p1.custo).toBe(9000);
    expect(p1.impostos).toBe(1800);
    expect(p1.margemContribuicao).toBe(4200);
    expect(p1.margemPct).toBe(28);
    // p2: 800 − 900 − 125.2 = −225.2 (margem NEGATIVA aparece — é o ponto do relatório)
    const p2 = result.items[1];
    expect(p2.margemContribuicao).toBe(-225.2);
    expect(result.totais.margemContribuicao).toBe(4200 - 225.2);
  });

  it('margem sem impostos persistidos usa 0 (não quebra)', async () => {
    mockPrisma.saleItem.findMany.mockResolvedValue([
      { productId: 'p1', quantity: 1, unitPrice: 1000, product: { sku: 'X', name: 'X', avgCost: 400 } },
    ]);
    const result = await service.getMarginBySku('co-1');
    expect(result.items[0].impostos).toBe(0);
    expect(result.items[0].margemContribuicao).toBe(600);
  });

});
