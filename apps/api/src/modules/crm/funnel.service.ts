import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LeadActivityType, PipelineStageType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface BoardFilters {
  companyId: string;
  /** só leads do usuário */
  assignedToId?: string;
  source?: string;
}

/** Gap padrão entre posições — permite ~muitas inserções antes de precisar rebalancear */
const POSITION_GAP = 1000;

/**
 * F2.1 (#514) / F2.3 (#516) — funil: board kanban por loja com drag&drop
 * (position Decimal, padrão Twenty) e métricas de SLA de primeira resposta.
 */
@Injectable()
export class FunnelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Board completo: estágios + leads ordenados por position em cada coluna */
  async board(filters: BoardFilters) {
    const [stages, leads] = await Promise.all([
      this.prisma.pipelineStage.findMany({
        where: { companyId: filters.companyId, isActive: true },
        orderBy: { order: 'asc' },
        select: { id: true, name: true, color: true, type: true, order: true },
      }),
      this.prisma.lead.findMany({
        where: {
          companyId: filters.companyId,
          ...(filters.assignedToId ? { assignedToId: filters.assignedToId } : {}),
          ...(filters.source ? { source: filters.source as any } : {}),
        },
        orderBy: [{ stageId: 'asc' }, { position: 'asc' }],
        select: {
          id: true,
          name: true,
          phone: true,
          source: true,
          interest: true,
          estimatedValue: true,
          stageId: true,
          position: true,
          assignedTo: { select: { id: true, name: true } },
          lastInteractionAt: true,
          conversation: { select: { unreadCount: true, windowExpiresAt: true } },
        },
      }),
    ]);

    const byStage = new Map<string, typeof leads>();
    const noStage: typeof leads = [];
    for (const lead of leads) {
      if (!lead.stageId) {
        noStage.push(lead);
        continue;
      }
      const arr = byStage.get(lead.stageId) ?? [];
      arr.push(lead);
      byStage.set(lead.stageId, arr);
    }

    const now = Date.now();
    const decorate = (l: (typeof leads)[number]) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      source: l.source,
      interest: l.interest,
      estimatedValue: l.estimatedValue,
      position: l.position,
      assignedTo: l.assignedTo,
      lastInteractionAt: l.lastInteractionAt,
      unreadCount: l.conversation?.unreadCount ?? 0,
      windowOpen:
        !!l.conversation?.windowExpiresAt &&
        l.conversation.windowExpiresAt.getTime() > now,
    });

    return {
      columns: stages.map((s) => {
        const items = (byStage.get(s.id) ?? []).map(decorate);
        return {
          stage: s,
          leads: items,
          count: items.length,
          totalValue: items.reduce((sum, l) => sum + Number(l.estimatedValue ?? 0), 0),
        };
      }),
      unstaged: noStage.map(decorate),
    };
  }

  /**
   * Move lead no kanban: novo estágio e/ou nova posição entre dois vizinhos.
   * A posição vira a média entre beforeId e afterId (padrão Twenty) — sem
   * reindexar a coluna. Perdido exige motivo.
   */
  async moveLead(
    companyId: string,
    leadId: string,
    input: { stageId: string; beforeLeadId?: string; afterLeadId?: string; lostReason?: string },
    actorId: string,
  ) {
    const [lead, stage] = await Promise.all([
      this.prisma.lead.findFirst({
        where: { id: leadId, companyId },
        select: { id: true, stageId: true },
      }),
      this.prisma.pipelineStage.findFirst({
        where: { id: input.stageId, companyId, isActive: true },
      }),
    ]);
    if (!lead) throw new NotFoundException('Lead não encontrado');
    if (!stage) throw new BadRequestException('Estágio inválido para esta loja');
    if (stage.type === PipelineStageType.LOST && !input.lostReason?.trim()) {
      throw new BadRequestException('Mover para Perdido exige o motivo da perda');
    }

    const position = await this.computePosition(
      companyId,
      stage.id,
      input.beforeLeadId,
      input.afterLeadId,
    );
    const stageChanged = lead.stageId !== stage.id;

    const updated = await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        stageId: stage.id,
        position,
        lastInteractionAt: new Date(),
        ...(stage.type === PipelineStageType.LOST
          ? { lostReason: input.lostReason!.trim() }
          : { lostReason: null }),
        ...(stageChanged
          ? {
              activities: {
                create: {
                  type: LeadActivityType.STAGE_CHANGE,
                  actorId,
                  properties: {
                    from: lead.stageId,
                    to: stage.id,
                    toName: stage.name,
                    ...(stage.type === PipelineStageType.LOST
                      ? { lostReason: input.lostReason!.trim() }
                      : {}),
                  },
                },
              },
            }
          : {}),
      },
      select: { id: true, stageId: true, position: true },
    });

    if (stageChanged) {
      this.eventEmitter.emit('crm.lead.stage_changed', {
        leadId: lead.id,
        companyId,
        fromStageId: lead.stageId,
        toStageId: stage.id,
        stageType: stage.type,
      });
    }
    return updated;
  }

  /** Motivos de perda agregados (dashboard F3.1 e visão do gerente) */
  async lostReasons(companyId: string, since?: Date) {
    const lostStages = await this.prisma.pipelineStage.findMany({
      where: { companyId, type: PipelineStageType.LOST },
      select: { id: true },
    });
    const grouped = await this.prisma.lead.groupBy({
      by: ['lostReason'],
      where: {
        companyId,
        stageId: { in: lostStages.map((s) => s.id) },
        lostReason: { not: null },
        ...(since ? { updatedAt: { gte: since } } : {}),
      },
      _count: { _all: true },
    });
    return grouped
      .map((g) => ({ reason: g.lostReason, count: g._count._all }))
      .sort((a, b) => b.count - a.count);
  }

  // ── SLA de primeira resposta (F2.3 #516) ────────────────────────────────────

  /** Config de SLA da loja (minutos). Default 15. */
  private async slaMinutes(companyId: string): Promise<number> {
    const param = await this.prisma.systemParameter.findFirst({
      where: { companyId, key: 'CRM_SLA_FIRST_RESPONSE_MIN' },
    });
    const n = param ? parseInt(param.value, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 15;
  }

  /** Config de "esfriando" (horas sem interação em estágio aberto). Default 24. */
  private async coolingHours(companyId: string): Promise<number> {
    const param = await this.prisma.systemParameter.findFirst({
      where: { companyId, key: 'CRM_COOLING_HOURS' },
    });
    const n = param ? parseInt(param.value, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 24;
  }

  /**
   * Painel de SLA: leads sem 1ª resposta dentro do prazo (estourando) e
   * leads abertos esfriando (sem interação há X horas).
   */
  async slaPanel(companyId: string, scopeUserId?: string) {
    const [slaMin, coolHours] = await Promise.all([
      this.slaMinutes(companyId),
      this.coolingHours(companyId),
    ]);
    const openStages = await this.prisma.pipelineStage.findMany({
      where: { companyId, type: PipelineStageType.OPEN },
      select: { id: true },
    });
    const openStageIds = openStages.map((s) => s.id);
    const slaDeadline = new Date(Date.now() - slaMin * 60_000);
    const coolDeadline = new Date(Date.now() - coolHours * 3600_000);
    const assignFilter = scopeUserId ? { assignedToId: scopeUserId } : {};

    const [breaching, cooling] = await Promise.all([
      // sem primeira resposta e criado antes do prazo do SLA
      this.prisma.lead.findMany({
        where: {
          companyId,
          firstRespondedAt: null,
          createdAt: { lt: slaDeadline },
          stageId: { in: openStageIds },
          ...assignFilter,
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
        select: {
          id: true,
          name: true,
          phone: true,
          source: true,
          createdAt: true,
          slaWarnedAt: true,
          slaEscalatedAt: true, // #569 — coluna "escalonado" no painel
          assignedTo: { select: { id: true, name: true } },
        },
      }),
      // já respondido, mas parado há X horas em estágio aberto
      this.prisma.lead.findMany({
        where: {
          companyId,
          firstRespondedAt: { not: null },
          lastInteractionAt: { lt: coolDeadline },
          stageId: { in: openStageIds },
          ...assignFilter,
        },
        orderBy: { lastInteractionAt: 'asc' },
        take: 100,
        select: {
          id: true,
          name: true,
          phone: true,
          source: true,
          lastInteractionAt: true,
          stage: { select: { name: true } },
          assignedTo: { select: { id: true, name: true } },
        },
      }),
    ]);

    return {
      slaMinutes: slaMin,
      coolingHours: coolHours,
      breaching: breaching.map((l) => ({
        ...l,
        waitingMinutes: Math.floor((Date.now() - l.createdAt.getTime()) / 60_000),
      })),
      cooling: cooling.map((l) => ({
        ...l,
        idleHours: l.lastInteractionAt
          ? Math.floor((Date.now() - l.lastInteractionAt.getTime()) / 3600_000)
          : null,
      })),
    };
  }

  /** Posição entre dois vizinhos (média); ponta usa gap fixo. */
  private async computePosition(
    companyId: string,
    stageId: string,
    beforeLeadId?: string,
    afterLeadId?: string,
  ): Promise<Prisma.Decimal> {
    const pos = async (id?: string): Promise<Prisma.Decimal | null> => {
      if (!id) return null;
      const l = await this.prisma.lead.findFirst({
        where: { id, companyId, stageId },
        select: { position: true },
      });
      return l?.position ?? null;
    };
    const before = await pos(beforeLeadId); // lead que fica ACIMA (posição menor)
    const after = await pos(afterLeadId); // lead que fica ABAIXO (posição maior)

    if (before && after) return before.plus(after).dividedBy(2);
    if (before && !after) return before.plus(POSITION_GAP); // fim da coluna
    if (!before && after) return after.minus(POSITION_GAP); // topo da coluna
    // coluna vazia: próxima posição após o maior atual
    const max = await this.prisma.lead.aggregate({
      where: { companyId, stageId },
      _max: { position: true },
    });
    return new Prisma.Decimal(max._max.position ?? new Prisma.Decimal(0)).plus(POSITION_GAP);
  }
}
