import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class EtlService {
  private readonly logger = new Logger(EtlService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Orchestrate all fact table snapshots for a given date.
   * Defaults to yesterday when no date is provided.
   */
  async runDailySnapshot(companyId: string, date?: string): Promise<void> {
    const period = date ?? this.yesterday();
    this.logger.log(`Running daily snapshot for company=${companyId} period=${period}`);

    await Promise.all([
      this.snapshotSales(companyId, period),
      this.snapshotInventory(companyId, period),
      this.snapshotProduction(companyId, period),
      this.snapshotFinancial(companyId, period),
    ]);

    this.logger.log(`Snapshot complete for company=${companyId} period=${period}`);
  }

  /** Aggregate confirmed SalesOrders for the day, grouped by product + customer */
  async snapshotSales(companyId: string, date: string): Promise<void> {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);

    const orders = await this.prisma.salesOrder.findMany({
      where: {
        companyId,
        status: 'CONFIRMED',
        confirmedAt: { gte: start, lte: end },
      },
      include: { items: true },
    });

    // Group by productId + customerId
    type GroupKey = string;
    const groups = new Map<
      GroupKey,
      { productId: string | null; customerId: string | null; revenue: number; quantity: number; orderIds: Set<string> }
    >();

    for (const order of orders) {
      for (const item of order.items) {
        const key = `${item.productId}::${order.customerId ?? '__null__'}`;
        const revenue = Number(item.unitPrice) * Number(item.quantity);
        const existing = groups.get(key);
        if (existing) {
          existing.revenue += revenue;
          existing.quantity += Number(item.quantity);
          existing.orderIds.add(order.id);
        } else {
          groups.set(key, {
            productId: item.productId,
            customerId: order.customerId ?? null,
            revenue,
            quantity: Number(item.quantity),
            orderIds: new Set([order.id]),
          });
        }
      }
    }

    for (const group of groups.values()) {
      const orderCount = group.orderIds.size;
      const avgTicket = orderCount > 0 ? group.revenue / orderCount : null;

      await this.prisma.factSalesDaily.upsert({
        where: {
          companyId_period_productId_customerId: {
            companyId,
            period: date,
            productId: group.productId ?? '',
            customerId: group.customerId ?? '',
          },
        },
        update: {
          revenue: group.revenue,
          quantity: group.quantity,
          orderCount,
          avgTicket,
        },
        create: {
          companyId,
          period: date,
          productId: group.productId,
          customerId: group.customerId,
          revenue: group.revenue,
          quantity: group.quantity,
          orderCount,
          avgTicket,
        },
      });
    }
  }

  /** Snapshot current StockBalance as of the given date */
  async snapshotInventory(companyId: string, date: string): Promise<void> {
    const balances = await this.prisma.stockBalance.findMany({
      where: { companyId },
    });

    for (const balance of balances) {
      const quantity = Number(balance.available) + Number(balance.reserved) + Number(balance.inTransit);
      const avgCost = balance.avgCost ? Number(balance.avgCost) : null;
      const value = avgCost != null ? quantity * avgCost : 0;

      await this.prisma.factInventoryDaily.upsert({
        where: {
          companyId_period_productId_warehouseId: {
            companyId,
            period: date,
            productId: balance.productId,
            warehouseId: balance.warehouseId,
          },
        },
        update: { quantity, value, avgCost },
        create: {
          companyId,
          period: date,
          productId: balance.productId,
          warehouseId: balance.warehouseId,
          quantity,
          value,
          avgCost,
        },
      });
    }
  }

  /** Aggregate completed ProductionOrders for the day */
  async snapshotProduction(companyId: string, date: string): Promise<void> {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);

    const orders = await this.prisma.productionOrder.findMany({
      where: {
        companyId,
        status: 'COMPLETED',
        completedAt: { gte: start, lte: end },
      },
      include: { items: true },
    });

    // We do not have workCenterId directly on ProductionOrder —
    // group by productId + null workCenterId (future: join routing for work-center breakdown)
    type GroupKey = string;
    const groups = new Map<
      GroupKey,
      { productId: string; workCenterId: string | null; quantity: number; materialCost: number; laborCost: number; orderCount: number }
    >();

    for (const order of orders) {
      const productId = order.productId;
      const workCenterId: string | null = null; // routing-step breakdown is future
      const key = `${productId}::${workCenterId ?? '__null__'}`;

      // Material cost = sum(item.qtyConsumed * product.costPrice)
      // We only have qtyConsumed here; cost would require a join to products.
      // Use a simple sum of consumed quantities as a proxy — enriched in future sprints.
      const materialCost = order.items.reduce((acc, i) => acc + Number(i.qtyConsumed), 0);
      const laborCost = 0; // routing-step labor cost is future
      const quantity = Number(order.quantity);

      const existing = groups.get(key);
      if (existing) {
        existing.quantity += quantity;
        existing.materialCost += materialCost;
        existing.laborCost += laborCost;
        existing.orderCount += 1;
      } else {
        groups.set(key, { productId, workCenterId, quantity, materialCost, laborCost, orderCount: 1 });
      }
    }

    for (const group of groups.values()) {
      const totalCost = group.materialCost + group.laborCost;

      await this.prisma.factProductionDaily.upsert({
        where: {
          companyId_period_productId_workCenterId: {
            companyId,
            period: date,
            productId: group.productId,
            workCenterId: group.workCenterId ?? '',
          },
        },
        update: {
          quantity: group.quantity,
          materialCost: group.materialCost,
          laborCost: group.laborCost,
          totalCost,
          orderCount: group.orderCount,
        },
        create: {
          companyId,
          period: date,
          productId: group.productId,
          workCenterId: group.workCenterId,
          quantity: group.quantity,
          materialCost: group.materialCost,
          laborCost: group.laborCost,
          totalCost,
          orderCount: group.orderCount,
        },
      });
    }
  }

  /** Aggregate paid Payables (EXPENSE) and paid Receivables (REVENUE) for the day */
  async snapshotFinancial(companyId: string, date: string): Promise<void> {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);

    // Receivables → REVENUE
    const receivables = await this.prisma.receivable.findMany({
      where: {
        companyId,
        status: 'PAID',
        paidAt: { gte: start, lte: end },
      },
    });

    type GroupKey = string;
    const revenueGroups = new Map<GroupKey, { bankAccountId: string | null; categoryId: string | null; amount: number; count: number }>();
    for (const r of receivables) {
      const key = `${r.bankAccountId ?? '__null__'}::${r.categoryId ?? '__null__'}`;
      const existing = revenueGroups.get(key);
      if (existing) {
        existing.amount += Number(r.paidAmount ?? r.amount);
        existing.count += 1;
      } else {
        revenueGroups.set(key, {
          bankAccountId: r.bankAccountId ?? null,
          categoryId: r.categoryId ?? null,
          amount: Number(r.paidAmount ?? r.amount),
          count: 1,
        });
      }
    }

    for (const group of revenueGroups.values()) {
      await this.prisma.factFinancialDaily.upsert({
        where: {
          companyId_period_bankAccountId_categoryId_type: {
            companyId,
            period: date,
            bankAccountId: group.bankAccountId ?? '',
            categoryId: group.categoryId ?? '',
            type: 'REVENUE',
          },
        },
        update: { amount: group.amount, count: group.count },
        create: {
          companyId,
          period: date,
          bankAccountId: group.bankAccountId,
          categoryId: group.categoryId,
          type: 'REVENUE',
          amount: group.amount,
          count: group.count,
        },
      });
    }

    // Payables → EXPENSE
    const payables = await this.prisma.payable.findMany({
      where: {
        companyId,
        status: 'PAID',
        paidAt: { gte: start, lte: end },
      },
    });

    const expenseGroups = new Map<GroupKey, { bankAccountId: string | null; categoryId: string | null; amount: number; count: number }>();
    for (const p of payables) {
      const key = `${p.bankAccountId ?? '__null__'}::${p.categoryId ?? '__null__'}`;
      const existing = expenseGroups.get(key);
      if (existing) {
        existing.amount += Number(p.paidAmount ?? p.amount);
        existing.count += 1;
      } else {
        expenseGroups.set(key, {
          bankAccountId: p.bankAccountId ?? null,
          categoryId: p.categoryId ?? null,
          amount: Number(p.paidAmount ?? p.amount),
          count: 1,
        });
      }
    }

    for (const group of expenseGroups.values()) {
      await this.prisma.factFinancialDaily.upsert({
        where: {
          companyId_period_bankAccountId_categoryId_type: {
            companyId,
            period: date,
            bankAccountId: group.bankAccountId ?? '',
            categoryId: group.categoryId ?? '',
            type: 'EXPENSE',
          },
        },
        update: { amount: group.amount, count: group.count },
        create: {
          companyId,
          period: date,
          bankAccountId: group.bankAccountId,
          categoryId: group.categoryId,
          type: 'EXPENSE',
          amount: group.amount,
          count: group.count,
        },
      });
    }
  }

  /** Run daily snapshot for all companies */
  async runAllCompanies(date?: string): Promise<void> {
    const companies = await this.prisma.company.findMany({ select: { id: true } });
    for (const company of companies) {
      await this.runDailySnapshot(company.id, date);
    }
  }

  private yesterday(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }
}
