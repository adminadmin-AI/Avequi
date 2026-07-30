import { Injectable } from '@nestjs/common';
import { SalesOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardRange } from './crm-dashboard.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Chave YYYY-MM em UTC (bucketing de mês estável em qualquer fuso do CI). */
function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const money = (v: number) => Math.round(v * 100) / 100;

/** Agregado interno por cliente (montado em JS sobre as OVs faturadas). */
interface CustomerAgg {
  customerId: string;
  name: string;
  /** Receita de TODAS as OVs INVOICED do cliente (inclui as sem invoicedAt). */
  lifetimeRevenue: number;
  /** Nº de OVs INVOICED (inclui as sem invoicedAt) — base da taxa de recompra. */
  purchaseCount: number;
  /** Datas de faturamento (só OVs com invoicedAt) — base de janelas/série/intervalo. */
  invoicedDates: Date[];
  /** Receita atribuída a OVs faturadas DENTRO do período [from, to]. */
  periodRevenue: number;
  firstPurchaseAt: Date | null;
  lastPurchaseAt: Date | null;
}

/**
 * KPIs de CARTEIRA DE CLIENTES (#846) — métricas SaaS (novos/ativos/churn/
 * recompra/LTV) traduzidas ao B2B industrial. "Cliente" = Customer; "compra" =
 * OV com status INVOICED; receita = Σ(quantity×unitPrice) dos itens (padrão do
 * bySource — SalesOrder não tem totalAmount). "Primeira compra" = menor
 * invoicedAt. OV INVOICED sem invoicedAt entra na receita lifetime mas fica
 * fora de tudo que é datado (série, janelas, intervalo). Tenancy sempre por
 * companyId do range (que vem do JWT no controller).
 */
@Injectable()
export class PortfolioService {
  constructor(private readonly prisma: PrismaService) {}

  async portfolio(range: DashboardRange, activeWindowDays: number) {
    const now = range.to;
    const activeFrom = new Date(now.getTime() - activeWindowDays * DAY_MS);
    const prevActiveFrom = new Date(now.getTime() - 2 * activeWindowDays * DAY_MS);

    const customers = await this.aggregateCustomers(range);

    return {
      range: { from: range.from, to: range.to },
      activeWindowDays,
      newCustomers: this.newCustomers(customers, range, now),
      active: this.active(customers, activeFrom, now),
      atRisk: this.atRisk(customers, activeFrom, prevActiveFrom, now),
      repurchase: this.repurchase(customers),
      topCustomers: this.topCustomers(customers),
    };
  }

  /** Uma varredura das OVs INVOICED da empresa → agregado por cliente. */
  private async aggregateCustomers(range: DashboardRange): Promise<CustomerAgg[]> {
    const orders = await this.prisma.salesOrder.findMany({
      where: {
        companyId: range.companyId,
        status: SalesOrderStatus.INVOICED,
        customerId: { not: null },
      },
      select: {
        customerId: true,
        invoicedAt: true,
        customer: { select: { name: true } },
        items: { select: { quantity: true, unitPrice: true } },
      },
    });

    const map = new Map<string, CustomerAgg>();
    for (const o of orders) {
      const id = o.customerId!;
      const entry =
        map.get(id) ??
        ({
          customerId: id,
          name: o.customer?.name ?? id,
          lifetimeRevenue: 0,
          purchaseCount: 0,
          invoicedDates: [],
          periodRevenue: 0,
          firstPurchaseAt: null,
          lastPurchaseAt: null,
        } as CustomerAgg);

      const revenue = o.items.reduce(
        (sum, it) => sum + Number(it.quantity) * Number(it.unitPrice),
        0,
      );
      entry.lifetimeRevenue += revenue;
      entry.purchaseCount += 1;

      if (o.invoicedAt) {
        entry.invoicedDates.push(o.invoicedAt);
        if (!entry.firstPurchaseAt || o.invoicedAt < entry.firstPurchaseAt)
          entry.firstPurchaseAt = o.invoicedAt;
        if (!entry.lastPurchaseAt || o.invoicedAt > entry.lastPurchaseAt)
          entry.lastPurchaseAt = o.invoicedAt;
        if (o.invoicedAt >= range.from && o.invoicedAt <= range.to)
          entry.periodRevenue += revenue;
      }
      map.set(id, entry);
    }
    return [...map.values()];
  }

  /** Clientes cuja PRIMEIRA compra caiu no período + série mensal (12 meses). */
  private newCustomers(customers: CustomerAgg[], range: DashboardRange, now: Date) {
    const count = customers.filter(
      (c) => c.firstPurchaseAt && c.firstPurchaseAt >= range.from && c.firstPurchaseAt <= range.to,
    ).length;

    // 12 baldes cronológicos terminando no mês de `now` (UTC).
    const buckets = new Map<string, number>();
    const keys: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = monthKey(d);
      keys.push(key);
      buckets.set(key, 0);
    }
    for (const c of customers) {
      if (!c.firstPurchaseAt) continue;
      const key = monthKey(c.firstPurchaseAt);
      if (buckets.has(key)) buckets.set(key, buckets.get(key)! + 1);
    }

    return { count, series: keys.map((month) => ({ month, count: buckets.get(month)! })) };
  }

  /** ≥1 compra faturada na janela ativa (default 365d). */
  private active(customers: CustomerAgg[], activeFrom: Date, now: Date) {
    const count = customers.filter((c) =>
      c.invoicedDates.some((d) => d >= activeFrom && d <= now),
    ).length;
    return { count };
  }

  /** Ativo na janela ANTERIOR e sem compra na janela atual (churn proxy). */
  private atRisk(customers: CustomerAgg[], activeFrom: Date, prevActiveFrom: Date, now: Date) {
    const atRisk = customers.filter((c) => {
      const inCurrent = c.invoicedDates.some((d) => d >= activeFrom && d <= now);
      const inPrevious = c.invoicedDates.some((d) => d >= prevActiveFrom && d < activeFrom);
      return inPrevious && !inCurrent;
    });
    const list = atRisk
      .map((c) => ({
        customerId: c.customerId,
        name: c.name,
        lastPurchaseAt: c.lastPurchaseAt,
        lifetimeRevenue: money(c.lifetimeRevenue),
      }))
      .sort((a, b) => b.lifetimeRevenue - a.lifetimeRevenue);
    return { count: list.length, customers: list };
  }

  /** % de clientes com ≥2 compras + intervalo médio entre compras (dias). */
  private repurchase(customers: CustomerAgg[]) {
    const total = customers.length;
    const withRepeat = customers.filter((c) => c.purchaseCount >= 2).length;

    // Intervalo médio: média de TODOS os gaps consecutivos (só datas reais).
    let gapSum = 0;
    let gapCount = 0;
    for (const c of customers) {
      if (c.invoicedDates.length < 2) continue;
      const sorted = [...c.invoicedDates].sort((a, b) => a.getTime() - b.getTime());
      for (let i = 1; i < sorted.length; i++) {
        gapSum += (sorted[i].getTime() - sorted[i - 1].getTime()) / DAY_MS;
        gapCount += 1;
      }
    }

    return {
      totalCustomers: total,
      customersWithRepeat: withRepeat,
      rate: total > 0 ? Math.round((withRepeat / total) * 1000) / 10 : 0,
      avgIntervalDays: gapCount > 0 ? Math.round(gapSum / gapCount) : null,
    };
  }

  /** Top 10 por receita no período (desempate: lifetime). */
  private topCustomers(customers: CustomerAgg[]) {
    return customers
      .map((c) => ({
        customerId: c.customerId,
        name: c.name,
        periodRevenue: money(c.periodRevenue),
        lifetimeRevenue: money(c.lifetimeRevenue),
        purchaseCount: c.purchaseCount,
        avgTicket: c.purchaseCount > 0 ? money(c.lifetimeRevenue / c.purchaseCount) : 0,
        lastPurchaseAt: c.lastPurchaseAt,
      }))
      .sort((a, b) => b.periodRevenue - a.periodRevenue || b.lifetimeRevenue - a.lifetimeRevenue)
      .slice(0, 10);
  }
}
