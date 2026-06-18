import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpsertDemandDto } from './dto/upsert-demand.dto';

@Injectable()
export class DemandService {
  private readonly logger = new Logger(DemandService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── S11.01: Registrar / atualizar previsão de demanda ───────────────────

  async upsert(dto: UpsertDemandDto, userId?: string) {
    const existing = await this.prisma.demandForecast.findUnique({
      where: {
        companyId_productId_period: {
          companyId: dto.companyId,
          productId: dto.productId,
          period: dto.period,
        },
      },
    });

    const forecast = await this.prisma.demandForecast.upsert({
      where: {
        companyId_productId_period: {
          companyId: dto.companyId,
          productId: dto.productId,
          period: dto.period,
        },
      },
      create: {
        companyId: dto.companyId,
        productId: dto.productId,
        period: dto.period,
        quantity: dto.quantity,
        notes: dto.notes,
        createdById: userId,
      },
      update: {
        quantity: dto.quantity,
        notes: dto.notes,
      },
      include: { product: true, company: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId: dto.companyId,
        entity: 'DemandForecast',
        action: existing ? 'UPDATE' : 'CREATE',
        payload: {
          id: forecast.id,
          productId: dto.productId,
          period: dto.period,
          previousQty: existing ? Number(existing.quantity) : null,
          newQty: dto.quantity,
        },
      },
    });

    this.logger.log(
      `DemandForecast ${existing ? 'atualizado' : 'criado'}: ${dto.companyId}/${dto.productId}/${dto.period} → ${dto.quantity}`,
    );

    return forecast;
  }

  // ─── S11.02: Excluir previsão ─────────────────────────────────────────────

  async remove(id: string, companyId: string, userId?: string): Promise<void> {
    const forecast = await this.prisma.demandForecast.findFirst({
      where: { id, companyId },
    });

    if (!forecast) throw new NotFoundException(`Previsão de demanda ${id} não encontrada`);

    await this.prisma.demandForecast.delete({ where: { id } });

    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: 'DemandForecast',
        action: 'DELETE',
        payload: { id, productId: forecast.productId, period: forecast.period, quantity: Number(forecast.quantity) },
      },
    });
  }

  // ─── S11.03: Listar previsões por empresa + filtros ───────────────────────

  async findAll(
    companyId: string,
    filters: { period?: string; productId?: string } = {},
  ) {
    return this.prisma.demandForecast.findMany({
      where: {
        companyId,
        ...(filters.period ? { period: filters.period } : {}),
        ...(filters.productId ? { productId: filters.productId } : {}),
      },
      include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
      orderBy: [{ period: 'asc' }, { product: { name: 'asc' } }],
    });
  }

  // ─── S11.04: Consolidação — soma de todas as filiais por produto/período ──

  async getConsolidated(
    filters: { period?: string; productId?: string; parentCompanyId?: string } = {},
  ): Promise<Array<{ productId: string; productName: string; productSku: string; period: string; totalQty: number; entries: number }>> {
    const rows = await this.prisma.demandForecast.findMany({
      where: {
        ...(filters.period ? { period: filters.period } : {}),
        ...(filters.productId ? { productId: filters.productId } : {}),
        ...(filters.parentCompanyId
          ? {
              company: {
                OR: [
                  { id: filters.parentCompanyId },
                  { parentId: filters.parentCompanyId },
                ],
              },
            }
          : {}),
      },
      include: { product: { select: { id: true, name: true, sku: true } } },
      orderBy: [{ period: 'asc' }],
    });

    // Agregar em memória por productId + period
    const map = new Map<string, { productId: string; productName: string; productSku: string; period: string; totalQty: number; entries: number }>();

    for (const row of rows) {
      const key = `${row.productId}::${row.period}`;
      if (!map.has(key)) {
        map.set(key, {
          productId: row.productId,
          productName: row.product.name,
          productSku: row.product.sku,
          period: row.period,
          totalQty: 0,
          entries: 0,
        });
      }
      const entry = map.get(key)!;
      entry.totalQty += Number(row.quantity);
      entry.entries += 1;
    }

    return Array.from(map.values()).sort((a, b) =>
      a.period.localeCompare(b.period) || a.productName.localeCompare(b.productName),
    );
  }

  // ─── S11.05: Histórico de alterações (via AuditLog) ───────────────────────

  async getHistory(productId: string, companyId: string) {
    return this.prisma.auditLog.findMany({
      where: {
        companyId,
        entity: 'DemandForecast',
        payload: { path: ['productId'], equals: productId },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // ─── S11.06: Sugestão baseada em histórico de vendas ─────────────────────

  async getSuggestions(
    companyId: string,
    parentCompanyId?: string,
  ): Promise<Array<{ productId: string; productName: string; productSku: string; totalSold: number; horizonDays: number }>> {
    const lookupCompanyId = parentCompanyId ?? companyId;
    const param = await this.prisma.systemParameter.findUnique({
      where: { companyId_key: { companyId: lookupCompanyId, key: 'mrp_horizon_days' } },
    });
    const horizonDays = param ? parseInt(param.value, 10) : 30;
    const since = new Date();
    since.setDate(since.getDate() - horizonDays);

    const companyFilter: any = parentCompanyId
      ? { OR: [{ companyId: parentCompanyId }, { company: { parentId: parentCompanyId } }] }
      : { companyId };

    const items = await this.prisma.saleItem.findMany({
      where: { salesOrder: { ...companyFilter, status: 'INVOICED' as any, invoicedAt: { gte: since } } },
      include: { product: { select: { id: true, name: true, sku: true } } },
    });

    const map = new Map<string, { productId: string; productName: string; productSku: string; totalSold: number }>();
    for (const item of items) {
      if (!map.has(item.productId)) {
        map.set(item.productId, { productId: item.productId, productName: item.product.name, productSku: item.product.sku, totalSold: 0 });
      }
      map.get(item.productId)!.totalSold += Number(item.quantity);
    }

    return Array.from(map.values())
      .sort((a, b) => b.totalSold - a.totalSold)
      .map((r) => ({ ...r, horizonDays }));
  }

  // ─── S11.06b: Configurar horizonte MRP ───────────────────────────────────

  async setHorizon(companyId: string, days: number) {
    return this.prisma.systemParameter.upsert({
      where: { companyId_key: { companyId, key: 'mrp_horizon_days' } },
      create: { companyId, key: 'mrp_horizon_days', value: String(days) },
      update: { value: String(days) },
    });
  }
}
