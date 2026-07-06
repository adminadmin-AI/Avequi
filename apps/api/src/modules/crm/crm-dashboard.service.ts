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

  async overview(range: DashboardRange) {
    const [funnel, bySource, bySeller, lostReasons] = await Promise.all([
      this.funnel(range),
      this.bySource(range),
      this.bySeller(range),
      this.lostReasons(range),
    ]);
    return { range: { from: range.from, to: range.to }, funnel, bySource, bySeller, lostReasons };
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

  private async lostReasons(range: DashboardRange) {
    const lostStageIds = (
      await this.prisma.pipelineStage.findMany({
        where: { companyId: range.companyId, type: PipelineStageType.LOST },
        select: { id: true },
      })
    ).map((s) => s.id);

    const grouped = await this.prisma.lead.groupBy({
      by: ['lostReason'],
      where: {
        companyId: range.companyId,
        stageId: { in: lostStageIds },
        lostReason: { not: null },
        updatedAt: { gte: range.from, lte: range.to },
      },
      _count: { _all: true },
    });
    return grouped
      .map((g) => ({ reason: g.lostReason, count: g._count._all }))
      .sort((a, b) => b.count - a.count);
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
