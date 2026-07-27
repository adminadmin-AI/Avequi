import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  APP_SERVER_ERROR,
  ServerErrorEvent,
} from '../../common/events/server-error.event';
import {
  SUPPORT_INCIDENT_CAPTURED,
  SupportIncidentCapturedEvent,
  SupportService,
} from './support.service';
import { GithubIssueService } from './github-issue.service';

/**
 * Reações a eventos de suporte. Roda FORA do caminho da resposta (o filtro já
 * respondeu ao cliente) e é bulletproof: nenhum handler propaga erro.
 */
@Injectable()
export class SupportListener {
  private readonly logger = new Logger(SupportListener.name);

  constructor(
    private readonly support: SupportService,
    private readonly githubIssues: GithubIssueService,
  ) {}

  /** Captura automática de erros 5xx (#766). */
  @OnEvent(APP_SERVER_ERROR)
  async onServerError(evt: ServerErrorEvent): Promise<void> {
    try {
      await this.support.captureAutoError(evt);
    } catch (err) {
      this.logger.warn(
        `Falha ao capturar auto-erro (${evt.errorName}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * WP3 (#767): incidente capturado (USER_REPORT ou AUTO_ERROR) → issue
   * redigida no GitHub. Auto-erros deduplicados NÃO chegam aqui (o
   * SupportService só emite o evento quando cria de fato o incidente), então
   * não geram issue nova. O serviço já é fail-safe; o try/catch aqui é a
   * segunda camada — a criação de issue jamais afeta o fluxo do chamado.
   */
  @OnEvent(SUPPORT_INCIDENT_CAPTURED)
  async onIncidentCaptured(evt: SupportIncidentCapturedEvent): Promise<void> {
    try {
      await this.githubIssues.createForIncident(evt.incidentId);
    } catch (err) {
      this.logger.warn(
        `Falha ao criar issue GitHub (incidente ${evt.incidentId}): ${(err as Error).message}`,
      );
    }
  }
}
