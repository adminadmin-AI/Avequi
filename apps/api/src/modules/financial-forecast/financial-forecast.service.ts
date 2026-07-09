import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const ym = (absMonth: number) => {
  const y = Math.floor(absMonth / 12);
  const m = absMonth % 12;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
};

/** Regressão linear simples (mínimos quadrados) sobre y indexado por x=0..n-1. */
function linreg(y: number[]): { slope: number; intercept: number } {
  const n = y.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: y[0] };
  const xbar = (n - 1) / 2;
  const ybar = y.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xbar) * (y[i] - ybar);
    den += (i - xbar) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: ybar - slope * xbar };
}

export interface QuarterForecast {
  quarter: string; // ex: "2026-Q3"
  months: string[];
  revenue: number; // demanda × preço médio
  expenses: number; // tendência linear
  result: number;
  budgeted: number | null; // Budget (soma dos meses), null se não houver
  realized: {
    revenue: number;
    expenses: number;
    result: number;
    partial: boolean; // true se só parte do trimestre já decorreu
  } | null; // null se o trimestre é totalmente futuro
}

export interface FinancialForecast {
  quarters: QuarterForecast[];
  assumptions: {
    expenseTrend: { slope: number; intercept: number; monthsBase: number };
    priceSource: 'avg_realizado_12m | salePrice';
    generatedAt: string;
  };
}

@Injectable()
export class FinancialForecastService {
  constructor(private readonly prisma: PrismaService) {}

  async forecast(companyId: string, quarters = 4, refDate: Date = new Date()): Promise<FinancialForecast> {
    const q = Math.max(1, Math.min(12, Math.floor(quarters)));
    const refY = refDate.getUTCFullYear();
    const refM = refDate.getUTCMonth(); // 0-11
    const currentAbs = refY * 12 + refM;
    const qStartAbs = refY * 12 + Math.floor(refM / 3) * 3; // início do trimestre atual

    // Trimestres alvo (rolante a partir do trimestre corrente)
    const quarterDefs = Array.from({ length: q }, (_, i) => {
      const startAbs = qStartAbs + i * 3;
      const months = [startAbs, startAbs + 1, startAbs + 2].map(ym);
      const y = Math.floor(startAbs / 12);
      const qNum = Math.floor((startAbs % 12) / 3) + 1;
      return { quarter: `${y}-Q${qNum}`, startAbs, months };
    });
    const allMonths = quarterDefs.flatMap((d) => d.months);

    // ─── Receita projetada = demanda (unidades) × preço médio por produto ─────
    const demands = await this.prisma.demandForecast.findMany({
      where: { companyId, period: { in: allMonths } },
      select: { productId: true, period: true, quantity: true },
    });
    const priceMap = await this.buildPriceMap(
      companyId,
      Array.from(new Set(demands.map((d) => d.productId))),
      currentAbs,
    );
    const revenueByMonth = new Map<string, number>();
    for (const d of demands) {
      const rev = Number(d.quantity) * (priceMap.get(d.productId) ?? 0);
      revenueByMonth.set(d.period, (revenueByMonth.get(d.period) ?? 0) + rev);
    }

    // ─── Despesas projetadas = tendência linear dos últimos 12 meses ──────────
    const firstHistAbs = currentAbs - 12;
    const histFrom = new Date(Date.UTC(Math.floor(firstHistAbs / 12), firstHistAbs % 12, 1));
    const histTo = new Date(Date.UTC(refY, refM, 1)); // até o mês corrente (exclusivo)
    const payables = await this.prisma.financialEntry.findMany({
      where: { companyId, type: 'PAYABLE' as any, dueDate: { gte: histFrom, lt: histTo } },
      select: { amount: true, dueDate: true },
    });
    const hist = new Array(12).fill(0);
    for (const p of payables) {
      const abs = p.dueDate.getUTCFullYear() * 12 + p.dueDate.getUTCMonth();
      const idx = abs - firstHistAbs;
      if (idx >= 0 && idx < 12) hist[idx] += Number(p.amount);
    }
    const trend = linreg(hist);
    const expenseFor = (absMonth: number) =>
      Math.max(0, trend.intercept + trend.slope * (absMonth - firstHistAbs));

    // ─── Orçado (Budget mensal existente) ─────────────────────────────────────
    const targetYears = Array.from(new Set(quarterDefs.flatMap((d) => d.months.map((m) => Number(m.split('-')[0])))));
    const budgets = await this.prisma.budget.findMany({
      where: { companyId, year: { in: targetYears } },
      select: { year: true, month: true, amount: true },
    });
    const budgetByMonth = new Map<string, number>();
    for (const b of budgets) {
      const key = `${b.year}-${String(b.month).padStart(2, '0')}`;
      budgetByMonth.set(key, (budgetByMonth.get(key) ?? 0) + Number(b.amount));
    }

    // ─── Realizado (meses já decorridos) ──────────────────────────────────────
    const realizedRev = await this.realizedRevenueByMonth(companyId, allMonths, currentAbs);
    const realizedExp = await this.realizedExpenseByMonth(companyId, allMonths, currentAbs);

    const quartersOut: QuarterForecast[] = quarterDefs.map((def) => {
      const revenue = def.months.reduce((s, m) => s + (revenueByMonth.get(m) ?? 0), 0);
      const expenses = def.months.reduce((s, m, i) => s + expenseFor(def.startAbs + i), 0);
      const budgetMonths = def.months.filter((m) => budgetByMonth.has(m));
      const budgeted = budgetMonths.length
        ? def.months.reduce((s, m) => s + (budgetByMonth.get(m) ?? 0), 0)
        : null;

      const elapsed = def.months.filter((_, i) => def.startAbs + i < currentAbs);
      let realized: QuarterForecast['realized'] = null;
      if (elapsed.length > 0) {
        const rev = elapsed.reduce((s, m) => s + (realizedRev.get(m) ?? 0), 0);
        const exp = elapsed.reduce((s, m) => s + (realizedExp.get(m) ?? 0), 0);
        realized = {
          revenue: round2(rev),
          expenses: round2(exp),
          result: round2(rev - exp),
          partial: elapsed.length < def.months.length,
        };
      }

      return {
        quarter: def.quarter,
        months: def.months,
        revenue: round2(revenue),
        expenses: round2(expenses),
        result: round2(revenue - expenses),
        budgeted: budgeted != null ? round2(budgeted) : null,
        realized,
      };
    });

    return {
      quarters: quartersOut,
      assumptions: {
        expenseTrend: { slope: round2(trend.slope), intercept: round2(trend.intercept), monthsBase: 12 },
        priceSource: 'avg_realizado_12m | salePrice',
        generatedAt: refDate.toISOString(),
      },
    };
  }

  /** Preço médio por produto: média ponderada do realizado 12m, fallback salePrice. */
  private async buildPriceMap(companyId: string, productIds: string[], currentAbs: number): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (productIds.length === 0) return map;

    const from = new Date(Date.UTC(Math.floor((currentAbs - 12) / 12), (currentAbs - 12) % 12, 1));
    const items = await this.prisma.saleItem.findMany({
      where: {
        productId: { in: productIds },
        salesOrder: { companyId, status: 'INVOICED' as any, invoicedAt: { gte: from } },
      },
      select: { productId: true, quantity: true, unitPrice: true },
    });
    const agg = new Map<string, { rev: number; qty: number }>();
    for (const it of items) {
      const cur = agg.get(it.productId) ?? { rev: 0, qty: 0 };
      cur.rev += Number(it.quantity) * Number(it.unitPrice);
      cur.qty += Number(it.quantity);
      agg.set(it.productId, cur);
    }

    // Fallback: salePrice do cadastro
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId },
      select: { id: true, salePrice: true },
    });
    const salePriceMap = new Map(products.map((p) => [p.id, p.salePrice != null ? Number(p.salePrice) : 0]));

    for (const id of productIds) {
      const a = agg.get(id);
      map.set(id, a && a.qty > 0 ? a.rev / a.qty : salePriceMap.get(id) ?? 0);
    }
    return map;
  }

  private async realizedRevenueByMonth(companyId: string, months: string[], currentAbs: number): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const elapsed = months.filter((m) => this.absOf(m) < currentAbs);
    if (elapsed.length === 0) return out;
    const from = new Date(Date.UTC(...this.ymParts(elapsed[0])));
    const lastAbs = Math.max(...elapsed.map((m) => this.absOf(m)));
    const to = new Date(Date.UTC(Math.floor((lastAbs + 1) / 12), (lastAbs + 1) % 12, 1));

    const items = await this.prisma.saleItem.findMany({
      where: { salesOrder: { companyId, status: 'INVOICED' as any, invoicedAt: { gte: from, lt: to } } },
      select: { quantity: true, unitPrice: true, salesOrder: { select: { invoicedAt: true } } },
    });
    for (const it of items) {
      const d = it.salesOrder?.invoicedAt;
      if (!d) continue;
      const key = ym(d.getUTCFullYear() * 12 + d.getUTCMonth());
      out.set(key, (out.get(key) ?? 0) + Number(it.quantity) * Number(it.unitPrice));
    }
    return out;
  }

  private async realizedExpenseByMonth(companyId: string, months: string[], currentAbs: number): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const elapsed = months.filter((m) => this.absOf(m) < currentAbs);
    if (elapsed.length === 0) return out;
    const from = new Date(Date.UTC(...this.ymParts(elapsed[0])));
    const lastAbs = Math.max(...elapsed.map((m) => this.absOf(m)));
    const to = new Date(Date.UTC(Math.floor((lastAbs + 1) / 12), (lastAbs + 1) % 12, 1));

    const paid = await this.prisma.financialEntry.findMany({
      where: { companyId, type: 'PAYABLE' as any, paidAt: { gte: from, lt: to } },
      select: { paidAt: true, paidAmount: true, amount: true },
    });
    for (const p of paid) {
      if (!p.paidAt) continue;
      const key = ym(p.paidAt.getUTCFullYear() * 12 + p.paidAt.getUTCMonth());
      const val = p.paidAmount != null ? Number(p.paidAmount) : Number(p.amount);
      out.set(key, (out.get(key) ?? 0) + val);
    }
    return out;
  }

  private absOf(m: string): number {
    const [y, mo] = m.split('-').map(Number);
    return y * 12 + (mo - 1);
  }

  private ymParts(m: string): [number, number, number] {
    const [y, mo] = m.split('-').map(Number);
    return [y, mo - 1, 1];
  }
}
