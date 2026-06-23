import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface FinancialFilters {
  periodFrom?: string;
  periodTo?: string;
  bankAccountId?: string;
  categoryId?: string;
  type?: string;
}

@Injectable()
export class FinancialCubeService {
  constructor(private readonly prisma: PrismaService) {}

  async query(companyId: string, filters: FinancialFilters = {}) {
    const where = this.buildWhere(companyId, filters);
    const rows = await this.prisma.factFinancialDaily.findMany({ where });

    const totals = rows.reduce(
      (acc, r) => ({
        revenue: acc.revenue + (r.type === 'REVENUE' ? Number(r.amount) : 0),
        expense: acc.expense + (r.type === 'EXPENSE' ? Number(r.amount) : 0),
        count: acc.count + r.count,
      }),
      { revenue: 0, expense: 0, count: 0 },
    );

    return { ...totals, balance: totals.revenue - totals.expense, rows };
  }

  /** Revenue vs expense by period (YYYY-MM-DD) */
  async cashFlow(companyId: string, filters: FinancialFilters = {}) {
    const where = this.buildWhere(companyId, filters);
    const rows = await this.prisma.factFinancialDaily.findMany({ where, orderBy: { period: 'asc' } });

    const byPeriod = new Map<string, { period: string; revenue: number; expense: number; balance: number }>();

    for (const row of rows) {
      const existing = byPeriod.get(row.period);
      const amount = Number(row.amount);
      if (existing) {
        if (row.type === 'REVENUE') {
          existing.revenue += amount;
          existing.balance += amount;
        } else {
          existing.expense += amount;
          existing.balance -= amount;
        }
      } else {
        byPeriod.set(row.period, {
          period: row.period,
          revenue: row.type === 'REVENUE' ? amount : 0,
          expense: row.type === 'EXPENSE' ? amount : 0,
          balance: row.type === 'REVENUE' ? amount : -amount,
        });
      }
    }

    return Array.from(byPeriod.values());
  }

  async drillDown(
    companyId: string,
    dimension: 'bankAccount' | 'category' | 'type',
    dimensionId: string,
    filters: FinancialFilters = {},
  ) {
    const where = this.buildWhere(companyId, filters);

    switch (dimension) {
      case 'bankAccount':
        return this.prisma.factFinancialDaily.findMany({ where: { ...where, bankAccountId: dimensionId } });
      case 'category':
        return this.prisma.factFinancialDaily.findMany({ where: { ...where, categoryId: dimensionId } });
      case 'type':
        return this.prisma.factFinancialDaily.findMany({ where: { ...where, type: dimensionId } });
    }
  }

  private buildWhere(companyId: string, filters: FinancialFilters) {
    const where: Record<string, unknown> = { companyId };
    if (filters.periodFrom || filters.periodTo) {
      where.period = {
        ...(filters.periodFrom ? { gte: filters.periodFrom } : {}),
        ...(filters.periodTo ? { lte: filters.periodTo } : {}),
      };
    }
    if (filters.bankAccountId) where.bankAccountId = filters.bankAccountId;
    if (filters.categoryId) where.categoryId = filters.categoryId;
    if (filters.type) where.type = filters.type;
    return where;
  }
}
