import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface InventoryFilters {
  periodFrom?: string;
  periodTo?: string;
  warehouseId?: string;
  productId?: string;
  categoryId?: string;
}

@Injectable()
export class InventoryCubeService {
  constructor(private readonly prisma: PrismaService) {}

  async query(companyId: string, filters: InventoryFilters = {}) {
    const where = this.buildWhere(companyId, filters);
    const rows = await this.prisma.factInventoryDaily.findMany({ where });

    const totals = rows.reduce(
      (acc, r) => ({
        quantity: acc.quantity + Number(r.quantity),
        value: acc.value + Number(r.value),
      }),
      { quantity: 0, value: 0 },
    );

    return { ...totals, rows };
  }

  /**
   * Inventory aging analysis based on the earliest snapshot period in the
   * fact table. Buckets: 0-30, 31-60, 61-90, 90+ days from today.
   */
  async aging(companyId: string, warehouseId?: string, categoryId?: string) {
    const where: Record<string, unknown> = { companyId };
    if (warehouseId) where.warehouseId = warehouseId;
    if (categoryId) where.categoryId = categoryId;

    const rows = await this.prisma.factInventoryDaily.findMany({ where, orderBy: { period: 'asc' } });

    // Find earliest period per product+warehouse combo
    const earliest = new Map<string, string>();
    for (const row of rows) {
      const key = `${row.productId}::${row.warehouseId}`;
      if (!earliest.has(key)) earliest.set(key, row.period);
    }

    const today = new Date();
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    const bucketValues = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };

    // Use latest snapshot per product+warehouse for value
    const latest = new Map<string, (typeof rows)[0]>();
    for (const row of rows) {
      const key = `${row.productId}::${row.warehouseId}`;
      const prev = latest.get(key);
      if (!prev || row.period > prev.period) latest.set(key, row);
    }

    for (const [key, row] of latest.entries()) {
      const firstPeriod = earliest.get(key)!;
      const daysOld = Math.floor((today.getTime() - new Date(firstPeriod).getTime()) / 86400000);
      const value = Number(row.value);

      if (daysOld <= 30) {
        buckets['0-30'] += Number(row.quantity);
        bucketValues['0-30'] += value;
      } else if (daysOld <= 60) {
        buckets['31-60'] += Number(row.quantity);
        bucketValues['31-60'] += value;
      } else if (daysOld <= 90) {
        buckets['61-90'] += Number(row.quantity);
        bucketValues['61-90'] += value;
      } else {
        buckets['90+'] += Number(row.quantity);
        bucketValues['90+'] += value;
      }
    }

    return { quantity: buckets, value: bucketValues };
  }

  async drillDown(
    companyId: string,
    dimension: 'warehouse' | 'product' | 'category',
    dimensionId: string,
    filters: InventoryFilters = {},
  ) {
    const where = this.buildWhere(companyId, filters);

    switch (dimension) {
      case 'warehouse':
        return this.prisma.factInventoryDaily.findMany({ where: { ...where, warehouseId: dimensionId } });
      case 'product':
        return this.prisma.factInventoryDaily.findMany({ where: { ...where, productId: dimensionId } });
      case 'category':
        return this.prisma.factInventoryDaily.findMany({ where: { ...where, categoryId: dimensionId } });
    }
  }

  private buildWhere(companyId: string, filters: InventoryFilters) {
    const where: Record<string, unknown> = { companyId };
    if (filters.periodFrom || filters.periodTo) {
      where.period = {
        ...(filters.periodFrom ? { gte: filters.periodFrom } : {}),
        ...(filters.periodTo ? { lte: filters.periodTo } : {}),
      };
    }
    if (filters.warehouseId) where.warehouseId = filters.warehouseId;
    if (filters.productId) where.productId = filters.productId;
    if (filters.categoryId) where.categoryId = filters.categoryId;
    return where;
  }
}
