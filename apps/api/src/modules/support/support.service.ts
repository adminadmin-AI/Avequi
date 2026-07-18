import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash } from 'crypto';
import { SupportIncidentSource, SupportIncidentStatus } from '@prisma/client';
import type { SupportIncident } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import type { ServerErrorEvent } from '../../common/events/server-error.event';

/** Evento consumido pelos WPs seguintes (ack e-mail #771, issue #767, triagem #768). */
export const SUPPORT_INCIDENT_CAPTURED = 'support.incident.captured';

/** Enquanto existir um incidente nestes status, um 5xx de mesma assinatura é dedup. */
const ACTIVE_STATUSES: SupportIncidentStatus[] = [
  SupportIncidentStatus.NEW,
  SupportIncidentStatus.TRIAGING,
  SupportIncidentStatus.TRIAGED,
  SupportIncidentStatus.IN_PROGRESS,
];

interface IncidentInput {
  companyId: string;
  source: SupportIncidentSource;
  reportedById: string | null;
  title: string;
  description?: string | null;
  route?: string | null;
  appVersion?: string | null;
  requestId?: string | null;
  stackSignature?: string | null;
}

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /** Reportar um problema (usuário) — protocolo #AVQ-N, status NEW, source USER_REPORT. */
  async createIncident(companyId: string, dto: CreateIncidentDto, userId: string) {
    const incident = await this.createIncidentRecord({
      companyId,
      source: SupportIncidentSource.USER_REPORT,
      reportedById: userId,
      title: dto.title,
      description: dto.description ?? null,
      route: dto.route ?? null,
      appVersion: dto.appVersion ?? null,
      requestId: dto.requestId ?? null,
    });

    this.events.emit(SUPPORT_INCIDENT_CAPTURED, {
      incidentId: incident.id,
      companyId,
    });
    this.logger.log(`Chamado ${incident.protocol} aberto (company ${companyId})`);

    return {
      id: incident.id,
      protocol: incident.protocol,
      status: incident.status,
      createdAt: incident.createdAt,
    };
  }

  /**
   * Captura automática de erro 5xx (#766). Chamado por um listener FORA do
   * caminho da resposta. Dedup por assinatura de stack: enquanto houver um
   * incidente ATIVO de mesma assinatura para o tenant, não cria outro (não vira
   * spam). Erro sem tenant (companyId ausente) é ignorado nesta fase.
   */
  async captureAutoError(evt: ServerErrorEvent): Promise<void> {
    if (!evt.companyId) return;

    const stackSignature = this.computeStackSignature(
      evt.errorName,
      evt.errorMessage,
      evt.stack,
    );

    const dup = await this.prisma.supportIncident.findFirst({
      where: {
        companyId: evt.companyId,
        stackSignature,
        status: { in: ACTIVE_STATUSES },
      },
      select: { id: true },
    });
    if (dup) {
      this.logger.debug(`5xx recorrente deduplicado (sig ${stackSignature.slice(0, 8)})`);
      return;
    }

    const incident = await this.createIncidentRecord({
      companyId: evt.companyId,
      source: SupportIncidentSource.AUTO_ERROR,
      reportedById: null,
      stackSignature,
      title: `[auto] ${evt.errorName}: ${evt.errorMessage}`.slice(0, 160),
      description: evt.stack?.slice(0, 4000) ?? null,
      route: evt.route ?? null,
      requestId: evt.requestId ?? null,
    });

    this.events.emit(SUPPORT_INCIDENT_CAPTURED, {
      incidentId: incident.id,
      companyId: evt.companyId,
    });
    this.logger.warn(
      `Auto-erro ${incident.protocol} capturado (${evt.errorName}) company ${evt.companyId}`,
    );
  }

  /**
   * Chamados do próprio usuário (self-service) com a timeline de status.
   * `select` explícito por PRIVACIDADE (#764): campos internos (`diagnosis`,
   * `stackSignature`, `githubIssueNumber`, `duplicateOfId`, `source`, e
   * `internalNote` das updates) NUNCA vão pro cliente.
   */
  listMine(companyId: string, userId: string) {
    return this.prisma.supportIncident.findMany({
      where: { companyId, reportedById: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        companyId: true,
        protocol: true,
        title: true,
        description: true,
        route: true,
        appVersion: true,
        requestId: true,
        status: true,
        severity: true,
        createdAt: true,
        updatedAt: true,
        updates: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            incidentId: true,
            status: true,
            clientNote: true,
            createdAt: true,
          },
        },
      },
    });
  }

  // ─── interno ───────────────────────────────────────────────────────────────

  /** Cria o registro com protocolo sequencial global; retenta em colisão (P2002). */
  private async createIncidentRecord(
    input: IncidentInput,
    attempt = 0,
  ): Promise<SupportIncident> {
    const total = await this.prisma.supportIncident.count();
    const protocol = `AVQ-${String(total + 1 + attempt).padStart(6, '0')}`;
    try {
      return await this.prisma.supportIncident.create({
        data: {
          companyId: input.companyId,
          reportedById: input.reportedById,
          source: input.source,
          status: SupportIncidentStatus.NEW,
          protocol,
          title: input.title,
          description: input.description ?? null,
          route: input.route ?? null,
          appVersion: input.appVersion ?? null,
          requestId: input.requestId ?? null,
          stackSignature: input.stackSignature ?? null,
        },
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'P2002' && attempt < 5) {
        return this.createIncidentRecord(input, attempt + 1);
      }
      throw err;
    }
  }

  /**
   * Assinatura normalizada do erro para dedup — remove caminhos, números de
   * linha/coluna e ids/hex que variam entre ocorrências do MESMO bug.
   */
  private computeStackSignature(
    name: string,
    message: string,
    stack?: string,
  ): string {
    const topFrames = (stack ?? '')
      .split('\n')
      .slice(1, 6)
      .map((l) =>
        l
          .replace(/\/[^\s:)]+/g, '')
          .replace(/:\d+:\d+/g, '')
          .trim(),
      )
      .join('|');
    const normMsg = message.replace(/[0-9a-f]{8,}/gi, '#').replace(/\d+/g, '#');
    return createHash('sha256')
      .update(`${name}|${normMsg}|${topFrames}`)
      .digest('hex')
      .slice(0, 32);
  }
}
