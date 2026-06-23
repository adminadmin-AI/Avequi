import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface SalesFilters {
  periodFrom?: string;
  periodTo?: string;
  productId?: string;
  customerId?: string;
  region?: string;
  state?: string;
  city?: string;
}

@Injectable()
export class SalesCubeService {
  constructor(private readonly prisma: PrismaService) {}

  async query(companyId: string, filters: SalesFilters = {}) {
    const where = this.buildWhere(companyId, filters);

    const rows = await this.prisma.factSalesDaily.findMany({ where });

    const totals = rows.reduce(
      (acc, r) => ({
        revenue: acc.revenue + Number(r.revenue),
        quantity: acc.quantity + Number(r.quantity),
        orderCount: acc.orderCount + r.orderCount,
      }),
      { revenue: 0, quantity: 0, orderCount: 0 },
    );

    const avgTicket = totals.orderCount > 0 ? totals.revenue / totals.orderCount : 0;
    return { ...totals, avgTicket, rows };
  }

  async drillDown(
    companyId: string,
    dimension: 'product' | 'customer' | 'region' | 'state',
    dimensionId: string,
    filters: SalesFilters = {},
  ) {
    const base = this.buildWhere(companyId, filters);

    switch (dimension) {
      case 'product': {
        const rows = await this.prisma.factSalesDaily.findMany({
          where: { ...base, productId: dimensionId },
        });
        return this.groupBy(rows, 'customerId');
      }
      case 'customer': {
        const rows = await this.prisma.factSalesDaily.findMany({
          where: { ...base, customerId: dimensionId },
        });
        return this.groupBy(rows, 'productId');
      }
      case 'region': {
        const rows = await this.prisma.factSalesDaily.findMany({
          where: { ...base, region: dimensionId },
        });
        return this.groupBy(rows, 'state');
      }
      case 'state': {
        const rows = await this.prisma.factSalesDaily.findMany({
          where: { ...base, state: dimensionId },
        });
        return this.groupBy(rows, 'city');
      }
    }
  }

  async topN(companyId: string, dimension: 'product' | 'customer' | 'region', n: number, filters: SalesFilters = {}) {
    const where = this.buildWhere(companyId, filters);
    const rows = await this.prisma.factSalesDaily.findMany({ where });

    const field = dimension === 'product' ? 'productId' : dimension === 'customer' ? 'customerId' : 'region';
    const grouped = this.groupBy(rows, field as keyof typeof rows[0]);

    return grouped.sort((a, b) => b.revenue - a.revenue).slice(0, n);
  }

  private buildWhere(companyId: string, filters: SalesFilters) {
    const where: Record<string, unknown> = { companyId };
    if (filters.periodFrom || filters.periodTo) {
      where.period = {
        ...(filters.periodFrom ? { gte: filters.periodFrom } : {}),
        ...(filters.periodTo ? { lte: filters.periodTo } : {}),
      };
    }
    if (filters.productId) where.productId = filters.productId;
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.region) where.region = filters.region;
    if (filters.state) where.state = filters.state;
    if (filters.city) where.city = filters.city;
    return where;
  }

  private groupBy<T extends Record<string, unknown>>(rows: T[], field: keyof T) {
    const map = new Map<string, { key: string; revenue: number; quantity: number; orderCount: number }>();
    for (const row of rows) {
      const key = String(row[field] ?? '__null__');
      const existing = map.get(key);
      if (existing) {
        existing.revenue += Number(row.revenue);
        existing.quantity += Number(row.quantity);
        existing.orderCount += Number(row.orderCount);
      } else {
        map.set(key, {
          key,
          revenue: Number(row.revenue),
          quantity: Number(row.quantity),
          orderCount: Number(row.orderCount),
        });
      }
    }
    return Array.from(map.values());
  }
}
