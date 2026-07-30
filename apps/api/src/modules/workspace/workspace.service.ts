import { Injectable, Logger } from '@nestjs/common';
import {
  AlertSeverity,
  AlertType,
  FinancialEntryStatus,
  FinancialEntryType,
  InspectionStatus,
  ProductionOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionService, permissionMatches } from '../iam/permission.service';
import { ApprovalService } from '../approval/approval.service';

/**
 * Workspace — BFF da Home por papel (F1 do épico Workspace Inteligente).
 *
 * Três agregadores cross-domínio, todos CURADOS POR PERMISSÃO NO SERVIDOR:
 * o conjunto efetivo do usuário (PermissionService, mesmo cache Redis do
 * PermissionGuard) decide quais consultas RODAM — um supervisor de produção
 * nunca recebe (nem dispara) uma consulta financeira; o payload já chega
 * limpo, o frontend não filtra nada.
 *
 * - insights: Resumo do Dia (Antonella V1) — motor de REGRAS determinísticas
 *   sobre o hub de alertas + consultas prospectivas. A V2 (LLM) trocará o
 *   miolo mantendo o contrato.
 * - tasks: Minhas Pendências — aprovações na alçada, follow-ups de CRM e
 *   inspeções de qualidade (3 fontes da F1).
 * - agenda: próximos 7 dias — vencimentos financeiros, términos de OP e
 *   lembretes, unificados de datas que já existem no schema.
 *
 * Por ser BFF, os CTAs devolvem `href` de rotas REAIS do apps/web
 * (nav-config.ts) — acoplamento deliberado e documentado.
 */

type AuthUserLite = { id: string; companyId: string; role: string };

export interface WorkspaceInsight {
  id: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO' | 'SUCCESS';
  message: string;
  count?: number;
  cta?: { label: string; href: string };
}

export interface WorkspaceTask {
  id: string;
  type: 'approval' | 'crm-reminder' | 'quality-inspection';
  title: string;
  subtitle?: string;
  href: string;
  dueAt?: string;
  createdAt?: string;
}

export interface AgendaItem {
  id: string;
  date: string; // ISO yyyy-mm-dd
  kind: 'finance-due' | 'production-end' | 'crm-reminder';
  title: string;
  href: string;
  tone?: 'danger' | 'warning' | 'neutral';
}

const SEVERITY_ORDER: Record<WorkspaceInsight['severity'], number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
  SUCCESS: 3,
};

/**
 * Rollup de alertas por tipo → um insight por tipo com CTA para a tela do
 * domínio. Cada tipo exige a permissão do DOMÍNIO (não basta ver alertas):
 * o alerta de estoque só vira insight para quem enxerga estoque.
 *
 * Tipos deliberadamente FORA: PRODUCTION_LATE e PAYABLE_DUE (viram regras
 * prospectivas próprias, mais ricas), CRM_REMINDER_DUE (vira pendência em
 * /tasks), MRP_RUN_DONE/CRM_SDR_HANDOFF/RENAVE_OP_FAILED/BIN_REGISTER_FAILED
 * (nicho — continuam em /app/alerts).
 */
const ALERT_ROLLUPS: Partial<
  Record<AlertType, { permission: string; href: string; label: string; message: (n: number) => string }>
> = {
  [AlertType.STOCK_MIN]: {
    permission: 'stock.balances.view',
    href: '/app/stock',
    label: 'Ir para Estoque',
    message: (n) => (n === 1 ? '1 item com estoque abaixo do mínimo' : `${n} itens com estoque abaixo do mínimo`),
  },
  [AlertType.NFE_REJECTED]: {
    permission: 'fiscal.documents.view',
    href: '/app/fiscal',
    label: 'Ver NF-e',
    message: (n) => (n === 1 ? '1 NF-e rejeitada pela SEFAZ' : `${n} NF-e rejeitadas pela SEFAZ`),
  },
  [AlertType.FOCUS_NFE_DOWN]: {
    permission: 'fiscal.documents.view',
    href: '/app/fiscal',
    label: 'Ver Fiscal',
    message: () => 'Integração Focus NFe indisponível',
  },
  [AlertType.MANIFEST_OVERDUE]: {
    permission: 'fiscal.manifestation.view',
    href: '/app/fiscal/compliance',
    label: 'Ver manifestações',
    message: (n) =>
      n === 1 ? '1 NF-e de entrada com manifestação vencida' : `${n} NF-e de entrada com manifestação vencida`,
  },
  [AlertType.MAINTENANCE_DUE]: {
    permission: 'maintenance.orders.view',
    href: '/app/maintenance',
    label: 'Ver manutenções',
    message: (n) => (n === 1 ? '1 manutenção vencendo' : `${n} manutenções vencendo`),
  },
  [AlertType.QC_INSPECTION_FAILED]: {
    permission: 'quality.inspections.view',
    href: '/app/quality',
    label: 'Ver Qualidade',
    message: (n) => (n === 1 ? '1 inspeção de qualidade reprovada' : `${n} inspeções de qualidade reprovadas`),
  },
  [AlertType.CRM_SLA_ESCALATION]: {
    permission: 'crm.leads.view',
    href: '/app/crm/sla',
    label: 'Ver SLA',
    message: (n) => (n === 1 ? '1 lead com SLA estourado' : `${n} leads com SLA estourado`),
  },
  [AlertType.CRM_SLA_WARNING]: {
    permission: 'crm.leads.view',
    href: '/app/crm/sla',
    label: 'Ver SLA',
    message: (n) => (n === 1 ? '1 lead esfriando (SLA)' : `${n} leads esfriando (SLA)`),
  },
};

const MAX_INSIGHTS = 6;
const MAX_TASKS = 12;
const MAX_AGENDA_ITEMS = 40;
const AGENDA_WINDOW_DAYS = 7;
const PAYABLE_WINDOW_DAYS = 7;

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly approvalService: ApprovalService,
  ) {}

  private async canOf(user: AuthUserLite): Promise<(code: string) => boolean> {
    const { permissions } = await this.permissionService.getUserPermissions(user.id, user.companyId);
    const set = new Set(permissions);
    return (code: string) => permissionMatches(set, code);
  }

  private brl(value: unknown, digits: 0 | 2 = 0): string {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(Number(value ?? 0));
  }

  private startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private endOfDayIn(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  private isoDay(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  // ─── Resumo do Dia (insights) ──────────────────────────────────────────────

  async getInsights(user: AuthUserLite): Promise<{ insights: WorkspaceInsight[]; generatedAt: string }> {
    const can = await this.canOf(user);
    const insights: WorkspaceInsight[] = [];
    const now = new Date();
    const jobs: Promise<void>[] = [];

    // OPs além do prazo — regra prospectiva viva (mais atual que o cron de alertas)
    if (can('production.orders.view')) {
      jobs.push(
        this.prisma.productionOrder
          .count({
            where: {
              companyId: user.companyId,
              status: { in: [ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS] },
              scheduledEnd: { lt: now },
            },
          })
          .then((n) => {
            if (n > 0) {
              insights.push({
                id: 'production-late',
                severity: 'CRITICAL',
                count: n,
                message:
                  n === 1
                    ? '1 ordem de produção está além do prazo'
                    : `${n} ordens de produção estão além do prazo`,
                cta: { label: 'Ver OPs', href: '/app/production' },
              });
            }
          }),
      );
    }

    if (can('finance.entries.view')) {
      // Recebíveis vencidos (status OVERDUE ou em aberto com dueDate passada)
      jobs.push(
        this.prisma.financialEntry
          .aggregate({
            _sum: { amount: true },
            _count: true,
            where: {
              companyId: user.companyId,
              type: FinancialEntryType.RECEIVABLE,
              OR: [
                { status: FinancialEntryStatus.OVERDUE },
                {
                  status: { in: [FinancialEntryStatus.OPEN, FinancialEntryStatus.PARTIALLY_PAID] },
                  dueDate: { lt: this.startOfToday() },
                },
              ],
            },
          })
          .then((r) => {
            const total = Number(r._sum.amount ?? 0);
            if (total > 0) {
              insights.push({
                id: 'receivable-overdue',
                severity: 'WARNING',
                count: r._count,
                message: `${this.brl(total)} em recebíveis vencidos`,
                cta: { label: 'Ver cobrança', href: '/app/finance/receivables' },
              });
            }
          }),
      );
      // A pagar nos próximos 7 dias
      jobs.push(
        this.prisma.financialEntry
          .aggregate({
            _sum: { amount: true },
            _count: true,
            where: {
              companyId: user.companyId,
              type: FinancialEntryType.PAYABLE,
              status: { in: [FinancialEntryStatus.OPEN, FinancialEntryStatus.PARTIALLY_PAID] },
              dueDate: { gte: this.startOfToday(), lte: this.endOfDayIn(PAYABLE_WINDOW_DAYS) },
            },
          })
          .then((r) => {
            const total = Number(r._sum.amount ?? 0);
            if (total > 0) {
              insights.push({
                id: 'payable-upcoming',
                severity: 'INFO',
                count: r._count,
                message: `${this.brl(total)} a pagar nos próximos ${PAYABLE_WINDOW_DAYS} dias`,
                cta: { label: 'Ver contas a pagar', href: '/app/finance/payables' },
              });
            }
          }),
      );
    }

    // Documentos aguardando a MINHA alçada
    if (can('approvals.requests.view')) {
      jobs.push(
        this.approvalService.getPending(user.companyId, user.role).then((pending: unknown[]) => {
          const n = pending.length;
          if (n > 0) {
            insights.push({
              id: 'approvals-pending',
              severity: 'WARNING',
              count: n,
              message:
                n === 1 ? '1 documento aguardando sua aprovação' : `${n} documentos aguardando sua aprovação`,
              cta: { label: 'Ver aprovações', href: '/app/approvals' },
            });
          }
        }),
      );
    }

    // Inspeções de qualidade na fila
    if (can('quality.inspections.view')) {
      jobs.push(
        this.prisma.inspection
          .count({ where: { companyId: user.companyId, status: InspectionStatus.PENDING } })
          .then((n) => {
            if (n > 0) {
              insights.push({
                id: 'quality-pending',
                severity: 'INFO',
                count: n,
                message:
                  n === 1
                    ? '1 inspeção de qualidade aguardando'
                    : `${n} inspeções de qualidade aguardando`,
                cta: { label: 'Ver fila', href: '/app/quality' },
              });
            }
          }),
      );
    }

    // Rollups do hub de alertas (cada tipo gateado pela permissão do domínio)
    if (can('dashboard.alerts.view')) {
      const wantedTypes = (Object.keys(ALERT_ROLLUPS) as AlertType[]).filter((t) =>
        can(ALERT_ROLLUPS[t]!.permission),
      );
      if (wantedTypes.length > 0) {
        jobs.push(
          this.prisma.alert
            .findMany({
              where: { companyId: user.companyId, resolvedAt: null, type: { in: wantedTypes } },
              select: { type: true, severity: true },
            })
            .then((alerts) => {
              const byType = new Map<AlertType, { count: number; worst: AlertSeverity }>();
              for (const a of alerts) {
                const cur = byType.get(a.type) ?? { count: 0, worst: AlertSeverity.INFO };
                cur.count += 1;
                if (
                  a.severity === AlertSeverity.CRITICAL ||
                  (a.severity === AlertSeverity.WARNING && cur.worst === AlertSeverity.INFO)
                ) {
                  cur.worst = a.severity;
                }
                byType.set(a.type, cur);
              }
              for (const [type, { count, worst }] of byType) {
                const rollup = ALERT_ROLLUPS[type]!;
                insights.push({
                  id: `alert-${type.toLowerCase().replace(/_/g, '-')}`,
                  severity: worst === AlertSeverity.CRITICAL ? 'CRITICAL' : worst === AlertSeverity.WARNING ? 'WARNING' : 'INFO',
                  count,
                  message: rollup.message(count),
                  cta: { label: rollup.label, href: rollup.href },
                });
              }
            }),
        );
      }
    }

    // Uma fonte quebrada não derruba o resumo — degrada para os demais insights.
    await Promise.all(
      jobs.map((j) => j.catch((err) => this.logger.warn(`insight source failed: ${err?.message ?? err}`))),
    );

    insights.sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.count ?? 0) - (a.count ?? 0),
    );
    return { insights: insights.slice(0, MAX_INSIGHTS), generatedAt: new Date().toISOString() };
  }

  // ─── Minhas Pendências (tasks) ─────────────────────────────────────────────

  async getTasks(user: AuthUserLite): Promise<WorkspaceTask[]> {
    const can = await this.canOf(user);
    const tasks: WorkspaceTask[] = [];
    const jobs: Promise<void>[] = [];

    if (can('approvals.requests.view')) {
      jobs.push(
        this.approvalService.getPending(user.companyId, user.role).then((pending: any[]) => {
          for (const p of pending.slice(0, 8)) {
            tasks.push({
              id: `approval-${p.documentType}-${p.id}`,
              type: 'approval',
              title:
                p.documentType === 'PO' ? 'Aprovar Pedido de Compra' : 'Aprovar Solicitação de Compra',
              subtitle:
                [p.supplier?.name, p.totalAmount != null ? this.brl(p.totalAmount, 2) : null]
                  .filter(Boolean)
                  .join(' · ') || undefined,
              href: '/app/approvals',
              createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : undefined,
            });
          }
        }),
      );
    }

    if (can('crm.leads.view')) {
      jobs.push(
        this.prisma.leadReminder
          .findMany({
            where: { companyId: user.companyId, userId: user.id, doneAt: null },
            include: { lead: { select: { name: true } } },
            orderBy: { dueAt: 'asc' },
            take: 8,
          })
          .then((reminders) => {
            for (const r of reminders) {
              tasks.push({
                id: `crm-reminder-${r.id}`,
                type: 'crm-reminder',
                title: r.lead?.name ? `Follow-up: ${r.lead.name}` : `Follow-up: ${r.text}`,
                subtitle: r.lead?.name ? r.text : undefined,
                href: '/app/crm/leads',
                dueAt: r.dueAt.toISOString(),
              });
            }
          }),
      );
    }

    if (can('quality.inspections.view')) {
      jobs.push(
        this.prisma.inspection
          .findMany({
            where: { companyId: user.companyId, status: InspectionStatus.PENDING },
            orderBy: { createdAt: 'asc' },
            take: 8,
          })
          .then((inspections) => {
            for (const i of inspections) {
              tasks.push({
                id: `quality-inspection-${i.id}`,
                type: 'quality-inspection',
                title: 'Inspeção de qualidade pendente',
                href: '/app/quality',
                createdAt: i.createdAt.toISOString(),
              });
            }
          }),
      );
    }

    await Promise.all(
      jobs.map((j) => j.catch((err) => this.logger.warn(`task source failed: ${err?.message ?? err}`))),
    );

    // Mais antigo primeiro: pendência velha é pendência esquecida.
    tasks.sort((a, b) => (a.dueAt ?? a.createdAt ?? '').localeCompare(b.dueAt ?? b.createdAt ?? ''));
    return tasks.slice(0, MAX_TASKS);
  }

  // ─── Agenda (próximos 7 dias) ──────────────────────────────────────────────

  async getAgenda(user: AuthUserLite): Promise<AgendaItem[]> {
    const can = await this.canOf(user);
    const items: AgendaItem[] = [];
    const jobs: Promise<void>[] = [];
    const from = this.startOfToday();
    const to = this.endOfDayIn(AGENDA_WINDOW_DAYS);
    const todayIso = this.isoDay(from);

    if (can('finance.entries.view')) {
      jobs.push(
        this.prisma.financialEntry
          .findMany({
            where: {
              companyId: user.companyId,
              status: { in: [FinancialEntryStatus.OPEN, FinancialEntryStatus.PARTIALLY_PAID] },
              dueDate: { gte: from, lte: to },
            },
            orderBy: { dueDate: 'asc' },
            take: 20,
          })
          .then((entries) => {
            for (const e of entries) {
              const payable = e.type === FinancialEntryType.PAYABLE;
              const date = this.isoDay(e.dueDate);
              items.push({
                id: `finance-${e.id}`,
                date,
                kind: 'finance-due',
                title: `${payable ? 'Pagar' : 'Receber'} ${this.brl(e.amount, 2)}${e.description ? ` — ${e.description}` : ''}`,
                href: payable ? '/app/finance/payables' : '/app/finance/receivables',
                tone: payable && date === todayIso ? 'warning' : 'neutral',
              });
            }
          }),
      );
    }

    if (can('production.orders.view')) {
      jobs.push(
        this.prisma.productionOrder
          .findMany({
            where: {
              companyId: user.companyId,
              status: { in: [ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS] },
              scheduledEnd: { gte: from, lte: to },
            },
            include: { product: { select: { name: true } } },
            orderBy: { scheduledEnd: 'asc' },
            take: 10,
          })
          .then((orders) => {
            for (const o of orders) {
              items.push({
                id: `production-${o.id}`,
                date: this.isoDay(o.scheduledEnd!),
                kind: 'production-end',
                title: `OP de ${o.product?.name ?? 'produto'} termina`,
                href: '/app/production',
                tone: 'neutral',
              });
            }
          }),
      );
    }

    if (can('crm.leads.view')) {
      jobs.push(
        this.prisma.leadReminder
          .findMany({
            where: {
              companyId: user.companyId,
              userId: user.id,
              doneAt: null,
              dueAt: { gte: from, lte: to },
            },
            include: { lead: { select: { name: true } } },
            orderBy: { dueAt: 'asc' },
            take: 10,
          })
          .then((reminders) => {
            for (const r of reminders) {
              items.push({
                id: `crm-${r.id}`,
                date: this.isoDay(r.dueAt),
                kind: 'crm-reminder',
                title: r.lead?.name ? `Follow-up: ${r.lead.name}` : `Follow-up: ${r.text}`,
                href: '/app/crm/leads',
                tone: 'neutral',
              });
            }
          }),
      );
    }

    await Promise.all(
      jobs.map((j) => j.catch((err) => this.logger.warn(`agenda source failed: ${err?.message ?? err}`))),
    );

    items.sort((a, b) => a.date.localeCompare(b.date));
    return items.slice(0, MAX_AGENDA_ITEMS);
  }
}
