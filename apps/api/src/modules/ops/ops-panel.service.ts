import { Injectable, NotFoundException } from '@nestjs/common';
import { FiscalStatus, InvoiceStatus, SupportIncidentSource, TenantStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { utcDayStart } from './usage-metering.service';

/**
 * OpsPanelService — OPS WP3 (#910): leituras do painel de contas.
 * Séries e KPIs vêm de gdr_tenant_usage_dailies (metering); o que precisa de
 * "agora" (último login, saúde recente, linha do tempo) consulta o OLTP com
 * queries pontuais e indexadas.
 *
 * SANDBOX fora das visões agregadas da operadora (resumo da lista e alertas);
 * o drill-down de um tenant sandbox específico continua acessível — operador
 * inspecionar a conta de teste é caso de uso legítimo.
 */

/** Regras dos alertas — constantes deliberadamente simples na F1 do painel. */
export const ALERT_RULES = {
  SEM_LOGIN_DIAS: 7,
  PICO_5XX_DIA: 10,
  REJEICAO_SEFAZ_PCT: 20,
  REJEICAO_SEFAZ_MIN_DOCS: 5,
  TRIAL_VENCENDO_DIAS: 7,
  SUSPENSAO_PROPOSTA_DIAS: 20, // WP5 #912 — espelha DUNNING.SUSPENSAO_DIAS
} as const;

export interface OpsAlert {
  type:
    | 'SEM_LOGIN'
    | 'PICO_5XX'
    | 'REJEICAO_SEFAZ'
    | 'TRIAL_VENCENDO'
    // OPS WP5 (#912): fatura vencida há ≥20 dias — a régua PROPÕE, o operador
    // decide (suspensão é sempre o PATCH de status manual do WP1)
    | 'SUSPENSAO_PROPOSTA';
  severity: 'WARNING' | 'CRITICAL';
  tenantId: string;
  tenantName: string;
  message: string;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 3600 * 1000);
}

@Injectable()
export class OpsPanelService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertRoot(id: string) {
    const tenant = await this.prisma.company.findUnique({
      where: { id },
      select: { id: true, name: true, parentId: true, branches: { select: { id: true } } },
    });
    if (!tenant || tenant.parentId !== null) {
      throw new NotFoundException('Tenant não encontrado');
    }
    return { ...tenant, treeIds: [tenant.id, ...tenant.branches.map((b) => b.id)] };
  }

  /**
   * Resumo de uso para a LISTA de tenants (uma chamada, todas as contas):
   * usuários ativos 30d (distintos, live), NF-e no mês corrente e erros 7d
   * (do metering) e último login (live).
   */
  async listUsageSummary() {
    const roots = await this.prisma.company.findMany({
      where: { parentId: null },
      select: { id: true, branches: { select: { id: true } } },
    });
    const rootOf = new Map<string, string>();
    for (const r of roots) {
      rootOf.set(r.id, r.id);
      for (const b of r.branches) rootOf.set(b.id, r.id);
    }

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [metering, sessions30d, lastLogins] = await Promise.all([
      this.prisma.tenantUsageDaily.groupBy({
        by: ['companyId'],
        where: { date: { gte: utcDayStart(daysAgo(7)) } },
        _sum: { errors5xx: true },
      }),
      this.prisma.userSession.findMany({
        where: { createdAt: { gte: daysAgo(30) } },
        select: { userId: true, companyId: true },
        distinct: ['userId'],
      }),
      this.prisma.userSession.groupBy({
        by: ['companyId'],
        _max: { createdAt: true },
      }),
    ]);
    const nfeMonth = await this.prisma.tenantUsageDaily.groupBy({
      by: ['companyId'],
      where: { date: { gte: monthStart } },
      _sum: { nfeIssued: true },
    });

    const summary = new Map<
      string,
      { activeUsers30d: number; nfeMonth: number; errors7d: number; lastLoginAt: Date | null }
    >();
    const ensure = (rootId: string) => {
      if (!summary.has(rootId)) {
        summary.set(rootId, { activeUsers30d: 0, nfeMonth: 0, errors7d: 0, lastLoginAt: null });
      }
      return summary.get(rootId)!;
    };

    for (const s of sessions30d) {
      const rootId = rootOf.get(s.companyId);
      if (rootId) ensure(rootId).activeUsers30d++;
    }
    for (const m of metering) {
      // metering já é por raiz
      ensure(m.companyId).errors7d = m._sum.errors5xx ?? 0;
    }
    for (const m of nfeMonth) {
      ensure(m.companyId).nfeMonth = m._sum.nfeIssued ?? 0;
    }
    for (const l of lastLogins) {
      const rootId = rootOf.get(l.companyId);
      if (!rootId || !l._max.createdAt) continue;
      const row = ensure(rootId);
      if (!row.lastLoginAt || l._max.createdAt > row.lastLoginAt) {
        row.lastLoginAt = l._max.createdAt;
      }
    }
    return Object.fromEntries(summary);
  }

  /** Série diária + totais do período — alimenta KPIs e sparklines. */
  async getUsage(id: string, days = 90) {
    await this.assertRoot(id);
    const from = utcDayStart(daysAgo(Math.min(Math.max(days, 1), 365)));
    const series = await this.prisma.tenantUsageDaily.findMany({
      where: { companyId: id, date: { gte: from } },
      orderBy: { date: 'asc' },
      select: {
        date: true,
        activeUsers: true,
        nfeIssued: true,
        nfeRejected: true,
        crmLeads: true,
        errors5xx: true,
      },
    });
    const totals = series.reduce(
      (acc, d) => ({
        nfeIssued: acc.nfeIssued + d.nfeIssued,
        nfeRejected: acc.nfeRejected + d.nfeRejected,
        crmLeads: acc.crmLeads + d.crmLeads,
        errors5xx: acc.errors5xx + d.errors5xx,
        peakActiveUsers: Math.max(acc.peakActiveUsers, d.activeUsers),
      }),
      { nfeIssued: 0, nfeRejected: 0, crmLeads: 0, errors5xx: 0, peakActiveUsers: 0 },
    );
    return { series, totals };
  }

  /** Saúde "agora": rejeições SEFAZ recentes, 5xx recentes, pessoas. */
  async getHealth(id: string) {
    const { treeIds } = await this.assertRoot(id);
    const [recentRejections, recentErrors, users] = await Promise.all([
      this.prisma.fiscalDocument.findMany({
        where: {
          companyId: { in: treeIds },
          status: FiscalStatus.REJECTED,
          createdAt: { gte: daysAgo(7) },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, type: true, createdAt: true, rejectionReason: true },
      }),
      this.prisma.supportIncident.findMany({
        where: {
          companyId: { in: treeIds },
          source: SupportIncidentSource.AUTO_ERROR,
          createdAt: { gte: daysAgo(7) },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, protocol: true, title: true, status: true, createdAt: true },
      }),
      this.prisma.user.findMany({
        where: { companyId: { in: treeIds } },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          sessions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { createdAt: true },
          },
        },
        orderBy: { name: 'asc' },
      }),
    ]);

    return {
      recentRejections,
      recentErrors,
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        lastLoginAt: u.sessions[0]?.createdAt ?? null,
      })),
    };
  }

  /** Linha do tempo do tenant: eventos do módulo ops no AuditLogV2. */
  async getTimeline(id: string, take = 50) {
    await this.assertRoot(id);
    return this.prisma.auditLogV2.findMany({
      where: { companyId: id, module: 'ops' },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 200),
      select: {
        id: true,
        entity: true,
        entityId: true,
        action: true,
        oldValue: true,
        newValue: true,
        createdAt: true,
        user: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * KPIs de carteira do Painel da Operadora (#957) — contagens sobre o
   * CADASTRO (tenants raiz), sem dinheiro: a parte financeira (MRR, aging,
   * série) vive no BillingService.overview() sob ops.billing.view, e o front
   * compõe as duas metades conforme a permissão de quem olha.
   * SANDBOX conta separado (é conta de teste, não carteira).
   */
  async getPortfolioKpis() {
    const inicioDoMes = new Date();
    inicioDoMes.setUTCDate(1);
    inicioDoMes.setUTCHours(0, 0, 0, 0);

    const roots = await this.prisma.company.findMany({
      where: { parentId: null },
      select: { tenantStatus: true, isSandbox: true, createdAt: true },
    });

    const statusCounts: Record<string, number> = {};
    let sandbox = 0;
    let newTenantsMonth = 0;
    for (const t of roots) {
      if (t.isSandbox) {
        sandbox += 1;
        continue;
      }
      statusCounts[t.tenantStatus] = (statusCounts[t.tenantStatus] ?? 0) + 1;
      if (t.createdAt >= inicioDoMes) newTenantsMonth += 1;
    }

    return { statusCounts, sandbox, newTenantsMonth, totalTenants: roots.length - sandbox };
  }

  /**
   * Alertas da operadora — computados on-demand sobre o metering + cadastro.
   * SANDBOX e CHURNED fora. Certificado A1 fica DEFERIDO: o certificado vive
   * na Focus por CNPJ (#695) e não temos a validade em banco — entra quando
   * houver fonte (anotado no épico #915).
   */
  async getAlerts(): Promise<OpsAlert[]> {
    const tenants = await this.prisma.company.findMany({
      where: {
        parentId: null,
        isSandbox: false,
        tenantStatus: { in: [TenantStatus.ACTIVE, TenantStatus.TRIAL] },
      },
      select: { id: true, name: true, tenantStatus: true, trialEndsAt: true },
    });
    if (tenants.length === 0) return [];
    const tenantIds = tenants.map((t) => t.id);

    const [summary, yesterdayRows, sefaz7d, overdue20] = await Promise.all([
      this.listUsageSummary(),
      this.prisma.tenantUsageDaily.findMany({
        where: {
          companyId: { in: tenantIds },
          date: utcDayStart(daysAgo(1)),
        },
        select: { companyId: true, errors5xx: true },
      }),
      this.prisma.tenantUsageDaily.groupBy({
        by: ['companyId'],
        where: { companyId: { in: tenantIds }, date: { gte: utcDayStart(daysAgo(7)) } },
        _sum: { nfeIssued: true, nfeRejected: true },
      }),
      // WP5 (#912): faturas OVERDUE há ≥20 dias → proposta de suspensão
      this.prisma.invoice.findMany({
        where: {
          companyId: { in: tenantIds },
          status: InvoiceStatus.OVERDUE,
          dueDate: { lte: daysAgo(ALERT_RULES.SUSPENSAO_PROPOSTA_DIAS) },
        },
        select: { companyId: true, dueDate: true, amountCents: true },
        orderBy: { dueDate: 'asc' },
      }),
    ]);

    const alerts: OpsAlert[] = [];
    const now = Date.now();

    for (const t of tenants) {
      const usage = (summary as Record<string, { lastLoginAt: Date | string | null }>)[t.id];
      const lastLogin = usage?.lastLoginAt ? new Date(usage.lastLoginAt) : null;
      if (!lastLogin || now - lastLogin.getTime() > ALERT_RULES.SEM_LOGIN_DIAS * 24 * 3600 * 1000) {
        alerts.push({
          type: 'SEM_LOGIN',
          severity: 'WARNING',
          tenantId: t.id,
          tenantName: t.name,
          message: lastLogin
            ? `Sem login há ${Math.floor((now - lastLogin.getTime()) / (24 * 3600 * 1000))} dias — risco de churn`
            : 'Nenhum login registrado — conta pode não ter sido adotada',
        });
      }

      if (
        t.tenantStatus === TenantStatus.TRIAL &&
        t.trialEndsAt &&
        t.trialEndsAt.getTime() - now < ALERT_RULES.TRIAL_VENCENDO_DIAS * 24 * 3600 * 1000
      ) {
        alerts.push({
          type: 'TRIAL_VENCENDO',
          severity: 'WARNING',
          tenantId: t.id,
          tenantName: t.name,
          message: `Trial vence em ${t.trialEndsAt.toISOString().slice(0, 10)}`,
        });
      }
    }

    for (const row of yesterdayRows) {
      if (row.errors5xx >= ALERT_RULES.PICO_5XX_DIA) {
        const t = tenants.find((x) => x.id === row.companyId)!;
        alerts.push({
          type: 'PICO_5XX',
          severity: 'CRITICAL',
          tenantId: t.id,
          tenantName: t.name,
          message: `${row.errors5xx} erros 5xx ontem (limite ${ALERT_RULES.PICO_5XX_DIA})`,
        });
      }
    }

    for (const row of sefaz7d) {
      const issued = row._sum.nfeIssued ?? 0;
      const rejected = row._sum.nfeRejected ?? 0;
      const total = issued + rejected;
      if (total >= ALERT_RULES.REJEICAO_SEFAZ_MIN_DOCS) {
        const pct = (rejected / total) * 100;
        if (pct > ALERT_RULES.REJEICAO_SEFAZ_PCT) {
          const t = tenants.find((x) => x.id === row.companyId)!;
          alerts.push({
            type: 'REJEICAO_SEFAZ',
            severity: 'CRITICAL',
            tenantId: t.id,
            tenantName: t.name,
            message: `Rejeição SEFAZ em ${pct.toFixed(0)}% nos últimos 7d (${rejected}/${total})`,
          });
        }
      }
    }

    const propostos = new Set<string>();
    for (const inv of overdue20) {
      if (propostos.has(inv.companyId)) continue; // 1 alerta por tenant (fatura mais antiga)
      propostos.add(inv.companyId);
      const t = tenants.find((x) => x.id === inv.companyId)!;
      const dias = Math.floor((now - inv.dueDate.getTime()) / (24 * 3600 * 1000));
      alerts.push({
        type: 'SUSPENSAO_PROPOSTA',
        severity: 'CRITICAL',
        tenantId: t.id,
        tenantName: t.name,
        message:
          `Fatura vencida há ${dias} dias (R$ ${(inv.amountCents / 100).toFixed(2)}) — ` +
          'proposta de suspensão. Suspender é decisão manual (ações da conta).',
      });
    }

    const severityOrder = { CRITICAL: 0, WARNING: 1 } as const;
    return alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  }
}
