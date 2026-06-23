import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ProductionFilters {
  periodFrom?: string;
  periodTo?: string;
  productId?: string;
  workCenterId?: string;
}

@Injectable()
export class ProductionCubeService {
  constructor(private readonly prisma: PrismaService) {}

  async query(companyId: string, filters: ProductionFilters = {}) {
    const where = this.buildWhere(companyId, filters);
    const rows = await this.prisma.factProductionDaily.findMany({ where });

    const totals = rows.reduce(
      (acc, r) => ({
        quantity: acc.quantity + Number(r.quantity),
        materialCost: acc.materialCost + Number(r.materialCost),
        laborCost: acc.laborCost + Number(r.laborCost),
        totalCost: acc.totalCost + Number(r.totalCost),
        orderCount: acc.orderCount + r.orderCount,
      }),
      { quantity: 0, materialCost: 0, laborCost: 0, totalCost: 0, orderCount: 0 },
    );

    return { ...totals, rows };
  }

  /** Material vs labor cost breakdown per product */
  async costAnalysis(companyId: string, filters: ProductionFilters = {}) {
    const where = this.buildWhere(companyId, filters);
    const rows = await this.prisma.factProductionDaily.findMany({ where });

    const byProduct = new Map<
      string,
      { productId: string; materialCost: number; laborCost: number; totalCost: number; quantity: number }
    >();

    for (const row of rows) {
      const existing = byProduct.get(row.productId);
      if (existing) {
        existing.materialCost += Number(row.materialCost);
        existing.laborCost += Number(row.laborCost);
        existing.totalCost += Number(row.totalCost);
        existing.quantity += Number(row.quantity);
      } else {
        byProduct.set(row.productId, {
          productId: row.productId,
          materialCost: Number(row.materialCost),
          laborCost: Number(row.laborCost),
          totalCost: Number(row.totalCost),
          quantity: Number(row.quantity),
        });
      }
    }

    return Array.from(byProduct.values()).map((p) => ({
      ...p,
      materialPct: p.totalCost > 0 ? (p.materialCost / p.totalCost) * 100 : 0,
      laborPct: p.totalCost > 0 ? (p.laborCost / p.totalCost) * 100 : 0,
      unitCost: p.quantity > 0 ? p.totalCost / p.quantity : 0,
    }));
  }

  async drillDown(
    companyId: string,
    dimension: 'product' | 'workCenter',
    dimensionId: string,
    filters: ProductionFilters = {},
  ) {
    const where = this.buildWhere(companyId, filters);

    switch (dimension) {
      case 'product':
        return this.prisma.factProductionDaily.findMany({ where: { ...where, productId: dimensionId } });
      case 'workCenter':
        return this.prisma.factProductionDaily.findMany({ where: { ...where, workCenterId: dimensionId } });
    }
  }

  private buildWhere(companyId: string, filters: ProductionFilters) {
    const where: Record<string, unknown> = { companyId };
    if (filters.periodFrom || filters.periodTo) {
      where.period = {
        ...(filters.periodFrom ? { gte: filters.periodFrom } : {}),
        ...(filters.periodTo ? { lte: filters.periodTo } : {}),
      };
    }
    if (filters.productId) where.productId = filters.productId;
    if (filters.workCenterId) where.workCenterId = filters.workCenterId;
    return where;
  }
}
