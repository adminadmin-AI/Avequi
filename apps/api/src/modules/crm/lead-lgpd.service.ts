import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CrmSettingsService } from './crm-settings.service';

/** Mesmo padrão do LgpdService: consts locais (enums não estão no mock do jest) */
const ConsentStatus = { ACTIVE: 'ACTIVE' as const, REVOKED: 'REVOKED' as const };
const AnonymizationStatus = { COMPLETED: 'COMPLETED' as const };

/** Base legal do contato comercial de lead (LGPD Art. 7º, IX) */
export const LEAD_LEGAL_BASIS =
  'Art. 7º, IX — legítimo interesse: contato comercial iniciado pelo titular (lead)';

/** actorId sintético do expurgo automático por retenção */
const LGPD_RETENTION = 'LGPD_RETENTION';

/**
 * F3.5-C8 (#558) — LGPD dos leads, plugado no módulo LGPD existente:
 * consentimento registrado na captação (listener de crm.lead.created),
 * anonimização a pedido do titular (apaga dado pessoal, preserva métricas)
 * e expurgo automático de leads perdidos antigos (retenção configurável).
 */
@Injectable()
export class LeadLgpdService {
  private readonly logger = new Logger(LeadLgpdService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: CrmSettingsService,
  ) {}

  // ── Base legal na captação ──────────────────────────────────────────────────

  /** Todo lead novo (via LeadIntakeService) ganha ConsentRecord com a base legal */
  @OnEvent('crm.lead.created', { async: true })
  async onLeadCreated(payload: { leadId: string; companyId: string; phone: string | null }) {
    if (!payload.phone) return; // sem telefone não há identificador do titular
    try {
      await this.prisma.consentRecord.create({
        data: {
          companyId: payload.companyId,
          subjectType: 'Lead',
          subjectId: payload.leadId,
          document: payload.phone, // titular de lead é identificado pelo telefone
          purpose: 'COMMERCIAL' as any,
          legalBasis: LEAD_LEGAL_BASIS,
        },
      });
    } catch (err) {
      // consent é trilha de auditoria — nunca pode derrubar a captação
      this.logger.error(`Consent do lead ${payload.leadId} falhou: ${(err as Error).message}`);
    }
  }

  // ── Direito do titular: anonimização ────────────────────────────────────────

  /**
   * Apaga o dado pessoal (nome/telefone/email/conversa/conteúdo da timeline) e
   * preserva o esqueleto agregado (source, stage, OV, timestamps) — o dashboard
   * de conversão continua íntegro. Irreversível.
   */
  async anonymizeLead(companyId: string, leadId: string, actorId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, companyId },
      select: { id: true, phone: true, anonymizedAt: true },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado nesta loja');
    if (lead.anonymizedAt) throw new BadRequestException('Lead já anonimizado');

    const suffix = randomBytes(6).toString('hex');
    const now = new Date();

    await this.prisma.$transaction([
      // dado pessoal do lead
      this.prisma.lead.update({
        where: { id: leadId },
        data: {
          name: `ANONIMIZADO_${suffix}`,
          phone: null,
          email: null,
          externalRef: null,
          sourceMeta: Prisma.DbNull, // metadados de campanha podem carregar dado pessoal
          anonymizedAt: now,
        },
      }),
      // conversa WhatsApp inteira (mensagens em cascade) — conteúdo é dado pessoal
      this.prisma.whatsappConversation.deleteMany({ where: { leadId, companyId } }),
      // timeline: mantém tipo/data (métricas de SLA/funil), apaga o conteúdo
      this.prisma.leadActivity.updateMany({
        where: { leadId },
        data: { properties: Prisma.DbNull },
      }),
      // lembretes pendentes podem citar o titular
      this.prisma.leadReminder.deleteMany({ where: { leadId, companyId } }),
      // revoga o consentimento registrado na captação
      this.prisma.consentRecord.updateMany({
        where: { companyId, subjectType: 'Lead', subjectId: leadId, status: ConsentStatus.ACTIVE as any },
        data: { status: ConsentStatus.REVOKED as any, revokedAt: now },
      }),
      // trilha no fluxo LGPD existente (mesma listagem do DPO)
      this.prisma.anonymizationRequest.create({
        data: {
          companyId,
          document: lead.phone ?? `lead:${leadId}`,
          status: AnonymizationStatus.COMPLETED as any,
          requestedById: actorId === LGPD_RETENTION ? null : actorId,
          processedAt: now,
          entitiesAffected: { leads: 1, via: actorId === LGPD_RETENTION ? 'retention' : 'request' },
        },
      }),
    ]);

    this.logger.log(`Lead ${leadId} anonimizado (${actorId})`);
    return { leadId, anonymizedAt: now };
  }

  // ── Retenção: expurgo de perdidos antigos ───────────────────────────────────

  /** Diário 03h: anonimiza leads PERDIDOS parados há mais que a retenção da loja */
  @Cron('0 3 * * *', { name: 'crm-lgpd-retention' })
  async purgeExpiredLostLeads(): Promise<number> {
    const companies = await this.prisma.company.findMany({ select: { id: true } });
    let total = 0;
    for (const company of companies) {
      try {
        total += await this.purgeForCompany(company.id);
      } catch (err) {
        this.logger.error(`Expurgo LGPD (company ${company.id}): ${(err as Error).message}`);
      }
    }
    if (total > 0) this.logger.log(`Expurgo LGPD: ${total} lead(s) perdidos anonimizados`);
    return total;
  }

  private async purgeForCompany(companyId: string): Promise<number> {
    const cfg = await this.settings.get(companyId);
    if (!cfg.leadRetentionDays || cfg.leadRetentionDays <= 0) return 0; // desligado

    const cutoff = new Date(Date.now() - cfg.leadRetentionDays * 24 * 3600_000);
    const expired = await this.prisma.lead.findMany({
      where: {
        companyId,
        anonymizedAt: null,
        stage: { type: 'LOST' as any },
        updatedAt: { lt: cutoff },
      },
      select: { id: true },
      take: 100, // teto por rodada — o cron diário drena o resto
    });

    let count = 0;
    for (const lead of expired) {
      try {
        await this.anonymizeLead(companyId, lead.id, LGPD_RETENTION);
        count++;
      } catch (err) {
        this.logger.warn(`Expurgo do lead ${lead.id} falhou: ${(err as Error).message}`);
      }
    }
    return count;
  }
}
