import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  APP_SERVER_ERROR,
  ServerErrorEvent,
} from '../../common/events/server-error.event';
import { SupportService } from './support.service';

/**
 * Captura automática de erros 5xx (#766). Roda FORA do caminho da resposta
 * (o filtro já respondeu ao cliente) e é bulletproof: nunca propaga erro.
 */
@Injectable()
export class SupportListener {
  private readonly logger = new Logger(SupportListener.name);

  constructor(private readonly support: SupportService) {}

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
}
