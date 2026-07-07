import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LeadActivityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CrmSettingsService } from './crm-settings.service';
import { WhatsappService } from './whatsapp/whatsapp.service';
import { WhatsappTemplateService } from './whatsapp/template.service';

const AUTO_FOLLOWUP = 'AUTO_FOLLOWUP';

/**
 * F3.5-C4 (#554) — régua AUTOMÁTICA de follow-up (completa o #518, que ficou
 * só no envio manual). Varre leads parados num estágio-alvo e dispara 1 (um)
 * follow-up: janela aberta → mensagem livre; fechada → template aprovado.
 * Anti-spam: no máximo 1 automático por lead por estágio (marca na timeline).
 */
@Injectable()
export class FollowupScheduler {
  private readonly logger = new Logger(FollowupScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: CrmSettingsService,
    private readonly whatsapp: WhatsappService,
    private readonly templates: WhatsappTemplateService,
  ) {}

  /** A cada 30min, como os demais checks do ERP (AlertScheduler) */
  @Cron('*/30 * * * *', { name: 'crm-auto-followup' })
  async run(): Promise<void> {
    const companies = await this.prisma.company.findMany({ select: { id: true } });
    for (const company of companies) {
      try {
        await this.runForCompany(company.id);
      } catch (err) {
        this.logger.error(`Falha na régua de follow-up (company ${company.id}): ${(err as Error).message}`);
      }
    }
  }

  private async runForCompany(companyId: string): Promise<void> {
    const cfg = await this.settings.get(companyId);
    if (!cfg.autoFollowupEnabled || !cfg.autoFollowupStageId) return;

    const staleBefore = new Date(Date.now() - cfg.autoFollowupHours * 3600_000);
    const candidates = await this.prisma.lead.findMany({
      where: {
        companyId,
        stageId: cfg.autoFollowupStageId,
        lastInteractionAt: { lt: staleBefore },
      },
      select: {
        id: true,
        name: true,
        stageId: true,
        conversation: { select: { windowExpiresAt: true } },
      },
      take: 200, // teto de segurança por rodada
    });
    if (candidates.length === 0) return;

    for (const lead of candidates) {
      // anti-spam: já houve follow-up automático NESTE estágio?
      const already = await this.prisma.leadActivity.findFirst({
        where: {
          leadId: lead.id,
          actorId: AUTO_FOLLOWUP,
          type: { in: [LeadActivityType.MESSAGE_OUT, LeadActivityType.NOTE] },
        },
        orderBy: { happensAt: 'desc' },
      });
      // se o último follow-up automático foi no MESMO estágio, pula
      if (already && (already.properties as any)?.stageId === lead.stageId) continue;

      const windowOpen =
        !!lead.conversation?.windowExpiresAt &&
        lead.conversation.windowExpiresAt.getTime() > Date.now();

      try {
        if (windowOpen) {
          await this.whatsapp.send(
            companyId,
            lead.id,
            { text: this.freeText(lead.name) },
            AUTO_FOLLOWUP,
          );
        } else if (cfg.autoFollowupTemplate) {
          await this.templates.sendTemplate(
            companyId,
            lead.id,
            cfg.autoFollowupTemplate,
            this.templateVars(lead.name),
            AUTO_FOLLOWUP,
          );
        } else {
          continue; // janela fechada e sem template configurado → nada a fazer
        }

        // marca o disparo p/ o anti-spam (actorId sintético + stageId nas props)
        await this.prisma.leadActivity.create({
          data: {
            leadId: lead.id,
            type: LeadActivityType.NOTE,
            actorId: AUTO_FOLLOWUP,
            properties: { kind: 'auto_followup', stageId: lead.stageId, via: windowOpen ? 'free' : 'template' },
          },
        });
      } catch (err) {
        this.logger.warn(`Follow-up auto do lead ${lead.id} falhou: ${(err as Error).message}`);
      }
    }
    this.logger.log(`Régua de follow-up (company ${companyId}): ${candidates.length} candidatos varridos`);
  }

  private freeText(name: string | null): string {
    const nome = name?.split(' ')[0] ?? '';
    return `Oi${nome ? ` ${nome}` : ''}! Passando pra saber se você ainda tem interesse. Posso ajudar com alguma dúvida? 😊`;
  }

  private templateVars(name: string | null): string[] {
    // o template configurado deve ter no máx 1 variável (o nome); ajuste se usar mais
    return name ? [name.split(' ')[0]] : ['tudo bem'];
  }
}
