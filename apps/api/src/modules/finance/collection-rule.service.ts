import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FinancialEntryStatus, FinancialEntryType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Régua de cobrança automática (#384, Wellington 5.2).
 *
 * Cron diário classifica cada recebível aberto pela faixa de atraso e executa
 * o estágio correspondente: registra CollectionAttempt (1× por entry+estágio,
 * dedup por marcador na note), bloqueia faturamento do cliente quando o
 * estágio manda (autoBlock → Customer.billingBlocked, #475) e sinaliza
 * escalonamento/jurídico na própria attempt.
 *
 * Envio real de e-mail/WhatsApp fica para a integração de mensageria (CRM
 * F1.2 tem WhatsApp Cloud API) — aqui fica o REGISTRO da régua, que é o que
 * o dashboard de cobrança e a auditoria consomem.
 */

export const DEFAULT_RULES = [
  { stage: 'PRE_DUE', daysFrom: -3, daysTo: -1, channels: ['EMAIL'], autoBlock: false, escalate: false },
  { stage: 'OVERDUE_7', daysFrom: 1, daysTo: 7, channels: ['EMAIL'], autoBlock: false, escalate: false },
  { stage: 'OVERDUE_30', daysFrom: 8, daysTo: 30, channels: ['EMAIL', 'WHATSAPP'], autoBlock: false, escalate: false },
  { stage: 'OVERDUE_60', daysFrom: 31, daysTo: 60, channels: ['EMAIL', 'WHATSAPP'], autoBlock: true, escalate: true },
  { stage: 'OVERDUE_90', daysFrom: 61, daysTo: 90, channels: ['PHONE'], autoBlock: true, escalate: true },
  { stage: 'LEGAL', daysFrom: 91, daysTo: 9999, channels: ['SYSTEM'], autoBlock: true, escalate: true },
];

const OPEN_STATUSES = [
  FinancialEntryStatus.OPEN,
  FinancialEntryStatus.OVERDUE,
  FinancialEntryStatus.PARTIALLY_PAID,
];

/** canais da régua → enum CollectionAttemptChannel */
function toChannel(c: string): 'EMAIL' | 'WHATSAPP' | 'PHONE' | 'OTHER' {
  return c === 'EMAIL' || c === 'WHATSAPP' || c === 'PHONE' ? c : 'OTHER';
}

@Injectable()
export class CollectionRuleService {
  private readonly logger = new Logger(CollectionRuleService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── CRUD ───────────────────────────────────────────────────────────────

  findAll(companyId: string) {
    return this.prisma.collectionRule.findMany({
      where: { companyId },
      orderBy: { daysFrom: 'asc' },
    });
  }

  /** Cria os 6 estágios padrão da régua (idempotente) */
  async seedDefaults(companyId: string) {
    let created = 0;
    for (const r of DEFAULT_RULES) {
      const exists = await this.prisma.collectionRule.findFirst({
        where: { companyId, stage: r.stage },
        select: { id: true },
      });
      if (exists) continue;
      await this.prisma.collectionRule.create({ data: { companyId, ...r } });
      created++;
    }
    return { created, total: DEFAULT_RULES.length };
  }

  async update(
    id: string,
    companyId: string,
    dto: Partial<{ daysFrom: number; daysTo: number; channels: string[]; autoBlock: boolean; escalate: boolean; isActive: boolean }>,
  ) {
    const rule = await this.prisma.collectionRule.findFirst({ where: { id, companyId } });
    if (!rule) throw new NotFoundException(`Regra de cobrança ${id} não encontrada`);
    return this.prisma.collectionRule.update({ where: { id }, data: dto });
  }

  // ─── Motor da régua ─────────────────────────────────────────────────────

  /** Roda diariamente às 7h (após o markOverdue das 8h ser irrelevante — classificamos por dueDate) */
  @Cron('0 7 * * *', { name: 'collection-ruler-daily' })
  async runAllCompanies() {
    const companies = await this.prisma.collectionRule.findMany({
      where: { isActive: true },
      select: { companyId: true },
      distinct: ['companyId'],
    });
    for (const c of companies) {
      try {
        const result = await this.run(c.companyId);
        this.logger.log(
          `Régua ${c.companyId}: ${result.attempts} cobranças registradas, ${result.blocked} clientes bloqueados`,
        );
      } catch (err) {
        this.logger.error(`Régua falhou para ${c.companyId}: ${(err as Error).message}`);
      }
    }
  }

  /** Executa a régua de uma empresa; retorna o resumo do processamento */
  async run(companyId: string) {
    const rules = await this.prisma.collectionRule.findMany({
      where: { companyId, isActive: true },
    });
    if (rules.length === 0) return { attempts: 0, blocked: 0, evaluated: 0 };

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const minFrom = Math.min(...rules.map((r) => r.daysFrom));
    // só interessa quem está dentro do alcance da régua (inclui pré-vencimento)
    const maxDue = new Date(hoje.getTime() - minFrom * 86_400_000);

    const entries = await this.prisma.financialEntry.findMany({
      where: {
        companyId,
        type: FinancialEntryType.RECEIVABLE,
        status: { in: OPEN_STATUSES },
        dueDate: { lte: maxDue },
      },
      select: {
        id: true,
        amount: true,
        dueDate: true,
        description: true,
        salesOrder: { select: { customerId: true, customer: { select: { name: true, billingBlocked: true } } } },
      },
    });

    let attempts = 0;
    let blocked = 0;

    for (const e of entries) {
      const diasAtraso = Math.floor((hoje.getTime() - new Date(e.dueDate).setHours(0, 0, 0, 0)) / 86_400_000);
      const rule = rules.find((r) => diasAtraso >= r.daysFrom && diasAtraso <= r.daysTo);
      if (!rule) continue;

      // dedup: 1 registro por entry+estágio
      const marker = `[REGUA:${rule.stage}]`;
      const jaRegistrada = await this.prisma.collectionAttempt.findFirst({
        where: { companyId, financialEntryId: e.id, note: { startsWith: marker } },
        select: { id: true },
      });
      if (jaRegistrada) continue;

      const cliente = e.salesOrder?.customer?.name ?? 'cliente sem OV';
      await this.prisma.collectionAttempt.create({
        data: {
          companyId,
          financialEntryId: e.id,
          channel: toChannel(rule.channels[0] ?? 'SYSTEM') as any,
          note:
            `${marker} ${diasAtraso >= 0 ? `${diasAtraso}d de atraso` : `vence em ${-diasAtraso}d`} — ` +
            `R$ ${Number(e.amount).toFixed(2)} (${cliente})` +
            (rule.escalate ? ' · ESCALONADO' : '') +
            (rule.stage === 'LEGAL' ? ' · ENCAMINHAR AO JURÍDICO' : '') +
            ` · canais: ${rule.channels.join(', ')}`,
        },
      });
      attempts++;

      // autoBlock: bloqueia faturamento do cliente (#475) com motivo rastreável
      const customerId = e.salesOrder?.customerId;
      if (rule.autoBlock && customerId && !e.salesOrder?.customer?.billingBlocked) {
        await this.prisma.customer.update({
          where: { id: customerId },
          data: {
            billingBlocked: true,
            billingBlockReason: `Régua de cobrança ${rule.stage}: título de R$ ${Number(e.amount).toFixed(2)} com ${diasAtraso}d de atraso`,
          },
        });
        blocked++;
      }
    }

    return { attempts, blocked, evaluated: entries.length };
  }
}
