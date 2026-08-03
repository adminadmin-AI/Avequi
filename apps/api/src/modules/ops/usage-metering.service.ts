import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FiscalStatus, SupportIncidentSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * UsageMeteringService — OPS WP3 (#910): agregação DIÁRIA de uso por tenant.
 *
 * Uma linha por (tenant RAIZ, dia) em gdr_tenant_usage_dailies; os números
 * somam a árvore inteira (matriz + filiais). Upsert por dia — reprocessar
 * sobrescreve, nunca duplica (idempotente por construção).
 *
 * Cron 03:15 agrega o dia ANTERIOR; na primeira execução (tabela vazia) faz
 * backfill de 90 dias. O painel lê SEMPRE desta tabela — nunca query ad-hoc
 * no OLTP a cada pageview.
 *
 * Fontes (por dia UTC):
 * - activeUsers: usuários distintos com UserSession criada no dia
 * - nfeIssued: FiscalDocument AUTHORIZED por authorizedAt
 * - nfeRejected: FiscalDocument REJECTED por createdAt
 * - crmLeads: Lead por createdAt
 * - errors5xx: SupportIncident source=AUTO_ERROR por createdAt (#766)
 * - storageBytes: 0 por ora (sem fonte confiável — deferido no épico #915)
 *
 * SANDBOX: a agregação GRAVA (dado é barato e útil pra depurar), mas as
 * visões da operadora (lista, alertas — ops.service/ops-alerts) excluem.
 */

export const METERING_BACKFILL_DAYS = 90;

export interface DayAggregate {
  activeUsers: number;
  nfeIssued: number;
  nfeRejected: number;
  crmLeads: number;
  errors5xx: number;
}

/** Início do dia UTC (00:00:00.000) de uma data qualquer. */
export function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

@Injectable()
export class UsageMeteringService {
  private readonly logger = new Logger(UsageMeteringService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Cron diário: agrega o dia anterior; backfill na primeira execução. */
  @Cron('15 3 * * *', { name: 'ops-usage-metering' })
  async runDaily(): Promise<void> {
    try {
      const hasAny = await this.prisma.tenantUsageDaily.findFirst({
        select: { id: true },
      });
      if (!hasAny) {
        await this.backfill(METERING_BACKFILL_DAYS);
        return;
      }
      const yesterday = utcDayStart(new Date(Date.now() - 24 * 3600 * 1000));
      await this.aggregateDay(yesterday);
    } catch (err) {
      // Cron nunca derruba o app; o dia perdido é recuperável via
      // POST /ops/metering/run (upsert é idempotente).
      this.logger.error(
        `Metering diário falhou (recuperável via /ops/metering/run): ${(err as Error).message}`,
      );
    }
  }

  /** Reprocessa os últimos N dias (inclui ontem; hoje fica de fora — dia aberto). */
  async backfill(days: number): Promise<number> {
    let processed = 0;
    for (let i = days; i >= 1; i--) {
      const day = utcDayStart(new Date(Date.now() - i * 24 * 3600 * 1000));
      await this.aggregateDay(day);
      processed++;
    }
    this.logger.log(
      JSON.stringify({ event: 'ops_metering_backfill_done', days: processed }),
    );
    return processed;
  }

  /**
   * Agrega UM dia para TODOS os tenants (raízes). Upsert por (tenant, dia).
   */
  async aggregateDay(day: Date): Promise<void> {
    const dayStart = utcDayStart(day);
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

    const roots = await this.prisma.company.findMany({
      where: { parentId: null },
      select: { id: true, branches: { select: { id: true } } },
    });

    for (const root of roots) {
      const treeIds = [root.id, ...root.branches.map((b) => b.id)];
      const agg = await this.aggregateTree(treeIds, dayStart, dayEnd);
      await this.prisma.tenantUsageDaily.upsert({
        where: { companyId_date: { companyId: root.id, date: dayStart } },
        update: agg,
        create: { companyId: root.id, date: dayStart, ...agg },
      });
    }
  }

  private async aggregateTree(
    companyIds: string[],
    from: Date,
    to: Date,
  ): Promise<DayAggregate> {
    const inTree = { in: companyIds };
    const [sessions, nfeIssued, nfeRejected, crmLeads, errors5xx] =
      await Promise.all([
        this.prisma.userSession.findMany({
          where: { companyId: inTree, createdAt: { gte: from, lt: to } },
          select: { userId: true },
          distinct: ['userId'],
        }),
        this.prisma.fiscalDocument.count({
          where: {
            companyId: inTree,
            status: FiscalStatus.AUTHORIZED,
            authorizedAt: { gte: from, lt: to },
          },
        }),
        this.prisma.fiscalDocument.count({
          where: {
            companyId: inTree,
            status: FiscalStatus.REJECTED,
            createdAt: { gte: from, lt: to },
          },
        }),
        this.prisma.lead.count({
          where: { companyId: inTree, createdAt: { gte: from, lt: to } },
        }),
        this.prisma.supportIncident.count({
          where: {
            companyId: inTree,
            source: SupportIncidentSource.AUTO_ERROR,
            createdAt: { gte: from, lt: to },
          },
        }),
      ]);

    return {
      activeUsers: sessions.length,
      nfeIssued,
      nfeRejected,
      crmLeads,
      errors5xx,
    };
  }
}
