import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AlertSeverity,
  AlertType,
  LeadActivityType,
  PipelineStageType,
  SdrLeadStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../notification/push.service';
import { CrmSettingsService } from './crm-settings.service';
import { LeadIntakeService } from './lead-intake.service';
import { isWithinSdrWindow } from './sdr/sdr-guardrails';

/** actorId sintético das ações automáticas de SLA na timeline (padrão SDR_IA) */
export const SLA_ACTOR = 'SLA_BOT';

/**
 * CRM V2.2 (#569) — escalonamento automático de SLA. O painel (#516) mostra o
 * estouro; aqui a régua AGE: SLA x1 → push (#568) + alerta pro vendedor; SLA
 * x{factor} → realoca no rodízio (REUSA LeadIntakeService.reassign — mesmas
 * regras/eventos/timeline; o crm.lead.reassigned já faz o push pro novo dono)
 * e avisa o gerente. Cada nível dispara 1x por lead (slaWarnedAt/slaEscalatedAt).
 * Default OFF por loja (CRM_SLA_ESCALATION_ENABLED) — liga na tela de config.
 */
@Injectable()
export class SlaEscalationScheduler {
  private readonly logger = new Logger(SlaEscalationScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: CrmSettingsService,
    private readonly intake: LeadIntakeService,
    private readonly push: PushService,
  ) {}

  @Cron('*/2 * * * *', { name: 'crm-sla-escalation' })
  async run(): Promise<{ warned: number; escalated: number }> {
    const totals = { warned: 0, escalated: 0 };

    // só varre lojas que ligaram o escalonamento (default off)
    const enabled = await this.prisma.systemParameter.findMany({
      where: { key: 'CRM_SLA_ESCALATION_ENABLED', value: 'true' },
      select: { companyId: true },
    });

    for (const { companyId } of enabled) {
      try {
        const result = await this.runForCompany(companyId);
        totals.warned += result.warned;
        totals.escalated += result.escalated;
      } catch (err) {
        this.logger.warn(`escalonamento da company ${companyId} falhou: ${(err as Error).message}`);
      }
    }
    if (totals.warned + totals.escalated > 0) {
      this.logger.log(`SLA: ${totals.warned} aviso(s), ${totals.escalated} realocação(ões)`);
    }
    return totals;
  }

  async runForCompany(companyId: string): Promise<{ warned: number; escalated: number }> {
    const cfg = await this.settings.get(companyId);

    // loja com SDR OFF_HOURS: fora do expediente quem atende é a IA — não há
    // vendedor no balcão pra avisar/realocar; a régua volta a correr às 8h
    if (cfg.sdrSchedule === 'OFF_HOURS' && isWithinSdrWindow('OFF_HOURS')) {
      return { warned: 0, escalated: 0 };
    }

    const warnDeadline = new Date(Date.now() - cfg.slaFirstResponseMin * 60_000);
    const escalateDeadline = new Date(
      Date.now() - cfg.slaFirstResponseMin * cfg.slaEscalationFactor * 60_000,
    );

    const openStages = await this.prisma.pipelineStage.findMany({
      where: { companyId, type: PipelineStageType.OPEN },
      select: { id: true },
    });
    const openStageIds = openStages.map((s) => s.id);
    if (openStageIds.length === 0) return { warned: 0, escalated: 0 };

    // exclusões (#569): triagem da matriz (sem vendedor), SDR ativo, anonimizado
    const breaching = await this.prisma.lead.findMany({
      where: {
        companyId,
        stageId: { in: openStageIds },
        assignedToId: { not: null },
        firstRespondedAt: null,
        anonymizedAt: null,
        createdAt: { lt: warnDeadline },
        sdrStatus: { notIn: [SdrLeadStatus.ACTIVE, SdrLeadStatus.QUALIFIED] },
        slaEscalatedAt: null, // nível 2 é terminal — escalonado sai da varredura
      },
      take: 200,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        phone: true,
        createdAt: true,
        slaWarnedAt: true,
        slaEscalatedAt: true,
        assignedToId: true,
        assignedTo: { select: { id: true, name: true } },
      },
    });

    let warned = 0;
    let escalated = 0;
    for (const lead of breaching) {
      try {
        if (lead.createdAt < escalateDeadline && !lead.slaEscalatedAt) {
          await this.escalate(companyId, lead, cfg.slaFirstResponseMin * cfg.slaEscalationFactor);
          escalated++;
        } else if (lead.createdAt < warnDeadline && !lead.slaWarnedAt && !lead.slaEscalatedAt) {
          await this.warn(companyId, lead, cfg.slaFirstResponseMin);
          warned++;
        }
      } catch (err) {
        this.logger.warn(`escalonamento do lead ${lead.id} falhou: ${(err as Error).message}`);
      }
    }
    return { warned, escalated };
  }

  // ── nível 1: SLA x1 — avisa o dono (1x) ─────────────────────────────────────

  private async warn(
    companyId: string,
    lead: {
      id: string;
      name: string | null;
      phone: string | null;
      createdAt: Date;
      assignedToId: string | null;
      assignedTo: { name: string } | null;
    },
    slaMin: number,
  ): Promise<void> {
    const label = lead.name ?? lead.phone ?? 'lead';
    const waitingMin = Math.floor((Date.now() - lead.createdAt.getTime()) / 60_000);

    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        slaWarnedAt: new Date(),
        activities: {
          create: {
            type: LeadActivityType.NOTE,
            actorId: SLA_ACTOR,
            properties: {
              kind: 'sla_warning',
              slaMin,
              waitingMin,
              preview: `⏰ SLA estourado (${waitingMin}min sem resposta) — vendedor avisado`,
            },
          },
        },
      },
    });
    await this.prisma.alert.create({
      data: {
        companyId,
        type: AlertType.CRM_SLA_WARNING,
        severity: AlertSeverity.WARNING,
        title: `SLA estourado: ${label}`,
        body: `${lead.assignedTo?.name ?? 'Vendedor'} — ${waitingMin}min sem primeira resposta (SLA ${slaMin}min)`,
        entityId: lead.id,
        entityType: 'Lead',
      },
    });
    await this.push.sendToUser(lead.assignedToId!, {
      title: `⏰ SLA estourando: ${label}`,
      body: `${waitingMin}min sem resposta — responda agora ou o lead muda de vendedor`,
      url: `/app/crm/inbox?lead=${lead.id}`,
      tag: `sla-${lead.id}`,
    });
  }

  // ── nível 2: SLA x{factor} — realoca no rodízio (1x) ────────────────────────

  private async escalate(
    companyId: string,
    lead: {
      id: string;
      name: string | null;
      phone: string | null;
      createdAt: Date;
      assignedToId: string | null;
      assignedTo: { name: string } | null;
    },
    escalateMin: number,
  ): Promise<void> {
    const label = lead.name ?? lead.phone ?? 'lead';
    const loserName = lead.assignedTo?.name ?? 'sem vendedor';
    const nextSellerId = await this.intake.pickNextSeller(companyId, lead.assignedToId ?? undefined);

    // marca ANTES de realocar: mesmo sem substituto não repica a cada 2min
    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        slaEscalatedAt: new Date(),
        activities: {
          create: {
            type: LeadActivityType.NOTE,
            actorId: SLA_ACTOR,
            properties: {
              kind: 'sla_escalation',
              fromUserId: lead.assignedToId,
              toUserId: nextSellerId,
              preview: nextSellerId
                ? `🚨 SLA x2 (${escalateMin}min) — lead realocado no rodízio`
                : `🚨 SLA x2 (${escalateMin}min) — sem outro vendedor disponível p/ realocar`,
            },
          },
        },
      },
    });

    if (nextSellerId) {
      // REUSA a regra unitária: timeline ASSIGNMENT + evento crm.lead.reassigned
      // (que já dispara o push #568 pro novo dono)
      await this.intake.reassign(companyId, lead.id, nextSellerId, SLA_ACTOR);
    }

    await this.prisma.alert.create({
      data: {
        companyId,
        type: AlertType.CRM_SLA_ESCALATION,
        severity: AlertSeverity.CRITICAL,
        title: nextSellerId ? `Lead realocado por SLA: ${label}` : `SLA x2 sem realocação: ${label}`,
        body: nextSellerId
          ? `${loserName} não respondeu em ${escalateMin}min — lead foi pro próximo do rodízio`
          : `${loserName} não respondeu em ${escalateMin}min e não há outro vendedor disponível`,
        entityId: lead.id,
        entityType: 'Lead',
      },
    });
  }
}
