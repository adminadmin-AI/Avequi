import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bull';
import { SupportIncidentStatus } from '@prisma/client';
import type { SupportIncident } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { redactPii } from './redact-pii';
import { githubPost } from './github-fetch';
import { TRIAGE_QUEUE, TriageJobData } from './support.types';

type IncidentWithCompany = SupportIncident & { company: { name: string } };

/** Enquanto ativos, incidentes de mesma rota entram no contexto "recentSimilar". */
const ACTIVE_STATUSES: SupportIncidentStatus[] = [
  SupportIncidentStatus.NEW,
  SupportIncidentStatus.TRIAGING,
  SupportIncidentStatus.TRIAGED,
  SupportIncidentStatus.IN_PROGRESS,
];

/**
 * WP4 (#768) — dispara o runner repo-aware. NÃO chama o LLM aqui: apenas monta
 * o `client_payload` REDIGIDO e faz um `repository_dispatch` na GitHub Action
 * (`support-triage.yml`), que roda o `scripts/support-triage.mjs` com acesso ao
 * código do repo. O write-back volta assinado pelo endpoint PATCH.
 *
 * ⭐ PII: NADA cruza para o GitHub/LLM sem `redactPii`. O stack completo NUNCA
 * sai — só o `stackSignature`. Fail-safe: sem envs, é no-op logado; erro de
 * rede não propaga (Bull reprocessa via `attempts`).
 */
@Processor(TRIAGE_QUEUE)
export class TriageProcessor {
  private readonly logger = new Logger(TriageProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Process()
  async handleTriage(job: Job<TriageJobData>): Promise<void> {
    const { incidentId } = job.data;
    const repo = this.config.get<string>('SUPPORT_GITHUB_REPO', '');
    const token = this.config.get<string>('SUPPORT_GITHUB_TOKEN', '');
    if (!repo || !token) {
      this.logger.debug(
        `GitHub não configurado — triagem do incidente ${incidentId} é no-op`,
      );
      return;
    }

    const incident = (await this.prisma.supportIncident.findUnique({
      where: { id: incidentId },
      include: { company: { select: { name: true } } },
    })) as IncidentWithCompany | null;
    if (!incident) {
      this.logger.warn(`Triagem: incidente ${incidentId} não encontrado`);
      return;
    }

    const recentSimilar = await this.findRecentSimilar(incident);
    const clientPayload = {
      incidentId: incident.id,
      protocol: incident.protocol,
      // Nome do tenant redigido por precaução (razão social raramente casa PII).
      tenant: redactPii(incident.company.name),
      route: incident.route ?? null,
      appVersion: incident.appVersion ?? null,
      requestId: incident.requestId ?? null,
      // Só a assinatura normalizada — o stack completo NUNCA sai.
      stackSignature: incident.stackSignature ?? null,
      description: incident.description ? redactPii(incident.description) : null,
      recentSimilar,
    };

    const res = await githubPost(
      `https://api.github.com/repos/${repo}/dispatches`,
      token,
      { event_type: 'support-triage', client_payload: clientPayload },
    );
    if (!res.ok) {
      // Lança para o Bull reprocessar (attempts/backoff) — 5xx transitório do GitHub.
      throw new Error(
        `repository_dispatch recusado (${res.status}) para ${incident.protocol}`,
      );
    }
    this.logger.log(
      `Triagem disparada (repository_dispatch) para ${incident.protocol}`,
    );
  }

  /**
   * Até 5 incidentes ATIVOS de mesma rota (proxy de "mesmo módulo"), exceto o
   * próprio — contexto de dedup pro LLM. Só `{protocol, title REDIGIDO}` sai.
   */
  private async findRecentSimilar(
    incident: IncidentWithCompany,
  ): Promise<Array<{ protocol: string; title: string }>> {
    if (!incident.route) return [];
    const rows = await this.prisma.supportIncident.findMany({
      where: {
        route: incident.route,
        status: { in: ACTIVE_STATUSES },
        id: { not: incident.id },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { protocol: true, title: true },
    });
    return rows.map((r) => ({
      protocol: r.protocol,
      title: redactPii(r.title),
    }));
  }
}
