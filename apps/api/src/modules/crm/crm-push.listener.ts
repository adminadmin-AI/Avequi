import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { SdrLeadStatus, WaMessageDirection } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../notification/push.service';

/** minutos sem resposta do vendedor antes do push de cutucada (#568) */
const UNANSWERED_MIN = 2;

/**
 * CRM V2.1 (#568) — disparos de web push em cima dos eventos que o CRM já emite.
 * Push é best-effort: todo handler engole erro pra nunca quebrar captação/cron.
 */
@Injectable()
export class CrmPushListener {
  private readonly logger = new Logger(CrmPushListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  // ── lead novo do rodízio ────────────────────────────────────────────────────

  @OnEvent('crm.lead.created', { async: true })
  async onLeadCreated(event: { leadId: string; assignedToId: string | null }) {
    if (!event.assignedToId) return; // triagem da matriz: sem dono, sem push
    try {
      const lead = await this.leadLabel(event.leadId);
      await this.push.sendToUser(event.assignedToId, {
        title: `🔥 Novo lead: ${lead.label}`,
        body: lead.detail ?? 'Chegou pra você pelo rodízio — responda rápido!',
        url: `/app/crm/inbox?lead=${event.leadId}`,
        tag: `lead-${event.leadId}`,
      });
    } catch (err) {
      this.logger.warn(`push lead.created falhou: ${(err as Error).message}`);
    }
  }

  @OnEvent('crm.lead.reassigned', { async: true })
  async onLeadReassigned(event: { leadId: string; toUserId: string }) {
    try {
      const lead = await this.leadLabel(event.leadId);
      await this.push.sendToUser(event.toUserId, {
        title: `Lead transferido pra você: ${lead.label}`,
        body: lead.detail ?? 'Um lead foi reatribuído pra você.',
        url: `/app/crm/inbox?lead=${event.leadId}`,
        tag: `lead-${event.leadId}`,
      });
    } catch (err) {
      this.logger.warn(`push lead.reassigned falhou: ${(err as Error).message}`);
    }
  }

  // ── handoff do SDR IA (lead quente) ─────────────────────────────────────────

  @OnEvent('crm.sdr.handoff', { async: true })
  async onSdrHandoff(event: { leadId: string; toUserId: string | null; motivo: string }) {
    if (!event.toUserId) return;
    try {
      const lead = await this.leadLabel(event.leadId);
      await this.push.sendToUser(event.toUserId, {
        title: `🤖 Lead quente da IA: ${lead.label}`,
        body: event.motivo.slice(0, 180),
        url: `/app/crm/inbox?lead=${event.leadId}`,
        tag: `lead-${event.leadId}`,
      });
    } catch (err) {
      this.logger.warn(`push sdr.handoff falhou: ${(err as Error).message}`);
    }
  }

  // ── lembrete vencido (cron do #555 emite o evento) ──────────────────────────

  @OnEvent('crm.reminder.due', { async: true })
  async onReminderDue(event: { leadId: string; userId: string; text: string; leadLabel: string }) {
    try {
      await this.push.sendToUser(event.userId, {
        title: `⏰ Lembrete: ${event.text.slice(0, 120)}`,
        body: `Lead ${event.leadLabel}`,
        url: `/app/crm/inbox?lead=${event.leadId}`,
        tag: `reminder-${event.leadId}`,
      });
    } catch (err) {
      this.logger.warn(`push reminder.due falhou: ${(err as Error).message}`);
    }
  }

  // ── cliente sem resposta há > 2min ──────────────────────────────────────────

  /**
   * Cutucada de speed-to-lead: cliente mandou mensagem, vendedor não respondeu em
   * 2min → 1 push por janela de não-resposta (pushNudgedAt >= 1ª msg pendente = já
   * avisado; vendedor respondendo abre janela nova). SDR ativo não cutuca — a IA
   * responde em segundos e o handoff dela já tem push próprio.
   */
  @Cron(`*/${UNANSWERED_MIN} * * * *`, { name: 'crm-push-unanswered' })
  async nudgeUnanswered(): Promise<number> {
    if (!this.push.isEnabled) return 0;
    const cutoff = new Date(Date.now() - UNANSWERED_MIN * 60_000);

    // tenant-lint: ok (cron de push: varre conversas de TODOS os tenants por design; só dispara notificação ao dono da conversa)
    const candidates = await this.prisma.whatsappConversation.findMany({
      where: {
        lastCustomerMessageAt: { not: null, lte: cutoff },
        lead: {
          assignedToId: { not: null },
          anonymizedAt: null,
          sdrStatus: { notIn: [SdrLeadStatus.ACTIVE, SdrLeadStatus.QUALIFIED] },
        },
      },
      take: 100,
      include: {
        lead: { select: { id: true, name: true, phone: true, assignedToId: true } },
      },
    });

    let nudged = 0;
    for (const conv of candidates) {
      try {
        const lastOut = await this.prisma.whatsappMessage.findFirst({
          where: { conversationId: conv.id, direction: WaMessageDirection.OUT },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        // 1ª mensagem do cliente ainda sem resposta — âncora da janela de não-resposta
        const firstPending = await this.prisma.whatsappMessage.findFirst({
          where: {
            conversationId: conv.id,
            direction: WaMessageDirection.IN,
            ...(lastOut ? { createdAt: { gt: lastOut.createdAt } } : {}),
          },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true, text: true },
        });
        if (!firstPending) continue; // vendedor já respondeu
        if (firstPending.createdAt > cutoff) continue; // ainda dentro dos 2min
        if (conv.pushNudgedAt && conv.pushNudgedAt >= firstPending.createdAt) continue; // já avisado nesta janela

        const label = conv.lead.name ?? conv.lead.phone ?? 'lead';
        await this.push.sendToUser(conv.lead.assignedToId!, {
          title: `💬 ${label} está esperando resposta`,
          body: (firstPending.text ?? 'Nova mensagem').slice(0, 140),
          url: `/app/crm/inbox?lead=${conv.lead.id}`,
          tag: `unanswered-${conv.id}`,
        });
        // tenant-lint: ok (cron de push: update de flag na conversa resolvida pelo próprio job)
        await this.prisma.whatsappConversation.update({
          where: { id: conv.id },
          data: { pushNudgedAt: new Date() },
        });
        nudged++;
      } catch (err) {
        this.logger.warn(`cutucada da conversa ${conv.id} falhou: ${(err as Error).message}`);
      }
    }
    if (nudged > 0) this.logger.log(`${nudged} vendedor(es) cutucado(s) por cliente sem resposta`);
    return nudged;
  }

  // ── internos ────────────────────────────────────────────────────────────────

  private async leadLabel(leadId: string): Promise<{ label: string; detail: string | null }> {
    // tenant-lint: ok (cron de push: lead resolvido a partir da conversa do próprio job)
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { name: true, phone: true, interest: true, source: true },
    });
    if (!lead) return { label: 'lead', detail: null };
    // payload mínimo (LGPD): nome/telefone + interesse — nada além do necessário
    const label = lead.name ?? lead.phone ?? 'lead';
    const detail = [lead.interest, lead.source ? `via ${lead.source}` : null]
      .filter(Boolean)
      .join(' — ');
    return { label, detail: detail || null };
  }
}
