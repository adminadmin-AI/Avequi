import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBudgetPlanDto } from './dto/create-budget-plan.dto';
import { UpdateBudgetPlanDto } from './dto/update-budget-plan.dto';
import { UpsertDriverDto } from './dto/upsert-driver.dto';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface DriverInput {
  id?: string;
  productId?: string | null;
  label: string;
  volume: number;
  avgPrice: number;
  unitCost: number;
}

export interface BudgetProjection {
  planId: string;
  year: number;
  name: string;
  drivers: Array<{
    id?: string;
    label: string;
    productId: string | null;
    volume: number;
    avgPrice: number;
    unitCost: number;
    revenue: number;
    cpv: number;
    grossProfit: number;
    mixPct: number; // participação na receita total
  }>;
  revenue: number;
  cpv: number;
  grossProfit: number;
  variableExpenses: number;
  fixedExpenses: number;
  operatingResult: number; // lucro operacional (antes do CAPEX)
  capex: number;
  resultAfterCapex: number;
  assumptions: { variableExpensePct: number; fixedExpenseMonthly: number; capex: number };
}

@Injectable()
export class BudgetPlanService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── CRUD do plano ─────────────────────────────────────────────────────────

  createPlan(companyId: string, dto: CreateBudgetPlanDto) {
    return this.prisma.budgetPlan.create({
      data: {
        companyId,
        year: dto.year,
        name: dto.name,
        variableExpensePct: dto.variableExpensePct ?? 0,
        fixedExpenseMonthly: dto.fixedExpenseMonthly ?? 0,
        capex: dto.capex ?? 0,
      },
    });
  }

  listPlans(companyId: string) {
    return this.prisma.budgetPlan.findMany({
      where: { companyId },
      orderBy: [{ year: 'desc' }, { name: 'asc' }],
    });
  }

  async updatePlan(companyId: string, id: string, dto: UpdateBudgetPlanDto) {
    await this.getPlanOrThrow(companyId, id);
    return this.prisma.budgetPlan.update({ where: { id }, data: dto });
  }

  async deletePlan(companyId: string, id: string) {
    await this.getPlanOrThrow(companyId, id);
    return this.prisma.budgetPlan.delete({ where: { id } });
  }

  // ─── Drivers ───────────────────────────────────────────────────────────────

  async upsertDriver(companyId: string, planId: string, dto: UpsertDriverDto) {
    await this.getPlanOrThrow(companyId, planId);
    if (dto.id) {
      const existing = await this.prisma.budgetDriver.findFirst({
        where: { id: dto.id, companyId, budgetPlanId: planId },
      });
      if (!existing) throw new NotFoundException(`Driver ${dto.id} não encontrado`);
      return this.prisma.budgetDriver.update({
        where: { id: dto.id },
        data: {
          productId: dto.productId ?? null,
          label: dto.label,
          volume: dto.volume,
          avgPrice: dto.avgPrice,
          unitCost: dto.unitCost,
        },
      });
    }
    return this.prisma.budgetDriver.create({
      data: {
        companyId,
        budgetPlanId: planId,
        productId: dto.productId ?? null,
        label: dto.label,
        volume: dto.volume,
        avgPrice: dto.avgPrice,
        unitCost: dto.unitCost,
      },
    });
  }

  async removeDriver(companyId: string, planId: string, driverId: string) {
    const driver = await this.prisma.budgetDriver.findFirst({
      where: { id: driverId, companyId, budgetPlanId: planId },
    });
    if (!driver) throw new NotFoundException(`Driver ${driverId} não encontrado`);
    return this.prisma.budgetDriver.delete({ where: { id: driverId } });
  }

  // ─── Projeção (recálculo derivado dos drivers) ───────────────────────────────

  async project(companyId: string, planId: string): Promise<BudgetProjection> {
    const plan = await this.getPlanOrThrow(companyId, planId);
    const drivers = await this.prisma.budgetDriver.findMany({
      where: { budgetPlanId: planId, companyId },
      orderBy: { label: 'asc' },
    });

    return this.computeProjection(
      { id: plan.id, year: plan.year, name: plan.name },
      {
        variableExpensePct: Number(plan.variableExpensePct),
        fixedExpenseMonthly: Number(plan.fixedExpenseMonthly),
        capex: Number(plan.capex),
      },
      drivers.map((d) => ({
        id: d.id,
        productId: d.productId,
        label: d.label,
        volume: Number(d.volume),
        avgPrice: Number(d.avgPrice),
        unitCost: Number(d.unitCost),
      })),
    );
  }

  /** Núcleo do cálculo — puro, reutilizado pela projeção e pela sensibilidade. */
  private computeProjection(
    meta: { id: string; year: number; name: string },
    assumptions: { variableExpensePct: number; fixedExpenseMonthly: number; capex: number },
    drivers: DriverInput[],
  ): BudgetProjection {
    const rows = drivers.map((d) => {
      const revenue = d.volume * d.avgPrice;
      const cpv = d.volume * d.unitCost;
      return { ...d, revenue, cpv, grossProfit: revenue - cpv };
    });

    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const cpv = rows.reduce((s, r) => s + r.cpv, 0);
    const grossProfit = revenue - cpv;
    const variableExpenses = revenue * (assumptions.variableExpensePct / 100);
    const fixedExpenses = assumptions.fixedExpenseMonthly * 12;
    const operatingResult = grossProfit - variableExpenses - fixedExpenses;
    const resultAfterCapex = operatingResult - assumptions.capex;

    return {
      planId: meta.id,
      year: meta.year,
      name: meta.name,
      drivers: rows.map((r) => ({
        id: r.id,
        label: r.label,
        productId: r.productId ?? null,
        volume: round2(r.volume),
        avgPrice: round2(r.avgPrice),
        unitCost: round2(r.unitCost),
        revenue: round2(r.revenue),
        cpv: round2(r.cpv),
        grossProfit: round2(r.grossProfit),
        mixPct: revenue > 0 ? round2((r.revenue / revenue) * 100) : 0,
      })),
      revenue: round2(revenue),
      cpv: round2(cpv),
      grossProfit: round2(grossProfit),
      variableExpenses: round2(variableExpenses),
      fixedExpenses: round2(fixedExpenses),
      operatingResult: round2(operatingResult),
      capex: round2(assumptions.capex),
      resultAfterCapex: round2(resultAfterCapex),
      assumptions,
    };
  }

  // ─── Sensibilidade (±10% volume, ±5% preço) ──────────────────────────────────

  async sensitivity(companyId: string, planId: string) {
    const base = await this.project(companyId, planId);
    const plan = await this.getPlanOrThrow(companyId, planId);
    const drivers = await this.prisma.budgetDriver.findMany({
      where: { budgetPlanId: planId, companyId },
    });
    const assumptions = {
      variableExpensePct: Number(plan.variableExpensePct),
      fixedExpenseMonthly: Number(plan.fixedExpenseMonthly),
      capex: Number(plan.capex),
    };
    const meta = { id: plan.id, year: plan.year, name: plan.name };
    const raw = drivers.map((d) => ({
      id: d.id,
      productId: d.productId,
      label: d.label,
      volume: Number(d.volume),
      avgPrice: Number(d.avgPrice),
      unitCost: Number(d.unitCost),
    }));

    const scenarios = [
      { key: 'volume_+10%', volumeFactor: 1.1, priceFactor: 1 },
      { key: 'volume_-10%', volumeFactor: 0.9, priceFactor: 1 },
      { key: 'preco_+5%', volumeFactor: 1, priceFactor: 1.05 },
      { key: 'preco_-5%', volumeFactor: 1, priceFactor: 0.95 },
    ].map((sc) => {
      const scenarioDrivers = raw.map((d) => ({
        ...d,
        volume: d.volume * sc.volumeFactor,
        avgPrice: d.avgPrice * sc.priceFactor,
      }));
      const proj = this.computeProjection(meta, assumptions, scenarioDrivers);
      return {
        scenario: sc.key,
        revenue: proj.revenue,
        operatingResult: proj.operatingResult,
        revenueDelta: round2(proj.revenue - base.revenue),
        operatingResultDelta: round2(proj.operatingResult - base.operatingResult),
      };
    });

    return {
      base: { revenue: base.revenue, operatingResult: base.operatingResult },
      scenarios,
    };
  }

  // ─── Orçado vs realizado (por driver quando há produto) ──────────────────────

  async vsRealized(companyId: string, planId: string) {
    const projection = await this.project(companyId, planId);

    const from = new Date(Date.UTC(projection.year, 0, 1));
    const to = new Date(Date.UTC(projection.year + 1, 0, 1));

    // Realizado por produto: itens de vendas faturadas no ano
    const items = await this.prisma.saleItem.findMany({
      where: {
        salesOrder: { companyId, status: 'INVOICED' as any, invoicedAt: { gte: from, lt: to } },
      },
      select: { productId: true, quantity: true, unitPrice: true },
    });

    const realizedByProduct = new Map<string, { revenue: number; volume: number }>();
    let realizedTotalRevenue = 0;
    for (const it of items) {
      const rev = Number(it.quantity) * Number(it.unitPrice);
      const vol = Number(it.quantity);
      const cur = realizedByProduct.get(it.productId) ?? { revenue: 0, volume: 0 };
      cur.revenue += rev;
      cur.volume += vol;
      realizedByProduct.set(it.productId, cur);
      realizedTotalRevenue += rev;
    }

    const drivers = projection.drivers.map((d) => {
      const realized = d.productId ? realizedByProduct.get(d.productId) : undefined;
      const realizedRevenue = realized ? round2(realized.revenue) : null;
      const realizedVolume = realized ? round2(realized.volume) : null;
      return {
        label: d.label,
        productId: d.productId,
        budgetedRevenue: d.revenue,
        realizedRevenue,
        revenueVariance: realizedRevenue != null ? round2(realizedRevenue - d.revenue) : null,
        budgetedVolume: d.volume,
        realizedVolume,
        volumeVariance: realizedVolume != null ? round2(realizedVolume - d.volume) : null,
      };
    });

    return {
      year: projection.year,
      budgetedRevenue: projection.revenue,
      realizedRevenue: round2(realizedTotalRevenue),
      revenueVariance: round2(realizedTotalRevenue - projection.revenue),
      drivers,
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async getPlanOrThrow(companyId: string, id: string) {
    const plan = await this.prisma.budgetPlan.findFirst({ where: { id, companyId } });
    if (!plan) throw new NotFoundException(`Plano de orçamento ${id} não encontrado`);
    return plan;
  }
}
