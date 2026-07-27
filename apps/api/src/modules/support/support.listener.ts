import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bull';
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
import { TRIAGE_QUEUE, TriageJobData } from './support.types';

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
    @InjectQueue(TRIAGE_QUEUE) private readonly triageQueue: Queue<TriageJobData>,
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

    // WP4 (#768): segunda camada — enfileira a triagem repo-aware. Try/catch
    // próprio para NUNCA afetar o fluxo do chamado nem a criação da issue.
    try {
      await this.triageQueue.add(
        { incidentId: evt.incidentId },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 500,
          removeOnFail: 100,
        },
      );
    } catch (err) {
      this.logger.warn(
        `Falha ao enfileirar triagem (incidente ${evt.incidentId}): ${(err as Error).message}`,
      );
    }
  }
}
