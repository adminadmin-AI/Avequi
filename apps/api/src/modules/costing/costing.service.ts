import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface CifRate {
  ratePerHour: number;
  monthlyCif: number;
  monthlyProductiveHours: number;
  centers: number;
}

export interface ProductAbsorptionCost {
  productId: string;
  sku: string;
  name: string;
  material: {
    total: number;
    breakdown: Array<{ componentId: string; sku: string; name: string; quantity: number; unitCost: number; subtotal: number }>;
  };
  labor: {
    total: number;
    hours: number;
    breakdown: Array<{ step: string; workCenter: string | null; hours: number; costPerHour: number; cost: number }>;
  };
  cif: {
    ratePerHour: number;
    hours: number;
    total: number;
  };
  totalWithoutCif: number; // material + MOD (custeio variável/direto)
  totalWithCif: number; // + CIF rateado (custeio por absorção)
  cifImpactPct: number | null; // quanto o CIF acresce sobre o custo sem CIF
}

/**
 * #396 Custeio por absorção simplificado.
 *
 * Taxa CIF/hora = Σ(monthlyCif) ÷ Σ(monthlyProductiveHours) dos centros de
 * custo ativos. Custo do produto = material (BOM ativa) + MOD (horas de
 * Routing × custo/hora do WorkCenter) + CIF (horas de Routing × taxa CIF/hora).
 */
@Injectable()
export class CostingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Taxa CIF/hora rateada a partir dos centros de custo ativos. */
  async getCifRate(companyId: string): Promise<CifRate> {
    const centers = await this.prisma.costCenter.findMany({
      where: { companyId, isActive: true },
      select: { monthlyCif: true, monthlyProductiveHours: true },
    });

    let cif = 0;
    let hours = 0;
    for (const c of centers) {
      cif += Number(c.monthlyCif);
      hours += Number(c.monthlyProductiveHours);
    }

    const ratePerHour = hours > 0 ? round2(cif / hours) : 0;
    return {
      ratePerHour,
      monthlyCif: round2(cif),
      monthlyProductiveHours: round2(hours),
      centers: centers.length,
    };
  }

  async computeProductCost(companyId: string, productId: string): Promise<ProductAbsorptionCost> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId },
      select: { id: true, sku: true, name: true },
    });
    if (!product) throw new NotFoundException(`Produto ${productId} não encontrado`);

    const material = await this.explodeMaterial(companyId, productId);
    const labor = await this.computeLabor(companyId, productId);

    const cifRate = await this.getCifRate(companyId);
    const cifTotal = round2(labor.hours * cifRate.ratePerHour);

    const totalWithoutCif = round2(material.total + labor.total);
    const totalWithCif = round2(totalWithoutCif + cifTotal);
    const cifImpactPct = totalWithoutCif > 0 ? round2((cifTotal / totalWithoutCif) * 100) : null;

    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      material,
      labor,
      cif: { ratePerHour: cifRate.ratePerHour, hours: labor.hours, total: cifTotal },
      totalWithoutCif,
      totalWithCif,
      cifImpactPct,
    };
  }

  /** Material = Σ itens da BOM ativa × custo do componente. */
  private async explodeMaterial(companyId: string, productId: string) {
    const bom = await this.prisma.bomVersion.findFirst({
      where: { productId, companyId, isActive: true },
      include: { items: { include: { component: true } } },
    });

    let total = 0;
    const breakdown = (bom?.items ?? []).map((item) => {
      const qty = Number(item.quantity) * (1 + Number(item.scrapPct) / 100);
      const unitCost = Number(item.component.avgCost ?? item.component.costPrice ?? 0);
      const subtotal = round2(qty * unitCost);
      total += subtotal;
      return {
        componentId: item.componentId,
        sku: item.component.sku,
        name: item.component.name,
        quantity: round2(qty),
        unitCost: round2(unitCost),
        subtotal,
      };
    });

    return { total: round2(total), breakdown };
  }

  /** MOD = Σ horas de Routing (setup+run) × custo/hora do WorkCenter. */
  private async computeLabor(companyId: string, productId: string) {
    const steps = await this.prisma.routingStep.findMany({
      where: { productId, companyId },
      orderBy: { stepOrder: 'asc' },
    });

    // Custo/hora dos WorkCenters usados no roteiro
    const codes = Array.from(
      new Set(steps.map((s) => s.workCenter).filter((c): c is string => !!c)),
    );
    const workCenters = codes.length
      ? await this.prisma.workCenter.findMany({
          where: { companyId, code: { in: codes } },
          select: { code: true, costPerHour: true },
        })
      : [];
    const cphByCode = new Map(workCenters.map((wc) => [wc.code, Number(wc.costPerHour)]));

    let total = 0;
    let hours = 0;
    const breakdown = steps.map((step) => {
      const stepHours = (step.setupTimeMin + step.runTimeMin) / 60;
      const costPerHour = step.workCenter ? cphByCode.get(step.workCenter) ?? 0 : 0;
      const cost = round2(stepHours * costPerHour);
      total += cost;
      hours += stepHours;
      return {
        step: step.name,
        workCenter: step.workCenter,
        hours: round2(stepHours),
        costPerHour,
        cost,
      };
    });

    return { total: round2(total), hours: round2(hours), breakdown };
  }
}
