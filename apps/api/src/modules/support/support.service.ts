import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SupportIncidentSource, SupportIncidentStatus } from '@prisma/client';
import type { SupportIncident } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateIncidentDto } from './dto/create-incident.dto';

/** Evento consumido pelos WPs seguintes (ack e-mail #771, issue #767, triagem #768). */
export const SUPPORT_INCIDENT_CAPTURED = 'support.incident.captured';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /** Reportar um problema — protocolo #AVQ-N, status NEW, source USER_REPORT. */
  async createIncident(companyId: string, dto: CreateIncidentDto, userId: string) {
    const incident = await this.createWithProtocol(companyId, dto, userId);

    // Fan-out para os WPs seguintes. Sem listener ainda = no-op seguro.
    this.events.emit(SUPPORT_INCIDENT_CAPTURED, {
      incidentId: incident.id,
      companyId,
    });
    this.logger.log(`Chamado ${incident.protocol} aberto (company ${companyId})`);

    // Ack in-app: o cliente recebe o protocolo na hora.
    return {
      id: incident.id,
      protocol: incident.protocol,
      status: incident.status,
      createdAt: incident.createdAt,
    };
  }

  /**
   * Chamados do próprio usuário (self-service) com a timeline de status.
   * `select` explícito por PRIVACIDADE (épico #764): campos internos
   * (`diagnosis`, `stackSignature`, `githubIssueNumber`, `duplicateOfId`,
   * `source`, e `internalNote` das updates) NUNCA vão pro cliente — defesa no
   * backend, não só no tipo do front.
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

  /** Protocolo sequencial global; retenta em colisão de unique (P2002). */
  private async createWithProtocol(
    companyId: string,
    dto: CreateIncidentDto,
    userId: string,
    attempt = 0,
  ): Promise<SupportIncident> {
    const total = await this.prisma.supportIncident.count();
    const protocol = `AVQ-${String(total + 1 + attempt).padStart(6, '0')}`;
    try {
      return await this.prisma.supportIncident.create({
        data: {
          companyId,
          reportedById: userId,
          source: SupportIncidentSource.USER_REPORT,
          status: SupportIncidentStatus.NEW,
          protocol,
          title: dto.title,
          description: dto.description ?? null,
          route: dto.route ?? null,
          appVersion: dto.appVersion ?? null,
          requestId: dto.requestId ?? null,
        },
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'P2002' && attempt < 5) {
        return this.createWithProtocol(companyId, dto, userId, attempt + 1);
      }
      throw err;
    }
  }
}
