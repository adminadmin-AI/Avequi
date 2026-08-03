import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AuditAction,
  InvoiceStatus,
  TenantStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../iam/audit.service';
import { MailService } from '../mail/mail.service';
import { OpsActionContext } from './ops.service';

/**
 * BillingService — OPS WP5 (#912): billing da operadora, Fase 1.
 *
 * F1 = CONTRATO + RÉGUA, não gateway: a fatura nasce sozinha (cron), a baixa
 * é MANUAL e auditada, e a inadimplência segue a régua
 *   D+3  → e-mail de aviso ao tenant (UMA vez — notifiedAt)
 *   D+10 → banner persistente no app do cliente (GET /billing/me/status)
 *   D+20 → proposta de suspensão no PORTAL (alerta) — suspender é SEMPRE
 *          ação explícita do operador (WP1), nunca automática.
 *
 * Idempotência por construção: fatura única por (tenant, competência) via
 * unique no banco; reprocessar o dia não duplica nada. SANDBOX nunca fatura;
 * CHURNED não gera fatura nova (as antigas continuam cobráveis).
 */

export const DUNNING = {
  EMAIL_DIAS: 3,
  BANNER_DIAS: 10,
  SUSPENSAO_DIAS: 20,
} as const;

export const INVOICE_METHODS = ['PIX', 'BOLETO', 'TRANSFER', 'OUTRO'] as const;

/** Primeiro dia do mês (UTC) — a "competência" da fatura. */
export function periodOf(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Vencimento da competência: billingDay (1–28) dentro do próprio mês. */
export function dueDateOf(period: Date, billingDay: number): Date {
  return new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth(), billingDay));
}

function daysPast(due: Date, now: Date): number {
  return Math.floor((now.getTime() - due.getTime()) / (24 * 3600 * 1000));
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
  ) {}

  // ─── Cron diário ───────────────────────────────────────────────────────────

  /** 04:30 — gera faturas da competência corrente e roda a régua. */
  @Cron('30 4 * * *', { name: 'ops-billing-daily' })
  async runDaily(): Promise<void> {
    try {
      await this.generateInvoices(new Date());
      await this.runDunning(new Date());
    } catch (err) {
      // Cron nunca derruba o app; recuperável via POST /ops/billing/run.
      this.logger.error(
        `Billing diário falhou (recuperável via /ops/billing/run): ${(err as Error).message}`,
      );
    }
  }

  /**
   * Gera a fatura da competência CORRENTE para cada assinatura ativa.
   * Idempotente: a unique (companyId, period) segura reexecução; o skip por
   * consulta prévia é só economia de round-trip.
   */
  async generateInvoices(now: Date): Promise<number> {
    const period = periodOf(now);
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        canceledAt: null,
        startedAt: { lt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) },
        company: {
          isSandbox: false,
          tenantStatus: { notIn: [TenantStatus.CHURNED] },
        },
      },
      select: { companyId: true, priceCents: true, billingDay: true },
    });

    let created = 0;
    for (const sub of subscriptions) {
      const exists = await this.prisma.invoice.findUnique({
        where: { companyId_period: { companyId: sub.companyId, period } },
        select: { id: true },
      });
      if (exists) continue;
      try {
        await this.prisma.invoice.create({
          data: {
            companyId: sub.companyId,
            period,
            amountCents: sub.priceCents,
            dueDate: dueDateOf(period, sub.billingDay),
          },
        });
        created++;
      } catch (err) {
        // corrida com outra instância: a unique resolve — segue o baile
        this.logger.warn(
          `Fatura ${sub.companyId}/${period.toISOString().slice(0, 7)} não criada: ${(err as Error).message}`,
        );
      }
    }
    if (created > 0) {
      this.logger.log(
        JSON.stringify({ event: 'ops_billing_invoices_created', period: period.toISOString().slice(0, 10), created }),
      );
    }
    return created;
  }

  /**
   * Régua: OPEN vencida → OVERDUE; OVERDUE há ≥3 dias sem aviso → e-mail
   * (uma vez; falha de SMTP NÃO marca notifiedAt — retenta amanhã).
   */
  async runDunning(now: Date): Promise<{ overdueMarked: number; emailsSent: number }> {
    const { count: overdueMarked } = await this.prisma.invoice.updateMany({
      where: { status: InvoiceStatus.OPEN, dueDate: { lt: now } },
      data: { status: InvoiceStatus.OVERDUE },
    });

    const cutoff = new Date(now.getTime() - DUNNING.EMAIL_DIAS * 24 * 3600 * 1000);
    const toNotify = await this.prisma.invoice.findMany({
      where: {
        status: InvoiceStatus.OVERDUE,
        notifiedAt: null,
        dueDate: { lte: cutoff },
      },
      include: { company: { select: { id: true, name: true, email: true } } },
    });

    let emailsSent = 0;
    for (const invoice of toNotify) {
      const to = await this.billingContactsFor(invoice.company.id, invoice.company.email);
      if (to.length === 0) {
        this.logger.warn(`Fatura ${invoice.id}: tenant sem e-mail de contato — aviso D+3 pulado`);
        continue;
      }
      const valor = (invoice.amountCents / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      });
      const mail = await this.mailService.send({
        to: to.join(', '),
        subject: `Avecchi — fatura em aberto (venc. ${invoice.dueDate.toISOString().slice(0, 10)})`,
        text:
          `Olá!\n\nA fatura da assinatura Avecchi da ${invoice.company.name} ` +
          `no valor de ${valor}, com vencimento em ${invoice.dueDate.toISOString().slice(0, 10)}, ` +
          `consta em aberto.\n\nSe o pagamento já foi feito, desconsidere este aviso — a baixa ` +
          `pode levar até 1 dia útil.\n\nQualquer dúvida, responda este e-mail.\n\n— Equipe Avecchi`,
      });
      if (mail.ok) {
        await this.prisma.invoice.update({
          where: { id: invoice.id },
          data: { notifiedAt: now },
        });
        emailsSent++;
      } else {
        this.logger.warn(`Fatura ${invoice.id}: e-mail D+3 falhou (${mail.reason}) — retenta amanhã`);
      }
    }
    return { overdueMarked, emailsSent };
  }

  /** Contatos de cobrança: e-mail cadastral da empresa + admins do tenant. */
  private async billingContactsFor(rootId: string, companyEmail: string | null): Promise<string[]> {
    const admins = await this.prisma.user.findMany({
      where: {
        role: UserRole.SUPER_ADMIN,
        isActive: true,
        company: { OR: [{ id: rootId }, { parentId: rootId }] },
      },
      select: { email: true },
    });
    return [...new Set([companyEmail, ...admins.map((a) => a.email)].filter(Boolean))] as string[];
  }

  // ─── Gestão pelo portal ────────────────────────────────────────────────────

  /** Cria/atualiza a assinatura do tenant RAIZ (valor negociado + vencimento). */
  async upsertSubscription(
    tenantId: string,
    dto: { planId?: string | null; priceCents: number; billingDay: number; startedAt?: string },
    ctx: OpsActionContext,
  ) {
    await this.assertRootTenant(tenantId);
    const existing = await this.prisma.subscription.findUnique({
      where: { companyId: tenantId },
    });

    const data = {
      planId: dto.planId ?? null,
      priceCents: dto.priceCents,
      billingDay: dto.billingDay,
      startedAt: dto.startedAt ? new Date(dto.startedAt) : existing?.startedAt ?? new Date(),
      canceledAt: null, // recriar/editar reativa
    };
    const subscription = existing
      ? await this.prisma.subscription.update({ where: { companyId: tenantId }, data })
      : await this.prisma.subscription.create({
          data: { ...data, companyId: tenantId, createdById: ctx.userId },
        });

    await this.audit(ctx, tenantId, 'Subscription', subscription.id, AuditAction.UPDATE, existing ? {
      priceCents: existing.priceCents,
      billingDay: existing.billingDay,
      canceledAt: existing.canceledAt,
    } : null, {
      priceCents: dto.priceCents,
      billingDay: dto.billingDay,
    });
    return subscription;
  }

  /** Cancela a assinatura (faturas existentes continuam cobráveis). */
  async cancelSubscription(tenantId: string, ctx: OpsActionContext) {
    await this.assertRootTenant(tenantId);
    const existing = await this.prisma.subscription.findUnique({
      where: { companyId: tenantId },
    });
    if (!existing || existing.canceledAt) {
      throw new BadRequestException('Tenant sem assinatura ativa');
    }
    const subscription = await this.prisma.subscription.update({
      where: { companyId: tenantId },
      data: { canceledAt: new Date() },
    });
    await this.audit(ctx, tenantId, 'Subscription', subscription.id, AuditAction.CANCEL, {
      canceledAt: null,
    }, { canceledAt: subscription.canceledAt });
    return subscription;
  }

  /** Assinatura + faturas do tenant (aba Financeiro do drill-down). */
  async tenantBilling(tenantId: string) {
    await this.assertRootTenant(tenantId);
    const [subscription, invoices] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { companyId: tenantId } }),
      this.prisma.invoice.findMany({
        where: { companyId: tenantId },
        orderBy: { period: 'desc' },
        take: 24,
      }),
    ]);
    return { subscription, invoices };
  }

  /** Baixa manual (auditada). Só OPEN/OVERDUE viram PAID. */
  async markPaid(invoiceId: string, method: string, ctx: OpsActionContext) {
    if (!INVOICE_METHODS.includes(method as (typeof INVOICE_METHODS)[number])) {
      throw new BadRequestException(`method deve ser um de: ${INVOICE_METHODS.join(', ')}`);
    }
    const invoice = await this.getPayable(invoiceId);
    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.PAID, paidAt: new Date(), method },
    });
    await this.audit(ctx, invoice.companyId, 'Invoice', invoiceId, AuditAction.APPROVE, {
      status: invoice.status,
    }, { status: InvoiceStatus.PAID, method });
    return updated;
  }

  /** Anula uma fatura (erro de emissão/negociação) — motivo obrigatório. */
  async voidInvoice(invoiceId: string, reason: string, ctx: OpsActionContext) {
    if (!reason?.trim() || reason.trim().length < 5) {
      throw new BadRequestException('Anulação exige um motivo (mín. 5 caracteres)');
    }
    const invoice = await this.getPayable(invoiceId);
    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.VOID, voidReason: reason.trim() },
    });
    await this.audit(ctx, invoice.companyId, 'Invoice', invoiceId, AuditAction.CANCEL, {
      status: invoice.status,
    }, { status: InvoiceStatus.VOID, reason: reason.trim() });
    return updated;
  }

  /** Visão da carteira: MRR (total e por plano) + aging + vencidas. */
  async overview() {
    const now = new Date();
    const [subscriptions, openInvoices] = await Promise.all([
      this.prisma.subscription.findMany({
        where: {
          canceledAt: null,
          company: { isSandbox: false, tenantStatus: { notIn: [TenantStatus.CHURNED] } },
        },
        include: { company: { select: { id: true, name: true, plan: { select: { code: true } } } } },
      }),
      this.prisma.invoice.findMany({
        where: { status: { in: [InvoiceStatus.OPEN, InvoiceStatus.OVERDUE] } },
        include: { company: { select: { id: true, name: true } } },
        orderBy: { dueDate: 'asc' },
      }),
    ]);

    const mrrCents = subscriptions.reduce((acc, s) => acc + s.priceCents, 0);
    const mrrByPlan: Record<string, number> = {};
    for (const s of subscriptions) {
      const code = s.company.plan?.code ?? 'LEGADO';
      mrrByPlan[code] = (mrrByPlan[code] ?? 0) + s.priceCents;
    }

    const aging = { current: 0, d1_15: 0, d16_30: 0, d31_plus: 0 };
    for (const inv of openInvoices) {
      const past = daysPast(inv.dueDate, now);
      if (past <= 0) aging.current += inv.amountCents;
      else if (past <= 15) aging.d1_15 += inv.amountCents;
      else if (past <= 30) aging.d16_30 += inv.amountCents;
      else aging.d31_plus += inv.amountCents;
    }

    return {
      mrrCents,
      mrrByPlan,
      activeSubscriptions: subscriptions.length,
      aging,
      openInvoices: openInvoices.map((inv) => ({
        id: inv.id,
        tenantId: inv.company.id,
        tenantName: inv.company.name,
        period: inv.period,
        dueDate: inv.dueDate,
        amountCents: inv.amountCents,
        status: inv.status,
        daysPastDue: Math.max(0, daysPast(inv.dueDate, now)),
      })),
    };
  }

  /**
   * Status de cobrança da PRÓPRIA conta (banner do app do cliente):
   * none → nada em atraso · notice (D+3..9) → aviso discreto ·
   * banner (D+10+) → banner persistente.
   */
  async myBillingStatus(companyId: string) {
    const root = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { id: true, parentId: true },
    });
    const rootId = root.parentId ?? root.id;
    const worst = await this.prisma.invoice.findFirst({
      where: { companyId: rootId, status: InvoiceStatus.OVERDUE },
      orderBy: { dueDate: 'asc' },
    });
    if (!worst) return { level: 'none' as const };

    const past = daysPast(worst.dueDate, new Date());
    const level =
      past >= DUNNING.BANNER_DIAS ? ('banner' as const) : past >= DUNNING.EMAIL_DIAS ? ('notice' as const) : ('none' as const);
    if (level === 'none') return { level };
    return {
      level,
      dueDate: worst.dueDate,
      amountCents: worst.amountCents,
      daysPastDue: past,
      message:
        'Há uma fatura da assinatura Avecchi em aberto. ' +
        'Regularize para evitar a suspensão do acesso.',
    };
  }

  /** Propostas de suspensão (D+20) — consumidas pelos alertas do portal. */
  async suspensionProposals(now = new Date()) {
    const cutoff = new Date(now.getTime() - DUNNING.SUSPENSAO_DIAS * 24 * 3600 * 1000);
    return this.prisma.invoice.findMany({
      where: {
        status: InvoiceStatus.OVERDUE,
        dueDate: { lte: cutoff },
        company: {
          isSandbox: false,
          tenantStatus: TenantStatus.ACTIVE,
        },
      },
      include: { company: { select: { id: true, name: true } } },
      orderBy: { dueDate: 'asc' },
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async getPayable(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Fatura não encontrada');
    if (invoice.status === InvoiceStatus.PAID || invoice.status === InvoiceStatus.VOID) {
      throw new BadRequestException(`Fatura já está ${invoice.status}`);
    }
    return invoice;
  }

  private async assertRootTenant(id: string) {
    const tenant = await this.prisma.company.findUnique({
      where: { id },
      select: { parentId: true },
    });
    if (!tenant || tenant.parentId !== null) {
      throw new NotFoundException('Tenant não encontrado');
    }
  }

  private async audit(
    ctx: OpsActionContext,
    companyId: string,
    entity: string,
    entityId: string,
    action: AuditAction,
    oldValue: unknown,
    newValue: unknown,
  ) {
    await this.auditService.persist({
      companyId,
      userId: ctx.userId,
      sessionId: ctx.sessionId ?? null,
      entity,
      entityId,
      action,
      module: 'ops',
      oldValue,
      newValue,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });
  }
}
