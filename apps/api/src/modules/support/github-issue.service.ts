import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SupportIncident } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { redactPii } from './redact-pii';
import { githubPost } from './github-fetch';
import type { TriageDiagnosis } from './support.types';

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
    return githubPost(url, token, body, GITHUB_TIMEOUT_MS);
  }

  /**
   * WP4 (#768): posta o diagnóstico da triagem como comentário na issue do
   * incidente. Comentário é interno do time — mas texto livre vindo do LLM
   * (causa provável, passo self-service, fix sugerido) ainda passa pelo
   * `redactPii` antes de sair (decisão travada do épico: nada não-redigido
   * cruza para o GitHub). Fail-safe: sem config, issue ausente, ou erro de
   * rede, é no-op silencioso e nunca lança.
   */
  async commentDiagnosis(
    issueNumber: number,
    diagnosis: TriageDiagnosis,
  ): Promise<boolean> {
    const repo = this.config.get<string>('SUPPORT_GITHUB_REPO', '');
    const token = this.config.get<string>('SUPPORT_GITHUB_TOKEN', '');
    if (!repo || !token) {
      this.logger.debug('GitHub não configurado — comentário de triagem não postado');
      return false;
    }
    try {
      const res = await this.githubFetch(
        `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`,
        token,
        { body: this.buildDiagnosisComment(diagnosis) },
      );
      if (!res.ok) {
        this.logger.warn(
          `GitHub recusou o comentário de triagem (${res.status}) na issue #${issueNumber}`,
        );
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(
        `Falha ao comentar triagem na issue #${issueNumber}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /** Markdown do comentário de triagem — texto livre do LLM sempre redigido. */
  private buildDiagnosisComment(d: TriageDiagnosis): string {
    const flag = d.needsHuman ? '🔴 **PRECISA DE HUMANO**' : '🟢 auto-resolúvel';
    const conf = `${Math.round(d.confidence * 100)}%`;
    const files = d.files.length
      ? d.files
          .map((f) => `- \`${f.path}:${f.line}\` — ${redactPii(f.reason)}`)
          .join('\n')
      : '_nenhum arquivo apontado_';
    const lines = [
      `## 🤖 Triagem automática (#768)`,
      ``,
      `**Severidade:** ${d.severity} · **Confiança:** ${conf} · ${flag}`,
      `**Módulo:** ${d.module}`,
      d.isDuplicateOf ? `**Duplicado de:** ${d.isDuplicateOf}` : null,
      ``,
      `### Causa provável`,
      redactPii(d.probableCause),
      ``,
      `### Arquivos suspeitos`,
      files,
      d.suggestedFix
        ? `\n### Correção sugerida\n${redactPii(d.suggestedFix)}`
        : null,
      d.safeSelfServiceStep
        ? `\n### Passo seguro de self-service\n${redactPii(d.safeSelfServiceStep)}`
        : null,
      ``,
      `---`,
      `_Diagnóstico gerado por LLM repo-aware. PII redigida na origem. ` +
        `Fonte da verdade cliente-facing: o incidente (diagnóstico é interno)._`,
    ].filter((l) => l !== null);
    return lines.join('\n');
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
