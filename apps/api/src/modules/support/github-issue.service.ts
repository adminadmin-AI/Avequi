import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SupportIncident } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { redactPii } from './redact-pii';

/** Timeout curto — a criação da issue é fire-and-forget, não pode segurar nada. */
const GITHUB_TIMEOUT_MS = 10_000;

type IncidentWithCompany = SupportIncident & { company: { name: string } };

/**
 * WP3 (#767): espelha o incidente numa issue do GitHub — o artefato de
 * trabalho do TIME. O incidente segue sendo a fonte da verdade cliente-facing;
 * a issue leva só contexto REDIGIDO (ver redact-pii.ts) e nunca é exposta ao
 * cliente (`githubIssueNumber` fica fora do `select` do listMine).
 *
 * Fail-safe por design: sem `SUPPORT_GITHUB_TOKEN`/`SUPPORT_GITHUB_REPO`
 * configurados, ou diante de qualquer erro de rede, o serviço é um no-op
 * silencioso e NUNCA lança — o fluxo do chamado não depende dele.
 */
@Injectable()
export class GithubIssueService {
  private readonly logger = new Logger(GithubIssueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Cria (uma vez) a issue redigida do incidente e grava `githubIssueNumber`.
   * Retorna o número criado, ou `null` quando não há nada a fazer / falhou.
   * Idempotente: incidente que já tem `githubIssueNumber` não gera outra.
   */
  async createForIncident(incidentId: string): Promise<number | null> {
    const repo = this.config.get<string>('SUPPORT_GITHUB_REPO', '');
    const token = this.config.get<string>('SUPPORT_GITHUB_TOKEN', '');
    if (!repo || !token) {
      this.logger.debug('GitHub não configurado — issue não criada');
      return null;
    }

    try {
      const incident = (await this.prisma.supportIncident.findUnique({
        where: { id: incidentId },
        include: { company: { select: { name: true } } },
      })) as IncidentWithCompany | null;

      if (!incident) return null;
      // Idempotente: re-emissão do evento (ou retentativa) não duplica issue.
      if (incident.githubIssueNumber != null) return incident.githubIssueNumber;

      const label = `cliente:${this.tenantSlug(incident.company.name)}`;
      await this.ensureLabel(repo, token, label);

      const number = await this.postIssue(repo, token, incident, label);
      if (number == null) return null;

      await this.prisma.supportIncident.update({
        where: { id: incident.id },
        data: { githubIssueNumber: number },
      });
      this.logger.log(`Issue #${number} criada para ${incident.protocol}`);
      return number;
    } catch (err) {
      // Rede/GitHub fora do ar não pode derrubar o fluxo do incidente.
      this.logger.warn(
        `Falha ao criar issue GitHub (incidente ${incidentId}): ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** POST da issue. Retorna o número, ou `null` em resposta não-2xx. */
  private async postIssue(
    repo: string,
    token: string,
    incident: IncidentWithCompany,
    label: string,
  ): Promise<number | null> {
    const resumo = redactPii(incident.title).slice(0, 120);
    const res = await this.githubFetch(
      `https://api.github.com/repos/${repo}/issues`,
      token,
      {
        title: `[SUPORTE] ${incident.protocol} — ${resumo}`,
        body: this.buildBody(incident),
        labels: ['suporte', label],
      },
    );
    if (!res.ok) {
      this.logger.warn(
        `GitHub recusou a criação da issue (${res.status}) para ${incident.protocol}`,
      );
      return null;
    }
    const data = (await res.json()) as { number: number };
    return data.number;
  }

  /**
   * Garante que a label `cliente:<tenant>` exista antes de referenciá-la.
   * 422 = já existe (ignorado). Qualquer outra falha aqui não impede a issue:
   * o GitHub cria a label sozinho ao receber um nome novo na criação da issue.
   */
  private async ensureLabel(
    repo: string,
    token: string,
    name: string,
  ): Promise<void> {
    try {
      const res = await this.githubFetch(
        `https://api.github.com/repos/${repo}/labels`,
        token,
        { name, color: 'd4c5f9' },
      );
      if (!res.ok && res.status !== 422) {
        this.logger.debug(`Label "${name}" não criada (${res.status}) — segue.`);
      }
    } catch (err) {
      this.logger.debug(`Label "${name}" falhou: ${(err as Error).message} — segue.`);
    }
  }

  private githubFetch(
    url: string,
    token: string,
    body: unknown,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  }

  private buildBody(incident: IncidentWithCompany): string {
    const meta = [
      `**Protocolo:** ${incident.protocol}`,
      `**Tipo:** ${incident.source}`,
      incident.route && `**Rota:** ${incident.route}`,
      incident.appVersion && `**Versão:** ${incident.appVersion}`,
      incident.requestId && `**Request:** ${incident.requestId}`,
      incident.stackSignature && `**Assinatura:** ${incident.stackSignature}`,
    ].filter(Boolean);

    const description = incident.description
      ? `\n\n## Descrição (redigida)\n\n\`\`\`\n${redactPii(incident.description)}\n\`\`\``
      : '';

    return (
      `${meta.join('\n')}${description}\n\n` +
      `---\n_Issue gerada automaticamente pelo suporte (#767). PII redigida na ` +
      `origem — o GitHub nunca vê dado de cliente. Fonte da verdade ` +
      `cliente-facing: incidente ${incident.protocol}._`
    );
  }

  /** "GDR Reboques Ltda." → `gdr-reboques-ltda` (usado na label do tenant). */
  private tenantSlug(name: string): string {
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
