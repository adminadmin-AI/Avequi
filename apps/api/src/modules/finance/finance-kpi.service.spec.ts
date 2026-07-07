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
});
