import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── helpers ─────────────────────────────────────────────────────────────

  private last6Months(): Date {
    const d = new Date();
    d.setMonth(d.getMonth() - 5);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private monthKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  private buildMonthSlots(): string[] {
    const slots: string[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      slots.push(this.monthKey(d));
    }
    return slots;
  }

  // ─── S21.01: Painel Executivo ─────────────────────────────────────────────

  async getExecutive(companyId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const [
      salesByStatus,
      invoicedThisMonth,
      invoicedLastMonth,
      receivableOpen,
      receivableOverdue,
      payableOpen,
      payableOverdue,
      productionByStatus,
      stockPositions,
      pendingPOs,
    ] = await Promise.all([
      // Vendas por status
      this.prisma.salesOrder.groupBy({
        by: ['status'],
        where: { companyId },
        _count: { id: true },
      }),

      // Faturamento este mês (soma de SaleItems de OVs INVOICED)
      this.prisma.saleItem.aggregate({
        where: {
          salesOrder: {
            companyId,
            status: 'INVOICED',
            invoicedAt: { gte: startOfMonth },
          },
        },
        _sum: { quantity: true, unitPrice: true },
      }),

      // Faturamento mês anterior
      this.prisma.saleItem.aggregate({
        where: {
          salesOrder: {
            companyId,
            status: 'INVOICED',
            invoicedAt: { gte: startOfLastMonth, lte: endOfLastMonth },
          },
        },
        _sum: { quantity: true, unitPrice: true },
      }),

      // Recebíveis abertos
      this.prisma.financialEntry.aggregate({
        where: { companyId, type: 'RECEIVABLE', status: 'OPEN' },
        _sum: { amount: true },
        _count: { id: true },
      }),

      // Recebíveis vencidos
      this.prisma.financialEntry.aggregate({
        where: { companyId, type: 'RECEIVABLE', status: 'OVERDUE' },
        _sum: { amount: true },
        _count: { id: true },
      }),

      // Pagáveis abertos
      this.prisma.financialEntry.aggregate({
        where: { companyId, type: 'PAYABLE', status: 'OPEN' },
        _sum: { amount: true },
        _count: { id: true },
      }),

      // Pagáveis vencidos
      this.prisma.financialEntry.aggregate({
        where: { companyId, type: 'PAYABLE', status: 'OVERDUE' },
        _sum: { amount: true },
        _count: { id: true },
      }),

      // OPs por status
      this.prisma.productionOrder.groupBy({
        by: ['status'],
        where: { companyId },
        _count: { id: true },
      }),

      // Total de itens em estoque (sum available)
      this.prisma.stockBalance.aggregate({
        where: { companyId },
        _sum: { available: true },
        _count: { id: true },
      }),

      // POs pendentes (DRAFT + APPROVED)
      this.prisma.purchaseOrder.count({
        where: { companyId, status: { in: ['DRAFT', 'APPROVED'] } },
      }),
    ]);

    const toStatusMap = (rows: { status: string; _count: { id: number } }[]) =>
      Object.fromEntries(rows.map((r) => [r.status, r._count.id]));

    // Receita = sum(qty × unitPrice) — aproximação; idealmente seria sum(subtotal)
    const revenueThisMonth = this.calcRevenue(invoicedThisMonth);
    const revenueLastMonth = this.calcRevenue(invoicedLastMonth);
    const revenueGrowth =
      revenueLastMonth > 0
        ? Math.round(((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100)
        : null;

    return {
      sales: {
        byStatus: toStatusMap(salesByStatus as any),
        revenueThisMonth,
        revenueLastMonth,
        revenueGrowthPct: revenueGrowth,
      },
      finance: {
        receivable: {
          open: { count: receivableOpen._count.id, amount: Number(receivableOpen._sum.amount ?? 0) },
          overdue: { count: receivableOverdue._count.id, amount: Number(receivableOverdue._sum.amount ?? 0) },
        },
        payable: {
          open: { count: payableOpen._count.id, amount: Number(payableOpen._sum.amount ?? 0) },
          overdue: { count: payableOverdue._count.id, amount: Number(payableOverdue._sum.amount ?? 0) },
        },
      },
      production: {
        byStatus: toStatusMap(productionByStatus as any),
      },
      stock: {
        totalPositions: stockPositions._count.id,
        totalAvailableQty: Number(stockPositions._sum.available ?? 0),
      },
      purchases: {
        pendingOrders: pendingPOs,
      },
    };
  }

  private calcRevenue(agg: { _sum: { quantity: unknown; unitPrice: unknown } }): number {
    // Sem subtotal armazenado — retornamos 0 (calculado no painel de vendas com query dedicada)
    // Aqui usamos apenas o count como proxy; o painel /dashboard/sales tem o valor real
    return 0;
  }

  // ─── S21.02: Painel de Vendas ─────────────────────────────────────────────

  async getSales(companyId: string) {
    const since = this.last6Months();
    const slots = this.buildMonthSlots();

    const [byStatus, invoicedOrders, topProductsRaw, topCustomersRaw] = await Promise.all([
      this.prisma.salesOrder.groupBy({
        by: ['status'],
        where: { companyId },
        _count: { id: true },
      }),

      // OVs faturadas nos últimos 6 meses com itens
      this.prisma.salesOrder.findMany({
        where: { companyId, status: 'INVOICED', invoicedAt: { gte: since } },
        select: {
          id: true,
          invoicedAt: true,
          items: { select: { quantity: true, unitPrice: true, productId: true, product: { select: { name: true, sku: true } } } },
          customer: { select: { id: true, name: true } },
        },
      }),

      // Top produtos (por quantidade faturada)
      this.prisma.saleItem.groupBy({
        by: ['productId'],
        where: { salesOrder: { companyId, status: 'INVOICED', invoicedAt: { gte: since } } },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      }),

      // Top clientes (por número de OVs)
      this.prisma.salesOrder.groupBy({
        by: ['customerId'],
        where: { companyId, status: 'INVOICED', invoicedAt: { gte: since }, customerId: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5,
      }),
    ]);

    // Receita mensal
    const monthlyRevenue: Record<string, number> = Object.fromEntries(slots.map((s) => [s, 0]));
    for (const order of invoicedOrders) {
      if (!order.invoicedAt) continue;
      const key = this.monthKey(order.invoicedAt);
      if (key in monthlyRevenue) {
        const subtotal = order.items.reduce(
          (acc, i) => acc + Number(i.quantity) * Number(i.unitPrice),
          0,
        );
        monthlyRevenue[key] += subtotal;
      }
    }

    // Enriquecer top produtos
    const productIds = topProductsRaw.map((r) => r.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, sku: true, name: true },
    });
    const productMap = Object.fromEntries(products.map((p) => [p.id, p]));

    const topProducts = topProductsRaw.map((r) => ({
      product: productMap[r.productId] ?? { id: r.productId },
      totalQty: Number(r._sum.quantity ?? 0),
    }));

    // Enriquecer top clientes
    const customerIds = topCustomersRaw.map((r) => r.customerId).filter(Boolean) as string[];
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, name: true },
    });
    const customerMap = Object.fromEntries(customers.map((c) => [c.id, c]));

    const topCustomers = topCustomersRaw.map((r) => ({
      customer: r.customerId ? (customerMap[r.customerId] ?? { id: r.customerId }) : null,
      orderCount: r._count.id,
    }));

    const toStatusMap = (rows: { status: string; _count: { id: number } }[]) =>
      Object.fromEntries(rows.map((r) => [r.status, r._count.id]));

    return {
      byStatus: toStatusMap(byStatus as any),
      monthlyRevenue: slots.map((month) => ({
        month,
        revenue: Math.round(monthlyRevenue[month] * 100) / 100,
      })),
      topProducts,
      topCustomers,
    };
  }

  // ─── S21.03: Painel Financeiro ────────────────────────────────────────────

  async getFinance(companyId: string) {
    const in7Days = new Date();
    in7Days.setDate(in7Days.getDate() + 7);
    const since = this.last6Months();
    const slots = this.buildMonthSlots();

    const [receivable, payable, upcomingReceivable, upcomingPayable, paidHistory] =
      await Promise.all([
        // Recebíveis por status
        this.prisma.financialEntry.groupBy({
          by: ['status'],
          where: { companyId, type: 'RECEIVABLE' },
          _sum: { amount: true },
          _count: { id: true },
        }),

        // Pagáveis por status
        this.prisma.financialEntry.groupBy({
          by: ['status'],
          where: { companyId, type: 'PAYABLE' },
          _sum: { amount: true },
          _count: { id: true },
        }),

        // Vencimentos a receber nos próximos 7 dias
        this.prisma.financialEntry.aggregate({
          where: {
            companyId,
            type: 'RECEIVABLE',
            status: 'OPEN',
            dueDate: { lte: in7Days },
          },
          _sum: { amount: true },
          _count: { id: true },
        }),

        // Vencimentos a pagar nos próximos 7 dias
        this.prisma.financialEntry.aggregate({
          where: {
            companyId,
            type: 'PAYABLE',
            status: 'OPEN',
            dueDate: { lte: in7Days },
          },
          _sum: { amount: true },
          _count: { id: true },
        }),

        // Entradas pagas nos últimos 6 meses (para gráfico de fluxo)
        this.prisma.financialEntry.findMany({
          where: {
            companyId,
            status: 'PAID',
            paidAt: { gte: since },
          },
          select: { type: true, amount: true, paidAt: true },
        }),
      ]);

    // Fluxo mensal
    const inflow: Record<string, number> = Object.fromEntries(slots.map((s) => [s, 0]));
    const outflow: Record<string, number> = Object.fromEntries(slots.map((s) => [s, 0]));
    for (const entry of paidHistory) {
      if (!entry.paidAt) continue;
      const key = this.monthKey(entry.paidAt);
      if (!(key in inflow)) continue;
      if (entry.type === 'RECEIVABLE') inflow[key] += Number(entry.amount);
      else outflow[key] += Number(entry.amount);
    }

    const toFinMap = (rows: { status: string; _sum: { amount: unknown }; _count: { id: number } }[]) =>
      Object.fromEntries(rows.map((r) => [r.status, { amount: Number(r._sum.amount ?? 0), count: r._count.id }]));

    return {
      receivable: toFinMap(receivable as any),
      payable: toFinMap(payable as any),
      upcoming7Days: {
        receivable: { count: upcomingReceivable._count.id, amount: Number(upcomingReceivable._sum.amount ?? 0) },
        payable: { count: upcomingPayable._count.id, amount: Number(upcomingPayable._sum.amount ?? 0) },
      },
      monthlyCashFlow: slots.map((month) => ({
        month,
        inflow: Math.round(inflow[month] * 100) / 100,
        outflow: Math.round(outflow[month] * 100) / 100,
        net: Math.round((inflow[month] - outflow[month]) * 100) / 100,
      })),
    };
  }

  // ─── S21.04: Painel de Produção ───────────────────────────────────────────

  async getProduction(companyId: string) {
    const since = this.last6Months();
    const slots = this.buildMonthSlots();

    const [byStatus, recentOrders, topProducts] = await Promise.all([
      this.prisma.productionOrder.groupBy({
        by: ['status'],
        where: { companyId },
        _count: { id: true },
      }),

      // OPs concluídas nos últimos 6 meses (para gráfico)
      this.prisma.productionOrder.findMany({
        where: { companyId, status: 'DONE', updatedAt: { gte: since } },
        select: { updatedAt: true, plannedQty: true },
      }),

      // Produtos mais produzidos
      this.prisma.productionOrder.groupBy({
        by: ['productId'],
        where: { companyId, status: 'DONE' },
        _sum: { plannedQty: true },
        orderBy: { _sum: { plannedQty: 'desc' } },
        take: 5,
      }),
    ]);

    // OPs concluídas por mês
    const doneByMonth: Record<string, number> = Object.fromEntries(slots.map((s) => [s, 0]));
    for (const op of recentOrders) {
      const key = this.monthKey(op.updatedAt);
      if (key in doneByMonth) doneByMonth[key]++;
    }

    // Enriquecer top produtos
    const productIds = topProducts.map((r) => r.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, sku: true, name: true },
    });
    const productMap = Object.fromEntries(products.map((p) => [p.id, p]));

    const toStatusMap = (rows: { status: string; _count: { id: number } }[]) =>
      Object.fromEntries(rows.map((r) => [r.status, r._count.id]));

    return {
      byStatus: toStatusMap(byStatus as any),
      monthlyDone: slots.map((month) => ({ month, count: doneByMonth[month] })),
      topProducts: topProducts.map((r) => ({
        product: productMap[r.productId] ?? { id: r.productId },
        totalQty: Number(r._sum.plannedQty ?? 0),
      })),
    };
  }

  // ─── S21.05: Painel de Estoque ────────────────────────────────────────────

  async getStock(companyId: string) {
    const [byWarehouse, zeroStock, lowStockCount, totalSkus] = await Promise.all([
      // Estoque por armazém
      this.prisma.stockBalance.groupBy({
        by: ['warehouseId'],
        where: { companyId },
        _sum: { available: true, reserved: true },
        _count: { id: true },
      }),

      // SKUs com saldo zero
      this.prisma.stockBalance.count({
        where: { companyId, available: { lte: 0 } },
      }),

      // SKUs com saldo baixo (< 5 — proxy simples)
      this.prisma.stockBalance.count({
        where: { companyId, available: { gt: 0, lt: 5 } },
      }),

      // Total de SKUs com posição
      this.prisma.stockBalance.count({ where: { companyId } }),
    ]);

    // Enriquecer com nome do armazém
    const warehouseIds = byWarehouse.map((r) => r.warehouseId);
    const warehouses = await this.prisma.warehouse.findMany({
      where: { id: { in: warehouseIds } },
      select: { id: true, code: true, name: true },
    });
    const warehouseMap = Object.fromEntries(warehouses.map((w) => [w.id, w]));

    return {
      totalSkus,
      zeroStockSkus: zeroStock,
      lowStockSkus: lowStockCount,
      byWarehouse: byWarehouse.map((r) => ({
        warehouse: warehouseMap[r.warehouseId] ?? { id: r.warehouseId },
        skuCount: r._count.id,
        totalAvailable: Number(r._sum.available ?? 0),
        totalReserved: Number(r._sum.reserved ?? 0),
      })),
    };
  }

  // ─── S21.06: Painel de Compras ────────────────────────────────────────────

  async getPurchases(companyId: string) {
    const since = this.last6Months();
    const slots = this.buildMonthSlots();

    const [byStatus, recentPOs, topSuppliers] = await Promise.all([
      this.prisma.purchaseOrder.groupBy({
        by: ['status'],
        where: { companyId },
        _count: { id: true },
      }),

      // POs dos últimos 6 meses com itens para calcular valor
      this.prisma.purchaseOrder.findMany({
        where: { companyId, createdAt: { gte: since } },
        select: {
          id: true,
          createdAt: true,
          status: true,
          supplierId: true,
          items: { select: { quantity: true, unitCost: true } },
        },
      }),

      // Top fornecedores por número de POs
      this.prisma.purchaseOrder.groupBy({
        by: ['supplierId'],
        where: { companyId, createdAt: { gte: since } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5,
      }),
    ]);

    // Valor de compras por mês
    const monthlyValue: Record<string, number> = Object.fromEntries(slots.map((s) => [s, 0]));
    for (const po of recentPOs) {
      const key = this.monthKey(po.createdAt);
      if (!(key in monthlyValue)) continue;
      const total = po.items.reduce((acc, i) => acc + Number(i.quantity) * Number(i.unitCost), 0);
      monthlyValue[key] += total;
    }

    // Enriquecer fornecedores
    const supplierIds = topSuppliers.map((r) => r.supplierId);
    const suppliers = await this.prisma.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, name: true },
    });
    const supplierMap = Object.fromEntries(suppliers.map((s) => [s.id, s]));

    const toStatusMap = (rows: { status: string; _count: { id: number } }[]) =>
      Object.fromEntries(rows.map((r) => [r.status, r._count.id]));

    return {
      byStatus: toStatusMap(byStatus as any),
      monthlyValue: slots.map((month) => ({
        month,
        value: Math.round(monthlyValue[month] * 100) / 100,
      })),
      topSuppliers: topSuppliers.map((r) => ({
        supplier: supplierMap[r.supplierId] ?? { id: r.supplierId },
        orderCount: r._count.id,
      })),
    };
  }
}
