import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { AlertSeverity, AlertType, LeadActivityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const MANAGER_ROLES = ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER'];

export interface ReminderActor {
  id: string;
  companyId: string;
  role: string;
}

/**
 * F3.5-C5 (#555) — notas manuais e lembretes de follow-up. Nota vira
 * LeadActivity NOTE na timeline (junto com as automáticas); lembrete é
 * LeadReminder por vendedor, com cron que gera Alert no vencimento.
 */
@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── Notas ───────────────────────────────────────────────────────────────────

  async addNote(actor: ReminderActor, leadId: string, text: string) {
    const body = text?.trim();
    if (!body) throw new BadRequestException('Texto da nota é obrigatório');
    await this.assertLead(actor.companyId, leadId);

    const [activity] = await Promise.all([
      this.prisma.leadActivity.create({
        data: {
          leadId,
          type: LeadActivityType.NOTE,
          actorId: actor.id,
          properties: { text: body, preview: body.slice(0, 120) },
        },
      }),
      this.prisma.lead.update({
        where: { id: leadId },
        data: { lastInteractionAt: new Date() },
      }),
    ]);
    return activity;
  }

  // ── Lembretes ───────────────────────────────────────────────────────────────

  async createReminder(actor: ReminderActor, leadId: string, input: { text: string; dueAt: string }) {
    const text = input.text?.trim();
    if (!text) throw new BadRequestException('Texto do lembrete é obrigatório');
    const dueAt = new Date(input.dueAt);
    if (isNaN(dueAt.getTime())) throw new BadRequestException('Data do lembrete inválida');
    if (dueAt.getTime() <= Date.now()) {
      throw new BadRequestException('O lembrete precisa ser no futuro');
    }
    await this.assertLead(actor.companyId, leadId);

    return this.prisma.leadReminder.create({
      data: { companyId: actor.companyId, leadId, userId: actor.id, text, dueAt },
    });
  }

  /** Lembretes pendentes do lead (painel) — todos os vendedores da loja veem */
  async listByLead(actor: ReminderActor, leadId: string) {
    await this.assertLead(actor.companyId, leadId);
    return this.prisma.leadReminder.findMany({
      where: { companyId: actor.companyId, leadId, doneAt: null },
      orderBy: { dueAt: 'asc' },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  /** "Meus lembretes" do inbox: pendentes do vendedor, vencidos primeiro */
  async listMine(actor: ReminderActor) {
    return this.prisma.leadReminder.findMany({
      where: { companyId: actor.companyId, userId: actor.id, doneAt: null },
      orderBy: { dueAt: 'asc' },
      take: 100,
      include: { lead: { select: { id: true, name: true, phone: true } } },
    });
  }

  async markDone(actor: ReminderActor, id: string) {
    await this.findOwned(actor, id);
    return this.prisma.leadReminder.update({
      where: { id },
      data: { doneAt: new Date() },
    });
  }

  async remove(actor: ReminderActor, id: string) {
    await this.findOwned(actor, id);
    await this.prisma.leadReminder.delete({ where: { id } });
    return { deleted: true };
  }

  // ── Cron: alerta no vencimento ──────────────────────────────────────────────

  /** A cada 5min: lembrete vencido e não notificado → Alert in-app (sino) */
  @Cron('*/5 * * * *', { name: 'crm-reminders-due' })
  async notifyDue(): Promise<number> {
    const due = await this.prisma.leadReminder.findMany({
      where: { doneAt: null, notifiedAt: null, dueAt: { lte: new Date() } },
      take: 200,
      include: {
        lead: { select: { name: true, phone: true } },
        user: { select: { name: true } },
      },
    });

    for (const r of due) {
      const leadLabel = r.lead.name ?? r.lead.phone ?? 'lead';
      try {
        await this.prisma.alert.create({
          data: {
            companyId: r.companyId,
            type: AlertType.CRM_REMINDER_DUE,
            severity: AlertSeverity.INFO,
            title: `Lembrete: ${r.text}`,
            body: `${r.user.name} — lead ${leadLabel}`,
            entityId: r.leadId,
            entityType: 'Lead',
          },
        });
        await this.prisma.leadReminder.update({
          where: { id: r.id },
          data: { notifiedAt: new Date() },
        });
        // web push no celular do dono do lembrete (#568)
        this.eventEmitter.emit('crm.reminder.due', {
          reminderId: r.id,
          companyId: r.companyId,
          userId: r.userId,
          leadId: r.leadId,
          text: r.text,
          leadLabel,
        });
      } catch (err) {
        this.logger.warn(`Alerta do lembrete ${r.id} falhou: ${(err as Error).message}`);
      }
    }
    if (due.length > 0) this.logger.log(`${due.length} lembrete(s) de CRM alertado(s)`);
    return due.length;
  }

  // ── internos ────────────────────────────────────────────────────────────────

  private async assertLead(companyId: string, leadId: string): Promise<void> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, companyId },
      select: { id: true },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado nesta loja');
  }

  /** Dono do lembrete ou gerente da loja */
  private async findOwned(actor: ReminderActor, id: string) {
    const reminder = await this.prisma.leadReminder.findFirst({
      where: { id, companyId: actor.companyId },
    });
    if (!reminder) throw new NotFoundException('Lembrete não encontrado');
    if (reminder.userId !== actor.id && !MANAGER_ROLES.includes(actor.role)) {
      throw new NotFoundException('Lembrete não encontrado'); // não vaza existência
    }
    return reminder;
  }
}
