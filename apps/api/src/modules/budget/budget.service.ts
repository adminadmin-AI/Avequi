import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BudgetService {
  private readonly logger = new Logger(BudgetService.name);

  constructor(private readonly prisma: PrismaService) {}

  async upsert(companyId: string, data: {
    year: number; month: number; costCenterId?: string;
    categoryId?: string; amount: number; description?: string;
  }) {
    if (data.month < 1 || data.month > 12) throw new BadRequestException('Mês deve ser entre 1 e 12');

    return this.prisma.budget.upsert({
      where: {
        companyId_year_month_costCenterId_categoryId: {
          companyId, year: data.year, month: data.month,
          costCenterId: data.costCenterId ?? null,
          categoryId: data.categoryId ?? null,
        },
      },
      create: { companyId, ...data },
      update: { amount: data.amount, description: data.description },
    });
  }

  async findAll(companyId: string, year: number) {
    return this.prisma.budget.findMany({
      where: { companyId, year },
      include: { costCenter: true, category: true },
      orderBy: [{ month: 'asc' }],
    });
  }

  async getVariance(companyId: string, year: number, costCenterId?: string) {
    const budgets = await this.prisma.budget.findMany({
      where: { companyId, year, ...(costCenterId ? { costCenterId } : {}) },
      include: { category: true, costCenter: true },
    });

    // Actual from FinancialEntry
    const entries = await this.prisma.financialEntry.findMany({
      where: {
        companyId,
        createdAt: {
          gte: new Date(`${year}-01-01`),
          lt: new Date(`${year + 1}-01-01`),
        },
        ...(costCenterId ? { costCenterSplits: { some: { costCenterId } } } : {}),
      },
      select: { amount: true, type: true, categoryId: true, createdAt: true },
    });

    // Agrupar actual por mês
    const actualByMonth: Record<number, number> = {};
    for (const e of entries) {
      const m = e.createdAt.getMonth() + 1;
      const val = Number(e.amount) * (e.type === 'PAYABLE' ? -1 : 1);
      actualByMonth[m] = (actualByMonth[m] ?? 0) + Math.abs(val);
    }

    // Agrupar budget por mês
    const budgetByMonth: Record<number, number> = {};
    for (const b of budgets) {
      budgetByMonth[b.month] = (budgetByMonth[b.month] ?? 0) + Number(b.amount);
    }

    const months = [];
    for (let m = 1; m <= 12; m++) {
      const budget = budgetByMonth[m] ?? 0;
      const actual = actualByMonth[m] ?? 0;
      const variance = budget > 0 ? ((actual - budget) / budget) * 100 : 0;
      const alert = budget > 0 && actual >= budget * 0.9;
      months.push({ month: m, budget, actual, variance: Math.round(variance * 100) / 100, alert });
    }

    return { year, costCenterId, months };
  }

  async delete(id: string, companyId: string) {
    const budget = await this.prisma.budget.findFirst({ where: { id, companyId } });
    if (!budget) throw new NotFoundException('Orçamento não encontrado');
    return this.prisma.budget.delete({ where: { id } });
  }
}
