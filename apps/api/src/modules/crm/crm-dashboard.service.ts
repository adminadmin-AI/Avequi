import { Injectable } from '@nestjs/common';
import { LeadActivityType, PipelineStageType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface DashboardRange {
  companyId: string;
  from: Date;
  to: Date;
}

/**
 * F3.1 (#517) — dashboard do CRM: funil de conversão, quebra por origem com
 * receita faturada (via vínculo Lead↔OV), ranking por vendedor e motivos de
 * perda. Responde as perguntas de dono: qual canal traz lead que FECHA?
 */
@Injectable()
export class CrmDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(range: DashboardRange, coolingDays = 7) {
    const [
      funnel,
      bySource,
      bySeller,
      lostReasons,
      slaEscalations,
      crossStoreDuplicates,
      avgSalesCycleDays,
      coolingLeads,
    ] = await Promise.all([
      this.funnel(range),
      this.bySource(range),
      this.bySeller(range),
      this.lostReasons(range),
      // #569 — leads realocados por SLA estourado no período (visão do gerente)
      this.prisma.lead.count({
        where: {
          companyId: range.companyId,
          slaEscalatedAt: { gte: range.from, lte: range.to },
        },
      }),
      // #574 — leads que chegaram já em negociação em outra loja (canibalização)
      this.prisma.leadActivity.count({
        where: {
          lead: { companyId: range.companyId },
          happensAt: { gte: range.from, lte: range.to },
          properties: { path: ['kind'], equals: 'cross_store_duplicate' },
        },
      }),
      // #846 — ciclo médio lead→faturamento e leads esfriando (indicadores de ciclo)
      this.avgSalesCycle(range),
      this.coolingLeads(range, coolingDays),
    ]);
    return {
      range: { from: range.from, to: range.to },
      funnel,
      bySource,
      bySeller,
      lostReasons,
      slaEscalations,
      crossStoreDuplicates,
      avgSalesCycleDays,
      coolingLeads,
    };
  }

  /**
   * #846 — Ciclo médio lead→faturamento: média em dias de (OV.invoicedAt −
   * Lead.createdAt) para leads cuja OV vinculada faturou DENTRO do período.
   * null quando nenhum lead faturou no período.
   */
  private async avgSalesCycle(range: DashboardRange): Promise<number | null> {
    const leads = await this.prisma.lead.findMany({
      where: {
        companyId: range.companyId,
        salesOrder: {
          status: 'INVOICED',
          invoicedAt: { gte: range.from, lte: range.to },
        },
      },
      select: { createdAt: true, salesOrder: { select: { invoicedAt: true } } },
    });
    const spans = leads
      .map((l) => {
        const invoicedAt = l.salesOrder?.invoicedAt;
        return invoicedAt ? (invoicedAt.getTime() - l.createdAt.getTime()) / 86_400_000 : null;
      })
      .filter((d): d is number => d !== null && d >= 0);
    if (spans.length === 0) return null;
    return Math.round(spans.reduce((s, d) => s + d, 0) / spans.length);
  }

  /**
   * #846 — Leads esfriando: em estágio OPEN e sem toque há mais de `coolingDays`
   * dias (lastInteractionAt, fallback createdAt), agrupados por estágio. O campo
   * lastInteractionAt existe justamente pra isso e nunca era agregado.
   */
  private async coolingLeads(range: DashboardRange, coolingDays: number) {
    const openStages = await this.prisma.pipelineStage.findMany({
      where: { companyId: range.companyId, type: PipelineStageType.OPEN },
      select: { id: true, name: true },
    });
    if (openStages.length === 0) return [] as Array<{ stageId: string; stageName: string; count: number }>;
    const stageName = new Map(openStages.map((s) => [s.id, s.name]));
    const cutoff = new Date(range.to.getTime() - coolingDays * 24 * 60 * 60 * 1000);

    const leads = await this.prisma.lead.findMany({
      where: {
        companyId: range.companyId,
        stageId: { in: openStages.map((s) => s.id) },
        OR: [
          { lastInteractionAt: { lt: cutoff } },
          { lastInteractionAt: null, createdAt: { lt: cutoff } },
        ],
      },
      select: { stageId: true },
    });

    const counts = new Map<string, number>();
    for (const l of leads) {
      if (!l.stageId) continue;
      counts.set(l.stageId, (counts.get(l.stageId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([stageId, count]) => ({ stageId, stageName: stageName.get(stageId) ?? stageId, count }))
      .sort((a, b) => b.count - a.count);
  }

  /** Funil de conversão: leads criados → responderam → proposta+ → fechados */
  private async funnel(range: DashboardRange) {
    const stages = await this.prisma.pipelineStage.findMany({
      where: { companyId: range.companyId },
      select: { id: true, type: true, order: true },
    });
    const wonIds = stages.filter((s) => s.type === PipelineStageType.WON).map((s) => s.id);
    const lostIds = stages.filter((s) => s.type === PipelineStageType.LOST).map((s) => s.id);
    // "proposta+" = estágios abertos a partir do 3º (índice order>=2)
    const proposalPlusIds = stages
      .filter((s) => s.type === PipelineStageType.OPEN && s.order >= 2)
      .map((s) => s.id);

    const createdWhere: Prisma.LeadWhereInput = {
      companyId: range.companyId,
      createdAt: { gte: range.from, lte: range.to },
    };

    const [total, responded, reachedProposal, won, lost] = await Promise.all([
      this.prisma.lead.count({ where: createdWhere }),
      this.prisma.lead.count({ where: { ...createdWhere, firstRespondedAt: { not: null } } }),
      proposalPlusIds.length
        ? this.prisma.lead.count({ where: { ...createdWhere, stageId: { in: proposalPlusIds } } })
        : Promise.resolve(0),
      this.prisma.lead.count({ where: { ...createdWhere, stageId: { in: wonIds } } }),
      this.prisma.lead.count({ where: { ...createdWhere, stageId: { in: lostIds } } }),
    ]);

    const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
    return {
      total,
      responded,
      reachedProposal,
      won,
      lost,
      respondedRate: pct(responded),
      proposalRate: pct(reachedProposal),
      winRate: pct(won),
    };
  }

  /** Volume, conversão e RECEITA faturada por origem (Lead→OV→itens INVOICED) */
  private async bySource(range: DashboardRange) {
    const wonStageIds = (
      await this.prisma.pipelineStage.findMany({
        where: { companyId: range.companyId, type: PipelineStageType.WON },
        select: { id: true },
      })
    ).map((s) => s.id);

    const leads = await this.prisma.lead.findMany({
      where: { companyId: range.companyId, createdAt: { gte: range.from, lte: range.to } },
      select: {
        source: true,
        stageId: true,
        salesOrder: {
          select: {
            status: true,
            items: { select: { quantity: true, unitPrice: true } },
          },
        },
      },
    });

    const map = new Map<string, { total: number; won: number; revenue: number }>();
    for (const lead of leads) {
      const entry = map.get(lead.source) ?? { total: 0, won: 0, revenue: 0 };
      entry.total += 1;
      if (lead.stageId && wonStageIds.includes(lead.stageId)) entry.won += 1;
      if (lead.salesOrder?.status === 'INVOICED') {
        entry.revenue += lead.salesOrder.items.reduce(
          (sum, it) => sum + Number(it.quantity) * Number(it.unitPrice),
          0,
        );
      }
      map.set(lead.source, entry);
    }

    return Array.from(map.entries())
      .map(([source, v]) => ({
        source,
        total: v.total,
        won: v.won,
        conversionRate: v.total > 0 ? Math.round((v.won / v.total) * 1000) / 10 : 0,
        revenue: Math.round(v.revenue * 100) / 100,
      }))
      .sort((a, b) => b.revenue - a.revenue || b.total - a.total);
  }

  /** Ranking por vendedor: leads atendidos, tempo médio de 1ª resposta, fechamento */
  private async bySeller(range: DashboardRange) {
    const leads = await this.prisma.lead.findMany({
      where: {
        companyId: range.companyId,
        assignedToId: { not: null },
        createdAt: { gte: range.from, lte: range.to },
      },
      select: {
        assignedToId: true,
        createdAt: true,
        firstRespondedAt: true,
        stageId: true,
        assignedTo: { select: { name: true } },
      },
    });
    const wonStageIds = (
      await this.prisma.pipelineStage.findMany({
        where: { companyId: range.companyId, type: PipelineStageType.WON },
        select: { id: true },
      })
    ).map((s) => s.id);

    const map = new Map<
      string,
      { name: string; total: number; won: number; responseSum: number; respondedCount: number }
    >();
    for (const lead of leads) {
      const id = lead.assignedToId!;
      const entry =
        map.get(id) ?? { name: lead.assignedTo?.name ?? id, total: 0, won: 0, responseSum: 0, respondedCount: 0 };
      entry.total += 1;
      if (lead.stageId && wonStageIds.includes(lead.stageId)) entry.won += 1;
      if (lead.firstRespondedAt) {
        entry.responseSum += (lead.firstRespondedAt.getTime() - lead.createdAt.getTime()) / 60_000;
        entry.respondedCount += 1;
      }
      map.set(id, entry);
    }

    return Array.from(map.entries())
      .map(([userId, v]) => ({
        userId,
        name: v.name,
        leads: v.total,
        won: v.won,
        winRate: v.total > 0 ? Math.round((v.won / v.total) * 1000) / 10 : 0,
        avgFirstResponseMin:
          v.respondedCount > 0 ? Math.round(v.responseSum / v.respondedCount) : null,
      }))
      .sort((a, b) => b.won - a.won || b.leads - a.leads);
  }

  /**
   * Perdas por CATEGORIA (#570) + drill por vendedor e origem. Substitui a
   * antiga nuvem de texto livre (lostReason) por decisão acionável: 40%
   * "PRECO" numa loja = problema de pricing, não de vendedor. Leads antigos
   * sem categoria entram como `category: null` ("não categorizado" na UI).
   */
  private async lostReasons(range: DashboardRange) {
    const lostStageIds = (
      await this.prisma.pipelineStage.findMany({
        where: { companyId: range.companyId, type: PipelineStageType.LOST },
        select: { id: true },
      })
    ).map((s) => s.id);

    const lostWhere = {
      companyId: range.companyId,
      stageId: { in: lostStageIds },
      updatedAt: { gte: range.from, lte: range.to },
    };

    const [byCategory, bySellerRaw, bySource] = await Promise.all([
      this.prisma.lead.groupBy({ by: ['lostReasonCategory'], where: lostWhere, _count: { _all: true } }),
      this.prisma.lead.groupBy({
        by: ['assignedToId', 'lostReasonCategory'],
        where: lostWhere,
        _count: { _all: true },
      }),
      this.prisma.lead.groupBy({
        by: ['source', 'lostReasonCategory'],
        where: lostWhere,
        _count: { _all: true },
      }),
    ]);

    const sellerIds = [...new Set(bySellerRaw.map((g) => g.assignedToId).filter(Boolean))] as string[];
    const sellers = sellerIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: sellerIds } }, select: { id: true, name: true } })
      : [];
    const sellerName = new Map(sellers.map((s) => [s.id, s.name]));

    return {
      byCategory: byCategory
        .map((g) => ({ category: g.lostReasonCategory, count: g._count._all }))
        .sort((a, b) => b.count - a.count),
      bySeller: bySellerRaw.map((g) => ({
        sellerId: g.assignedToId,
        sellerName: g.assignedToId ? (sellerName.get(g.assignedToId) ?? '—') : 'Sem vendedor',
        category: g.lostReasonCategory,
        count: g._count._all,
      })),
      bySource: bySource.map((g) => ({
        source: g.source,
        category: g.lostReasonCategory,
        count: g._count._all,
      })),
    };
  }

  /** Export CSV da quebra por origem (botão do dashboard) */
  async sourceCsv(range: DashboardRange): Promise<string> {
    const rows = await this.bySource(range);
    const header = 'origem;leads;fechados;conversao_%;receita_faturada';
    const body = rows
      .map((r) => `${r.source};${r.total};${r.won};${r.conversionRate};${r.revenue.toFixed(2)}`)
      .join('\n');
    return `${header}\n${body}\n`;
  }
}
