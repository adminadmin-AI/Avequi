import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerateForecastDto } from './dto/generate-forecast.dto';
import { AdjustForecastDto } from './dto/adjust-forecast.dto';
import {
  MonthlySale,
  ForecastResult,
  BacktestResult,
  computeWma,
  backtest,
  nextPeriod,
  currentPeriod,
} from './forecast.engine';

const DEFAULT_WINDOW = 3;
const DEFAULT_BACKTEST_MONTHS = 3;

@Injectable()
export class ForecastService {
  private readonly logger = new Logger(ForecastService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── S23.01: Histórico de vendas mensais por produto ─────────────────────

  async getSalesHistory(
    companyId: string,
    productId: string,
    months = 24,
  ): Promise<{ period: string; qty: number }[]> {
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const items = await this.prisma.saleItem.findMany({
      where: {
        productId,
        salesOrder: {
          companyId,
          status: 'INVOICED',
          invoicedAt: { gte: since },
        },
      },
      include: { salesOrder: { select: { invoicedAt: true } } },
    });

    // agregar por YYYY-MM
    const map = new Map<string, number>();
    for (const item of items) {
      if (!item.salesOrder.invoicedAt) continue;
      const d = item.salesOrder.invoicedAt;
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      map.set(period, (map.get(period) ?? 0) + Number(item.quantity));
    }

    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, qty]) => ({ period, qty }));
  }

  // ─── S23.02: Gerar previsão automática (WMA + sazonal) ───────────────────

  async generateForecasts(
    dto: GenerateForecastDto,
    userId?: string,
  ): Promise<{
    targetPeriod: string;
    generated: number;
    skipped: number;
    results: Array<{
      productId: string;
      sku: string;
      name: string;
      forecast: ForecastResult;
      demandForecastId: string;
    }>;
  }> {
    const windowMonths = dto.windowMonths ?? DEFAULT_WINDOW;
    const targetPeriod = dto.targetPeriod ?? nextPeriod(currentPeriod());

    // produtos a processar
    const products = await this.prisma.product.findMany({
      where: {
        companyId: dto.companyId,
        isActive: true,
        ...(dto.productId ? { id: dto.productId } : {}),
      },
      select: { id: true, sku: true, name: true },
    });

    // busca histórico de vendas de uma vez só (últimos 24 meses)
    const since = new Date();
    since.setMonth(since.getMonth() - 24);
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const allItems = await this.prisma.saleItem.findMany({
      where: {
        salesOrder: {
          companyId: dto.companyId,
          status: 'INVOICED',
          invoicedAt: { gte: since },
        },
        ...(dto.productId ? { productId: dto.productId } : {}),
      },
      include: { salesOrder: { select: { invoicedAt: true } } },
    });

    // agregar por productId + period
    const historyMap = new Map<string, MonthlySale[]>();
    for (const item of allItems) {
      if (!item.salesOrder.invoicedAt) continue;
      const d = item.salesOrder.invoicedAt;
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const existing = historyMap.get(item.productId) ?? [];
      const periodEntry = existing.find((e) => e.period === period);
      if (periodEntry) {
        periodEntry.qty += Number(item.quantity);
      } else {
        existing.push({ period, qty: Number(item.quantity) });
      }
      historyMap.set(item.productId, existing);
    }

    const results: Array<{
      productId: string;
      sku: string;
      name: string;
      forecast: ForecastResult;
      demandForecastId: string;
    }> = [];
    let skipped = 0;

    for (const product of products) {
      const history = historyMap.get(product.id) ?? [];

      // precisa de pelo menos 3 meses de histórico
      const periodsWithSales = history.filter(
        (h) => h.qty > 0 && h.period < targetPeriod,
      );
      if (periodsWithSales.length < DEFAULT_WINDOW) {
        skipped++;
        continue;
      }

      const result = computeWma(history, targetPeriod, windowMonths);

      if (result.forecast <= 0) {
        skipped++;
        continue;
      }

      const notes = [
        `Auto-gerado: WMA ${result.windowMonths}m`,
        result.hasSeasonality
          ? `SI=${result.seasonalIndex}`
          : 'sem ajuste sazonal',
        `períodos: ${result.periodsUsed.join(', ')}`,
      ].join(' | ');

      const df = await this.prisma.demandForecast.upsert({
        where: {
          companyId_productId_period: {
            companyId: dto.companyId,
            productId: product.id,
            period: targetPeriod,
          },
        },
        create: {
          companyId: dto.companyId,
          productId: product.id,
          period: targetPeriod,
          quantity: result.forecast,
          notes,
          createdById: userId,
        },
        update: {
          quantity: result.forecast,
          notes,
        },
      });

      results.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        forecast: result,
        demandForecastId: df.id,
      });
    }

    this.logger.log(
      `S23 generate: ${results.length} previsões geradas para ${targetPeriod}, ${skipped} skipped`,
    );

    return {
      targetPeriod,
      generated: results.length,
      skipped,
      results,
    };
  }

  // ─── S23.03: Ajuste manual da previsão ───────────────────────────────────

  async adjustForecast(
    id: string,
    companyId: string,
    dto: AdjustForecastDto,
    userId?: string,
  ) {
    const existing = await this.prisma.demandForecast.findFirst({
      where: { id, companyId },
    });
    if (!existing) {
      throw new NotFoundException(`Previsão de demanda ${id} não encontrada`);
    }

    const updated = await this.prisma.demandForecast.update({
      where: { id },
      data: {
        quantity: dto.quantity,
        notes: dto.notes
          ? `${existing.notes ?? ''} | Ajuste manual: ${dto.notes}`
          : `${existing.notes ?? ''} | Ajuste manual`,
      },
      include: {
        product: { select: { id: true, sku: true, name: true, unit: true } },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: 'DemandForecast',
        action: 'UPDATE',
        payload: {
          id,
          productId: existing.productId,
          period: existing.period,
          previousQty: Number(existing.quantity),
          newQty: dto.quantity,
          manual: true,
        },
      },
    });

    return updated;
  }

  // ─── S23.04: Backtest com MAPE ────────────────────────────────────────────

  async runBacktest(
    companyId: string,
    opts: {
      testMonths?: number;
      windowMonths?: number;
      productId?: string;
    } = {},
  ): Promise<{
    summary: {
      totalProducts: number;
      productsWithData: number;
      avgMape: number | null;
      avgAccuracy: number | null;
      meetsTarget: boolean; // MAPE < 30%
    };
    products: BacktestResult[];
  }> {
    const testMonths = opts.testMonths ?? DEFAULT_BACKTEST_MONTHS;
    const windowMonths = opts.windowMonths ?? DEFAULT_WINDOW;

    // histórico: precisamos de windowMonths + testMonths de dados
    const totalMonthsNeeded = windowMonths + testMonths;
    const since = new Date();
    since.setMonth(since.getMonth() - totalMonthsNeeded - 2); // margem
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const allItems = await this.prisma.saleItem.findMany({
      where: {
        salesOrder: {
          companyId,
          status: 'INVOICED',
          invoicedAt: { gte: since },
        },
        ...(opts.productId ? { productId: opts.productId } : {}),
      },
      include: {
        product: { select: { id: true, sku: true, name: true } },
        salesOrder: { select: { invoicedAt: true } },
      },
    });

    // agregar por productId + period
    const historyMap = new Map<
      string,
      { info: { sku: string; name: string }; sales: MonthlySale[] }
    >();

    for (const item of allItems) {
      if (!item.salesOrder.invoicedAt) continue;
      const d = item.salesOrder.invoicedAt;
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      if (!historyMap.has(item.productId)) {
        historyMap.set(item.productId, {
          info: { sku: item.product.sku, name: item.product.name },
          sales: [],
        });
      }
      const entry = historyMap.get(item.productId)!;
      const periodEntry = entry.sales.find((s) => s.period === period);
      if (periodEntry) {
        periodEntry.qty += Number(item.quantity);
      } else {
        entry.sales.push({ period, qty: Number(item.quantity) });
      }
    }

    const results: BacktestResult[] = [];

    for (const [productId, { sales }] of historyMap) {
      const result = backtest(productId, sales, testMonths, windowMonths);
      results.push(result);
    }

    // summary
    const withData = results.filter((r) => r.mape !== null);
    const avgMape =
      withData.length > 0
        ? Math.round(
            (withData.reduce((s, r) => s + r.mape!, 0) / withData.length) *
              100,
          ) / 100
        : null;

    return {
      summary: {
        totalProducts: results.length,
        productsWithData: withData.length,
        avgMape,
        avgAccuracy: avgMape !== null ? Math.round((100 - avgMape) * 100) / 100 : null,
        meetsTarget: avgMape !== null ? avgMape < 30 : false,
      },
      products: results,
    };
  }

  // ─── S23.05: Listar previsões geradas para um período ────────────────────

  async listForecasts(
    companyId: string,
    period: string,
  ) {
    return this.prisma.demandForecast.findMany({
      where: { companyId, period },
      include: {
        product: { select: { id: true, sku: true, name: true, unit: true } },
      },
      orderBy: { product: { name: 'asc' } },
    });
  }
}
