import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PortfolioService } from './portfolio.service';

const COMPANY = 'company-1';
const D = (n: number) => new Prisma.Decimal(n);
// período de análise (days): junho/2026; now = to = 2026-07-01
const range = { companyId: COMPANY, from: new Date('2026-06-01'), to: new Date('2026-07-01') };

/** Fábrica de OV faturada como o findMany do service seleciona. */
const order = (
  customerId: string | null,
  name: string | null,
  invoicedAt: string | null,
  items: Array<[qty: number, price: number]>,
) => ({
  customerId,
  invoicedAt: invoicedAt ? new Date(invoicedAt) : null,
  customer: name ? { name } : null,
  items: items.map(([quantity, unitPrice]) => ({ quantity: D(quantity), unitPrice: D(unitPrice) })),
});

describe('PortfolioService (#846)', () => {
  let service: PortfolioService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { salesOrder: { findMany: jest.fn().mockResolvedValue([]) } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [PortfolioService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(PortfolioService);
  });

  it('carteira vazia → zeros, sem recompra, sem intervalo', async () => {
    const res = await service.portfolio(range, 365);
    expect(res.newCustomers.count).toBe(0);
    expect(res.newCustomers.series).toHaveLength(12);
    expect(res.active.count).toBe(0);
    expect(res.atRisk.count).toBe(0);
    expect(res.repurchase).toEqual({
      totalCustomers: 0,
      customersWithRepeat: 0,
      rate: 0,
      avgIntervalDays: null,
    });
    expect(res.topCustomers).toEqual([]);
  });

  describe('agregação completa sobre 3 clientes', () => {
    beforeEach(() => {
      prisma.salesOrder.findMany.mockResolvedValue([
        // Alpha: 2 OVs faturadas no período + 1 OV faturada SEM data (só lifetime)
        order('c-alpha', 'Alpha', '2026-06-15', [[1, 15000]]),
        order('c-alpha', 'Alpha', '2026-06-20', [[1, 5000]]),
        order('c-alpha', 'Alpha', null, [[1, 1000]]),
        // Beta: ativo (compra dentro da janela de 365d) mas fora do período
        order('c-beta', 'Beta', '2025-08-01', [[1, 8000]]),
        // Gamma: comprou só na janela ANTERIOR → em risco
        order('c-gamma', 'Gamma', '2025-01-01', [[1, 3000]]),
      ]);
    });

    it('filtra por companyId, status INVOICED e customerId não nulo (tenancy)', async () => {
      await service.portfolio(range, 365);
      expect(prisma.salesOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: COMPANY,
            status: 'INVOICED',
            customerId: { not: null },
          }),
        }),
      );
    });

    it('novos clientes: só quem teve a PRIMEIRA compra no período + série 12m', async () => {
      const { newCustomers } = await service.portfolio(range, 365);
      expect(newCustomers.count).toBe(1); // só Alpha (1ª compra 2026-06-15)
      const byMonth = Object.fromEntries(newCustomers.series.map((s) => [s.month, s.count]));
      expect(newCustomers.series[0].month).toBe('2025-08'); // now(2026-07) - 11 meses
      expect(newCustomers.series.at(-1)!.month).toBe('2026-07');
      expect(byMonth['2026-06']).toBe(1); // Alpha
      expect(byMonth['2025-08']).toBe(1); // Beta
      expect(byMonth['2025-01']).toBeUndefined(); // Gamma fora da janela de 12m
    });

    it('ativos: ≥1 compra na janela de 365d (Alpha, Beta); Gamma fora', async () => {
      const { active } = await service.portfolio(range, 365);
      expect(active.count).toBe(2);
    });

    it('em risco: ativo na janela anterior e sem compra na atual (Gamma), com lifetime', async () => {
      const { atRisk } = await service.portfolio(range, 365);
      expect(atRisk.count).toBe(1);
      expect(atRisk.customers[0]).toMatchObject({
        customerId: 'c-gamma',
        name: 'Gamma',
        lifetimeRevenue: 3000,
      });
      expect(atRisk.customers[0].lastPurchaseAt).toEqual(new Date('2025-01-01'));
    });

    it('recompra: %  com ≥2 compras + intervalo médio (só datas reais)', async () => {
      const { repurchase } = await service.portfolio(range, 365);
      expect(repurchase.totalCustomers).toBe(3);
      expect(repurchase.customersWithRepeat).toBe(1); // Alpha (3 OVs)
      expect(repurchase.rate).toBe(33.3);
      expect(repurchase.avgIntervalDays).toBe(5); // Alpha: 2026-06-20 − 2026-06-15
    });

    it('top clientes: OV sem data entra no lifetime mas não no periodRevenue; ordena por período', async () => {
      const { topCustomers } = await service.portfolio(range, 365);
      expect(topCustomers.map((c) => c.customerId)).toEqual(['c-alpha', 'c-beta', 'c-gamma']);
      const alpha = topCustomers[0];
      expect(alpha.periodRevenue).toBe(20000); // 15000 + 5000 (a OV null fica de fora)
      expect(alpha.lifetimeRevenue).toBe(21000); // + 1000 da OV sem data
      expect(alpha.purchaseCount).toBe(3);
      expect(alpha.avgTicket).toBe(7000); // 21000 / 3
      expect(alpha.lastPurchaseAt).toEqual(new Date('2026-06-20'));
      // desempate por lifetime quando período empata em 0
      expect(topCustomers[1].periodRevenue).toBe(0);
      expect(topCustomers[1].customerId).toBe('c-beta'); // 8000 > 3000
    });

    it('activeWindowDays parametriza a janela (30d exclui Beta/Gamma)', async () => {
      const { active, atRisk } = await service.portfolio(range, 30);
      // janela atual = [2026-06-01, 2026-07-01]: só Alpha compra aí
      expect(active.count).toBe(1);
      // janela anterior = [2026-05-02, 2026-06-01): ninguém → sem risco
      expect(atRisk.count).toBe(0);
    });
  });
});
