import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QuerySalesCubeDto } from './dto/query-sales-cube.dto';
import { QueryProductionCostsDto } from './dto/query-production-costs.dto';

// ─── Row Types ────────────────────────────────────────────────────────────────

export interface SalesCubeRow {
  period: string;
  productSku: string;
  productName: string;
  customerName: string;
  status: string;
  totalQty: number;
  totalRevenue: number;
  orderCount: number;
}

export interface InventoryAgingRow {
  sku: string;
  name: string;
  available: number;
  inventoryValue: number;
  lastMovementDate: Date | null;
  agingDays: number;
  agingBucket: '0-30' | '31-90' | '91-180' | '180+';
}

export interface ProductionCostRow {
  sku: string;
  productName: string;
  ordersCount: number;
  totalProduced: number;
  totalMaterialCost: number;
  totalLaborCost: number;
  totalCost: number;
  avgCostPerUnit: number;
}

export interface PurchaseAnalysisRow {
  supplierName: string;
  productSku: string;
  productName: string;
  totalOrders: number;
  totalQty: number;
  totalValue: number;
  avgUnitCost: number;
}

export interface StockTurnoverRow {
  sku: string;
  name: string;
  available: number;
  totalConsumed: number;
  turnoverRatio: number;
  daysOnHand: number;
}

export interface SupplierRankingRow {
  supplierName: string;
  totalOrders: number;
  totalValue: number;
  onTimeDeliveryPct: number;
  avgLeadTimeDays: number;
}

export interface NcRateBySupplierRow {
  supplierName: string;
  totalNcrs: number;
  minorCount: number;
  majorCount: number;
  criticalCount: number;
}

export interface OlapSummary {
  sales: {
    totalRevenue: number;
    totalOrders: number;
    avgTicket: number;
  };
  inventory: {
    totalSkus: number;
    totalValue: number;
    slowMovingCount: number;
  };
  production: {
    totalOrders: number;
    totalProduced: number;
    avgCostPerUnit: number;
  };
  quality: {
    totalNcrs: number;
    openNcrs: number;
    criticalNcrs: number;
  };
}

// ─── Raw query intermediate types ────────────────────────────────────────────

interface RawSalesCubeRow {
  period: Date | string;
  product_sku: string;
  product_name: string;
  customer_name: string;
  status: string;
  total_qty: string | number;
  total_revenue: string | number;
  order_count: string | number;
}

interface RawInventoryAgingRow {
  sku: string;
  name: string;
  available: string | number;
  avg_cost: string | number;
  last_movement_date: Date | null;
}

interface RawProductionCostRow {
  sku: string;
  product_name: string;
  orders_count: string | number;
  total_produced: string | number;
  total_material_cost: string | number;
  total_labor_cost: string | number;
  total_cost: string | number;
}

interface RawPurchaseAnalysisRow {
  supplier_name: string;
  product_sku: string;
  product_name: string;
  total_orders: string | number;
  total_qty: string | number;
  total_value: string | number;
  avg_unit_cost: string | number;
}

interface RawStockTurnoverRow {
  sku: string;
  name: string;
  available: string | number;
  total_consumed: string | number;
}

interface RawSupplierRankingRow {
  supplier_name: string;
  total_orders: string | number;
  total_value: string | number;
  on_time_count: string | number;
  total_gr_count: string | number;
  avg_lead_time_days: string | number;
}

interface RawNcRow {
  supplier_name: string;
  total_ncrs: string | number;
  minor_count: string | number;
  major_count: string | number;
  critical_count: string | number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toNumber(v: string | number | object | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return Number(v);
}

function agingBucket(days: number): '0-30' | '31-90' | '91-180' | '180+' {
  if (days <= 30) return '0-30';
  if (days <= 90) return '31-90';
  if (days <= 180) return '91-180';
  return '180+';
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── S26.01: Sales Cube ───────────────────────────────────────────────────

  async salesCube(
    companyId: string,
    dto: QuerySalesCubeDto,
  ): Promise<SalesCubeRow[]> {
    const startDate = dto.startDate ? new Date(dto.startDate) : new Date('2000-01-01');
    const endDate = dto.endDate ? new Date(dto.endDate) : new Date();

    const rows = await this.prisma.$queryRaw<RawSalesCubeRow[]>(Prisma.sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', so."createdAt"), 'YYYY-MM') AS period,
        p.sku                                                    AS product_sku,
        p.name                                                   AS product_name,
        COALESCE(c.name, 'Sem cliente')                         AS customer_name,
        so.status                                                AS status,
        SUM(si.quantity)::float8                                 AS total_qty,
        SUM(si.quantity * si."unitPrice")::float8                AS total_revenue,
        COUNT(DISTINCT so.id)::int                               AS order_count
      FROM gdr_sales_orders so
      JOIN gdr_sale_items si ON si."salesOrderId" = so.id
      JOIN gdr_products p   ON p.id = si."productId"
      LEFT JOIN gdr_customers c ON c.id = so."customerId"
      WHERE so."companyId" = ${companyId}
        AND so."createdAt" >= ${startDate}
        AND so."createdAt" <= ${endDate}
      GROUP BY
        DATE_TRUNC('month', so."createdAt"),
        p.sku,
        p.name,
        c.name,
        so.status
      ORDER BY period DESC, total_revenue DESC
    `);

    return rows.map((r) => ({
      period: String(r.period),
      productSku: r.product_sku,
      productName: r.product_name,
      customerName: r.customer_name,
      status: r.status,
      totalQty: toNumber(r.total_qty),
      totalRevenue: toNumber(r.total_revenue),
      orderCount: toNumber(r.order_count),
    }));
  }

  // ─── S26.02: Inventory Aging ──────────────────────────────────────────────

  async inventoryAging(companyId: string): Promise<InventoryAgingRow[]> {
    const rows = await this.prisma.$queryRaw<RawInventoryAgingRow[]>(Prisma.sql`
      SELECT
        p.sku,
        p.name,
        SUM(sb.available)::float8           AS available,
        COALESCE(p."avgCost", 0)::float8    AS avg_cost,
        (
          SELECT MAX(sm."createdAt")
          FROM gdr_stock_movements sm
          WHERE sm."productId" = p.id
            AND sm."companyId" = ${companyId}
        ) AS last_movement_date
      FROM gdr_stock_balances sb
      JOIN gdr_products p ON p.id = sb."productId"
      WHERE sb."companyId" = ${companyId}
        AND sb.available > 0
      GROUP BY p.id, p.sku, p.name, p."avgCost"
      ORDER BY last_movement_date ASC NULLS FIRST
    `);

    const now = new Date();

    return rows.map((r) => {
      const available = toNumber(r.available);
      const avgCost = toNumber(r.avg_cost);
      const lastMovementDate = r.last_movement_date
        ? new Date(r.last_movement_date)
        : null;
      const agingDays = lastMovementDate
        ? Math.floor(
            (now.getTime() - lastMovementDate.getTime()) / 86_400_000,
          )
        : 9999;

      return {
        sku: r.sku,
        name: r.name,
        available,
        inventoryValue: available * avgCost,
        lastMovementDate,
        agingDays,
        agingBucket: agingBucket(agingDays),
      };
    });
  }

  // ─── S26.03: Production Cost Analysis ────────────────────────────────────

  async productionCostAnalysis(
    companyId: string,
    dto: QueryProductionCostsDto,
  ): Promise<ProductionCostRow[]> {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    const rows = await this.prisma.$queryRaw<RawProductionCostRow[]>(Prisma.sql`
      SELECT
        p.sku,
        p.name                              AS product_name,
        COUNT(po.id)::int                   AS orders_count,
        SUM(po."producedQty")::float8       AS total_produced,
        SUM(pc."materialCost")::float8      AS total_material_cost,
        SUM(pc."laborCost")::float8         AS total_labor_cost,
        SUM(pc."totalCost")::float8         AS total_cost
      FROM gdr_production_orders po
      JOIN gdr_products p          ON p.id = po."productId"
      JOIN gdr_production_costs pc ON pc."productionOrderId" = po.id
      WHERE po."companyId" = ${companyId}
        AND po.status = 'DONE'
        AND po."completedAt" >= ${startDate}
        AND po."completedAt" <= ${endDate}
      GROUP BY p.id, p.sku, p.name
      ORDER BY total_cost DESC
    `);

    return rows.map((r) => {
      const totalProduced = toNumber(r.total_produced);
      const totalCost = toNumber(r.total_cost);
      return {
        sku: r.sku,
        productName: r.product_name,
        ordersCount: toNumber(r.orders_count),
        totalProduced,
        totalMaterialCost: toNumber(r.total_material_cost),
        totalLaborCost: toNumber(r.total_labor_cost),
        totalCost,
        avgCostPerUnit: totalProduced > 0 ? totalCost / totalProduced : 0,
      };
    });
  }

  // ─── S26.04: Purchase Analysis ────────────────────────────────────────────

  async purchaseAnalysis(
    companyId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<PurchaseAnalysisRow[]> {
    const start = startDate ? new Date(startDate) : new Date('2000-01-01');
    const end = endDate ? new Date(endDate) : new Date();

    const rows = await this.prisma.$queryRaw<RawPurchaseAnalysisRow[]>(Prisma.sql`
      SELECT
        s.name                                AS supplier_name,
        p.sku                                 AS product_sku,
        p.name                                AS product_name,
        COUNT(DISTINCT po.id)::int            AS total_orders,
        SUM(pi.quantity)::float8              AS total_qty,
        SUM(pi.quantity * pi."unitCost")::float8 AS total_value,
        AVG(pi."unitCost")::float8            AS avg_unit_cost
      FROM gdr_purchase_orders po
      JOIN gdr_suppliers s  ON s.id = po."supplierId"
      JOIN gdr_po_items pi  ON pi."purchaseOrderId" = po.id
      JOIN gdr_products p   ON p.id = pi."productId"
      WHERE po."companyId" = ${companyId}
        AND po."createdAt" >= ${start}
        AND po."createdAt" <= ${end}
      GROUP BY s.name, p.sku, p.name
      ORDER BY total_value DESC
    `);

    return rows.map((r) => ({
      supplierName: r.supplier_name,
      productSku: r.product_sku,
      productName: r.product_name,
      totalOrders: toNumber(r.total_orders),
      totalQty: toNumber(r.total_qty),
      totalValue: toNumber(r.total_value),
      avgUnitCost: toNumber(r.avg_unit_cost),
    }));
  }

  // ─── S26.05: Stock Turnover ───────────────────────────────────────────────

  async stockTurnover(
    companyId: string,
    months = 3,
  ): Promise<StockTurnoverRow[]> {
    const periodStart = new Date();
    periodStart.setMonth(periodStart.getMonth() - months);
    const periodDays = months * 30;

    const rows = await this.prisma.$queryRaw<RawStockTurnoverRow[]>(Prisma.sql`
      SELECT
        p.sku,
        p.name,
        SUM(sb.available)::float8 AS available,
        COALESCE(
          (
            SELECT SUM(sm.quantity)::float8
            FROM gdr_stock_movements sm
            WHERE sm."productId" = p.id
              AND sm."companyId" = ${companyId}
              AND sm.type IN ('EXIT', 'TRANSFER_OUT')
              AND sm."createdAt" >= ${periodStart}
          ), 0
        ) AS total_consumed
      FROM gdr_stock_balances sb
      JOIN gdr_products p ON p.id = sb."productId"
      WHERE sb."companyId" = ${companyId}
        AND sb.available > 0
      GROUP BY p.id, p.sku, p.name
    `);

    return rows
      .map((r) => {
        const available = toNumber(r.available);
        const totalConsumed = toNumber(r.total_consumed);
        const turnoverRatio =
          available > 0 ? totalConsumed / available : 0;
        const daysOnHand =
          totalConsumed > 0
            ? (available / (totalConsumed / periodDays))
            : Infinity;

        return {
          sku: r.sku,
          name: r.name,
          available,
          totalConsumed,
          turnoverRatio,
          daysOnHand: isFinite(daysOnHand) ? daysOnHand : 0,
        };
      })
      .sort((a, b) => b.turnoverRatio - a.turnoverRatio);
  }

  // ─── S26.06: Supplier Ranking ─────────────────────────────────────────────

  async supplierRanking(companyId: string): Promise<SupplierRankingRow[]> {
    const rows = await this.prisma.$queryRaw<RawSupplierRankingRow[]>(Prisma.sql`
      SELECT
        s.name                                                   AS supplier_name,
        COUNT(DISTINCT po.id)::int                               AS total_orders,
        SUM(pi.quantity * pi."unitCost")::float8                 AS total_value,
        COUNT(gr.id)::int                                        AS total_gr_count,
        SUM(
          CASE
            WHEN gr."createdAt" <= po."expectedAt" THEN 1
            ELSE 0
          END
        )::int                                                   AS on_time_count,
        AVG(
          EXTRACT(EPOCH FROM (gr."createdAt" - po."createdAt")) / 86400.0
        )::float8                                                AS avg_lead_time_days
      FROM gdr_purchase_orders po
      JOIN gdr_suppliers s      ON s.id = po."supplierId"
      JOIN gdr_po_items pi      ON pi."purchaseOrderId" = po.id
      LEFT JOIN gdr_goods_receipts gr ON gr."purchaseOrderId" = po.id
      WHERE po."companyId" = ${companyId}
      GROUP BY s.id, s.name
      ORDER BY total_value DESC
    `);

    return rows.map((r) => {
      const totalGrCount = toNumber(r.total_gr_count);
      const onTimeCount = toNumber(r.on_time_count);
      return {
        supplierName: r.supplier_name,
        totalOrders: toNumber(r.total_orders),
        totalValue: toNumber(r.total_value),
        onTimeDeliveryPct:
          totalGrCount > 0 ? (onTimeCount / totalGrCount) * 100 : 0,
        avgLeadTimeDays: toNumber(r.avg_lead_time_days),
      };
    });
  }

  // ─── S26.07: NC Rate by Supplier ─────────────────────────────────────────

  async ncRateBySupplier(companyId: string): Promise<NcRateBySupplierRow[]> {
    const rows = await this.prisma.$queryRaw<RawNcRow[]>(Prisma.sql`
      SELECT
        s.name                                       AS supplier_name,
        COUNT(nc.id)::int                            AS total_ncrs,
        SUM(CASE WHEN nc.severity = 'MINOR'    THEN 1 ELSE 0 END)::int AS minor_count,
        SUM(CASE WHEN nc.severity = 'MAJOR'    THEN 1 ELSE 0 END)::int AS major_count,
        SUM(CASE WHEN nc.severity = 'CRITICAL' THEN 1 ELSE 0 END)::int AS critical_count
      FROM gdr_non_conformances nc
      JOIN gdr_suppliers s ON s.id = nc."supplierId"
      WHERE nc."companyId" = ${companyId}
        AND nc."supplierId" IS NOT NULL
      GROUP BY s.id, s.name
      ORDER BY total_ncrs DESC
    `);

    return rows.map((r) => ({
      supplierName: r.supplier_name,
      totalNcrs: toNumber(r.total_ncrs),
      minorCount: toNumber(r.minor_count),
      majorCount: toNumber(r.major_count),
      criticalCount: toNumber(r.critical_count),
    }));
  }

  // ─── S26.08: OLAP Summary ────────────────────────────────────────────────

  async getOlapSummary(companyId: string): Promise<OlapSummary> {
    const [
      salesAgg,
      saleItemsAgg,
      stockSkus,
      stockValue,
      slowMoving,
      productionAgg,
      productionCostAgg,
      totalNcrs,
      openNcrs,
      criticalNcrs,
    ] = await Promise.all([
      // Sales
      this.prisma.salesOrder.aggregate({
        where: { companyId, status: { in: ['INVOICED'] } },
        _count: { id: true },
      }),
      this.prisma.saleItem.aggregate({
        where: {
          salesOrder: {
            companyId,
            status: { in: ['INVOICED'] },
          },
        },
        _sum: { quantity: true, unitPrice: true },
      }),
      // Inventory
      this.prisma.stockBalance.count({
        where: { companyId, available: { gt: 0 } },
      }),
      this.prisma.stockBalance.aggregate({
        where: { companyId, available: { gt: 0 } },
        _sum: { available: true },
      }),
      // Slow moving: products with no movement (proxy: no stock movement in last 90 days)
      this.prisma.stockBalance.count({
        where: {
          companyId,
          available: { gt: 0 },
          product: {
            stockMovements: {
              none: {
                companyId,
                createdAt: {
                  gte: new Date(Date.now() - 90 * 86_400_000),
                },
              },
            },
          },
        },
      }),
      // Production
      this.prisma.productionOrder.aggregate({
        where: { companyId, status: 'DONE' },
        _count: { id: true },
        _sum: { producedQty: true },
      }),
      this.prisma.productionCost.aggregate({
        where: {
          productionOrder: { companyId, status: 'DONE' },
        },
        _avg: { costPerUnit: true },
      }),
      // Quality
      this.prisma.nonConformance.count({ where: { companyId } }),
      this.prisma.nonConformance.count({
        where: {
          companyId,
          status: { in: ['OPEN', 'UNDER_ANALYSIS', 'CORRECTIVE_ACTION'] },
        },
      }),
      this.prisma.nonConformance.count({
        where: { companyId, severity: 'CRITICAL' },
      }),
    ]);

    const totalOrders = salesAgg._count.id;
    // totalRevenue proxy: sum of all invoiced sale items value
    // We use a raw query for accuracy since Prisma can't sum a product of two fields
    const revenueRows = await this.prisma.$queryRaw<{ total: string }[]>(Prisma.sql`
      SELECT COALESCE(SUM(si.quantity * si."unitPrice"), 0)::float8 AS total
      FROM gdr_sale_items si
      JOIN gdr_sales_orders so ON so.id = si."salesOrderId"
      WHERE so."companyId" = ${companyId}
        AND so.status = 'INVOICED'
    `);
    const totalRevenue = toNumber(revenueRows[0]?.total ?? 0);

    return {
      sales: {
        totalRevenue,
        totalOrders,
        avgTicket: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      },
      inventory: {
        totalSkus: stockSkus,
        totalValue: toNumber(stockValue._sum.available),
        slowMovingCount: slowMoving,
      },
      production: {
        totalOrders: productionAgg._count.id,
        totalProduced: toNumber(productionAgg._sum.producedQty),
        avgCostPerUnit: toNumber(productionCostAgg._avg.costPerUnit),
      },
      quality: {
        totalNcrs,
        openNcrs,
        criticalNcrs,
      },
    };
  }
}
