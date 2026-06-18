import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface SuggestionInput {
  productId: string;
  type: 'PURCHASE' | 'PRODUCTION';
  grossQty: Prisma.Decimal | number;
  stockOnHand: Prisma.Decimal | number;
  netQty: Prisma.Decimal | number;
  bomLevel: number;
  suggestedDate: Date | null;
  notes: string | null;
}

@Injectable()
export class MrpService {
  private readonly logger = new Logger(MrpService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── S12.01: Disparar rodada MRP ─────────────────────────────────────────

  async run(companyId: string, userId?: string): Promise<{ runId: string }> {
    // Busca horizonte configurado
    const param = await this.prisma.systemParameter.findUnique({
      where: { companyId_key: { companyId, key: 'mrp_horizon_days' } },
    });
    const horizonDays = param ? parseInt(param.value, 10) : 30;

    // Cria o registro de execução
    const mrpRun = await this.prisma.mrpRun.create({
      data: {
        companyId,
        horizonDays,
        status: 'RUNNING',
        triggeredById: userId ?? null,
      },
    });

    this.logger.log(`MRP Run ${mrpRun.id} iniciado (horizonte: ${horizonDays} dias)`);

    // Executa cálculo em background (sem bloquear a resposta)
    this.executeRun(mrpRun.id, companyId, horizonDays).catch((err) => {
      this.logger.error(`MRP Run ${mrpRun.id} falhou: ${err.message}`);
    });

    return { runId: mrpRun.id };
  }

  // ─── Execução assíncrona do cálculo MRP ──────────────────────────────────

  async executeRun(runId: string, companyId: string, horizonDays: number): Promise<void> {
    try {
      const suggestions = await this.calculateRequirements(companyId, horizonDays);

      // Persiste sugestões
      if (suggestions.length > 0) {
        await this.prisma.mrpSuggestion.createMany({ data: suggestions.map((s) => ({ ...s, mrpRunId: runId })) });
      }

      await this.prisma.mrpRun.update({
        where: { id: runId },
        data: { status: 'DONE' },
      });

      this.logger.log(`MRP Run ${runId} concluído — ${suggestions.length} sugestões geradas`);
    } catch (err: any) {
      await this.prisma.mrpRun.update({
        where: { id: runId },
        data: { status: 'ERROR', errorMessage: err.message },
      });
      throw err;
    }
  }

  // ─── Cálculo de necessidades ──────────────────────────────────────────────

  async calculateRequirements(
    companyId: string,
    horizonDays: number,
  ): Promise<SuggestionInput[]> {
    // 1. Períodos dentro do horizonte
    const periods = this.buildPeriods(horizonDays);

    // 2. Busca todas as previsões de demanda no horizonte
    const forecasts = await this.prisma.demandForecast.findMany({
      where: { companyId, period: { in: periods } },
      include: { product: { select: { id: true, type: true } } },
    });

    if (forecasts.length === 0) return [];

    // 3. Agrega demanda bruta por produto
    const demandMap = new Map<string, number>();
    for (const f of forecasts) {
      const prev = demandMap.get(f.productId) ?? 0;
      demandMap.set(f.productId, prev + Number(f.quantity));
    }

    // 4. Carrega BOMs ativos (com items e componentes)
    const activeBoms = await this.prisma.bomVersion.findMany({
      where: { companyId, isActive: true },
      include: {
        items: {
          include: { component: { select: { id: true, type: true } } },
        },
      },
    });
    const bomByProduct = new Map(activeBoms.map((b) => [b.productId, b]));

    // 5. Explosão de BOM: agrega todas as necessidades de componentes
    const componentDemand = new Map<string, { grossQty: number; level: number }>();

    for (const [productId, grossQty] of demandMap.entries()) {
      const bomLevel = 0;
      // Produto final também entra nas sugestões (como PRODUCTION se tiver BOM)
      this.mergeDemand(componentDemand, productId, grossQty, bomLevel);
      // Explode componentes recursivamente
      this.explodeBom(productId, grossQty, bomByProduct, componentDemand, bomLevel + 1, new Set());
    }

    // 6. Busca estoque disponível para todos os produtos relevantes
    const productIds = Array.from(componentDemand.keys());
    const stockBalances = await this.prisma.stockBalance.findMany({
      where: { companyId, productId: { in: productIds } },
      select: { productId: true, available: true },
    });
    const stockMap = new Map<string, number>();
    for (const sb of stockBalances) {
      const prev = stockMap.get(sb.productId) ?? 0;
      stockMap.set(sb.productId, prev + Number(sb.available));
    }

    // 7. Determina tipo de sugestão e calcula necessidade líquida
    const suggestedDate = this.suggestedDate(horizonDays);
    const results: SuggestionInput[] = [];

    for (const [productId, { grossQty, level }] of componentDemand.entries()) {
      const stockOnHand = stockMap.get(productId) ?? 0;
      const netQty = Math.max(0, grossQty - stockOnHand);
      const hasBom = bomByProduct.has(productId);
      const type = hasBom ? 'PRODUCTION' : 'PURCHASE';

      results.push({
        productId,
        type,
        grossQty,
        stockOnHand,
        netQty,
        bomLevel: level,
        suggestedDate,
        notes: netQty === 0 ? 'Estoque cobre a demanda' : null,
      });
    }

    return results.sort((a, b) => a.bomLevel - b.bomLevel);
  }

  // ─── Explosão recursiva de BOM ────────────────────────────────────────────

  private explodeBom(
    productId: string,
    qty: number,
    bomByProduct: Map<string, any>,
    accumulator: Map<string, { grossQty: number; level: number }>,
    level: number,
    visited: Set<string>,
  ): void {
    // Proteção contra BOM circular
    if (visited.has(productId) || level > 10) return;
    const bom = bomByProduct.get(productId);
    if (!bom) return; // produto sem BOM = matéria-prima, para aqui

    visited.add(productId);

    for (const item of bom.items) {
      const componentQty = qty * Number(item.quantity) * (1 + Number(item.scrapPct) / 100);
      this.mergeDemand(accumulator, item.componentId, componentQty, level);
      // Recursão para sub-componentes
      this.explodeBom(item.componentId, componentQty, bomByProduct, accumulator, level + 1, new Set(visited));
    }
  }

  private mergeDemand(
    map: Map<string, { grossQty: number; level: number }>,
    productId: string,
    qty: number,
    level: number,
  ): void {
    const existing = map.get(productId);
    if (existing) {
      existing.grossQty += qty;
      // mantém o menor nível encontrado (mais alto na árvore)
      existing.level = Math.min(existing.level, level);
    } else {
      map.set(productId, { grossQty: qty, level });
    }
  }

  // ─── Utilitários de período/data ──────────────────────────────────────────

  private buildPeriods(horizonDays: number): string[] {
    const periods: string[] = [];
    const now = new Date();
    const months = Math.ceil(horizonDays / 30);
    for (let i = 0; i <= months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return [...new Set(periods)];
  }

  private suggestedDate(horizonDays: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + horizonDays);
    return d;
  }

  // ─── S12.02: Listar rodadas MRP ───────────────────────────────────────────

  async findAll(companyId: string) {
    return this.prisma.mrpRun.findMany({
      where: { companyId },
      select: {
        id: true,
        horizonDays: true,
        status: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
        triggeredBy: { select: { id: true, name: true } },
        _count: { select: { suggestions: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // ─── S12.03: Detalhe de uma rodada com sugestões ─────────────────────────

  async findOne(id: string, companyId: string) {
    const run = await this.prisma.mrpRun.findFirst({
      where: { id, companyId },
      include: {
        triggeredBy: { select: { id: true, name: true } },
        suggestions: {
          include: {
            product: { select: { id: true, sku: true, name: true, type: true, unit: true } },
          },
          orderBy: [{ bomLevel: 'asc' }, { netQty: 'desc' }],
        },
      },
    });

    if (!run) throw new NotFoundException(`MRP Run ${id} não encontrado`);
    return run;
  }

  // ─── S12.04: Apenas sugestões com necessidade > 0 ────────────────────────

  async findGaps(id: string, companyId: string) {
    const run = await this.findOne(id, companyId);
    return {
      ...run,
      suggestions: run.suggestions.filter((s) => Number(s.netQty) > 0),
    };
  }
}
