import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LeadActivityType, SdrLeadStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SDR_ACTOR } from './sdr.types';

/**
 * F4.4 (#524) — supervisão humana da IA: métricas, fila de revisão de
 * descartes e log de incidentes. Sem isso ninguém confia no SDR — com isso,
 * ele vira funcionário auditável.
 */
@Injectable()
export class SdrDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Métricas do período: atendidos, handoff, descarte, score, custo API */
  async overview(companyId: string, from: Date, to: Date) {
    const [attended, byStatus, usage, qualifications] = await Promise.all([
      // lead atendido = teve turno de IA no período (fonte: log de usage)
      this.prisma.sdrUsage.groupBy({
        by: ['leadId'],
        where: { companyId, createdAt: { gte: from, lte: to } },
      }),
      this.prisma.lead.groupBy({
        by: ['sdrStatus'],
        where: { companyId, sdrStatus: { not: null }, updatedAt: { gte: from, lte: to } },
        _count: { _all: true },
      }),
      this.prisma.sdrUsage.aggregate({
        where: { companyId, createdAt: { gte: from, lte: to } },
        _sum: { costUsd: true, inputTokens: true, outputTokens: true, cacheReadTokens: true },
        _count: { _all: true },
      }),
      // qualificações do período (score + tempo até qualificar)
      this.prisma.leadActivity.findMany({
        where: {
          lead: { companyId },
          actorId: SDR_ACTOR,
          happensAt: { gte: from, lte: to },
          properties: { path: ['kind'], equals: 'sdr_qualification' },
        },
        select: { happensAt: true, properties: true, lead: { select: { createdAt: true } } },
      }),
    ]);

    const statusCount = (s: SdrLeadStatus) =>
      byStatus.find((b) => b.sdrStatus === s)?._count._all ?? 0;

    const scores = qualifications
      .map((q) => Number((q.properties as any)?.score))
      .filter((n) => isFinite(n));
    const minutesToQualify = qualifications
      .map((q) => (q.happensAt.getTime() - q.lead.createdAt.getTime()) / 60_000)
      .filter((m) => m >= 0);

    const attendedCount = attended.length;
    const handoffs = statusCount(SdrLeadStatus.HANDOFF);
    const discards = statusCount(SdrLeadStatus.DISCARDED);
    const inProgress = statusCount(SdrLeadStatus.ACTIVE) + statusCount(SdrLeadStatus.QUALIFIED);

    // hit rate do prompt caching (critério #521: > 80% a partir da 2ª msg)
    const totalIn =
      (usage._sum.inputTokens ?? 0) + (usage._sum.cacheReadTokens ?? 0);
    const cacheHitRate = totalIn > 0 ? (usage._sum.cacheReadTokens ?? 0) / totalIn : 0;

    return {
      attended: attendedCount,
      inProgress,
      handoffs,
      handoffRate: attendedCount > 0 ? handoffs / attendedCount : 0,
      discards,
      discardRate: attendedCount > 0 ? discards / attendedCount : 0,
      qualified: qualifications.length,
      avgScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      avgMinutesToQualify: minutesToQualify.length
        ? minutesToQualify.reduce((a, b) => a + b, 0) / minutesToQualify.length
        : null,
      apiTurns: usage._count._all,
      costUsd: Number(usage._sum.costUsd ?? 0),
      cacheHitRate,
    };
  }

  /** Fila de revisão (#524): descartes da IA dos últimos 7 dias p/ auditoria */
  async discards(companyId: string) {
    return this.prisma.lead.findMany({
      where: {
        companyId,
        sdrStatus: SdrLeadStatus.DISCARDED,
        updatedAt: { gte: new Date(Date.now() - 7 * 24 * 3600_000) },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        name: true,
        phone: true,
        source: true,
        lostReason: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Reverter descarte (auditoria por amostragem): lead volta pro 1º estágio
   * aberto e pro vendedor — a reversão é feedback pro ajuste de prompt.
   */
  async revertDiscard(companyId: string, leadId: string, actorId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, companyId },
      select: { id: true, sdrStatus: true },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado nesta loja');
    if (lead.sdrStatus !== SdrLeadStatus.DISCARDED) {
      throw new BadRequestException('Lead não está descartado pela IA');
    }

    const firstOpen = await this.prisma.pipelineStage.findFirst({
      where: { companyId, type: 'OPEN' as any, isActive: true },
      orderBy: { order: 'asc' },
      select: { id: true },
    });

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        sdrStatus: SdrLeadStatus.HANDOFF, // volta pro humano, não pra IA
        stageId: firstOpen?.id,
        lostReason: null,
        lastInteractionAt: new Date(),
        activities: {
          create: {
            type: LeadActivityType.NOTE,
            actorId,
            properties: {
              kind: 'sdr_discard_reverted',
              preview: '↩️ descarte da IA revertido pelo gerente (feedback p/ ajuste de prompt)',
            },
          },
        },
      },
    });
    return { reverted: true };
  }

  /** Incidentes de guardrail (#523) visíveis no painel */
  async incidents(companyId: string, from: Date, to: Date) {
    return this.prisma.leadActivity.findMany({
      where: {
        lead: { companyId },
        actorId: SDR_ACTOR,
        happensAt: { gte: from, lte: to },
        properties: { path: ['kind'], equals: 'sdr_guardrail_incident' },
      },
      orderBy: { happensAt: 'desc' },
      take: 100,
      select: {
        id: true,
        happensAt: true,
        properties: true,
        lead: { select: { id: true, name: true, phone: true } },
      },
    });
  }
}
