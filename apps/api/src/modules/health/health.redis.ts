import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Client Redis dedicado ao health check (#1102).
 *
 * UMA conexão por processo, criada sob demanda na primeira chamada e
 * reaproveitada em todas as seguintes — um monitor externo batendo de minuto
 * em minuto não pode abrir conexão nova a cada toque.
 *
 * As opções replicam as que o PermissionCacheService e o SessionDenylistService
 * já usam em produção, pelos mesmos motivos:
 *
 * - `enableOfflineQueue: false` — com o Redis fora, o comando falha na hora em
 *   vez de ficar enfileirado esperando reconexão. É o que garante que o health
 *   check responda rápido `down` em vez de pendurar a requisição.
 * - `maxRetriesPerRequest: 1` — sem retry longo dentro de um único PING.
 * - `retryStrategy` com backoff progressivo até 15s — impede o *reconnect
 *   storm*: com o Redis fora por muito tempo, o intervalo entre tentativas
 *   cresce em vez de martelar o servidor.
 * - handler de `error` OBRIGATÓRIO: sem ele o ioredis emite um erro não tratado
 *   e derruba o processo. O health check jamais pode matar a API que ele mede.
 */
@Injectable()
export class HealthRedis implements OnModuleDestroy {
  private readonly logger = new Logger(HealthRedis.name);
  private client: Redis | null = null;
  /** Criação falhou de forma irrecuperável — não tenta de novo. */
  private clientFailed = false;
  /** Evita repetir o mesmo aviso a cada checagem enquanto o Redis está fora. */
  private warnedUnavailable = false;

  constructor(private readonly config: ConfigService) {}

  private getClient(): Redis | null {
    if (this.client) return this.client;
    if (this.clientFailed) return null;
    try {
      const url = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
      this.client = new Redis(url, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2000,
        lazyConnect: false,
        retryStrategy: (times) => Math.min(times * 1000, 15_000),
      });
      this.client.on('error', (err) => {
        if (!this.warnedUnavailable) {
          this.warnedUnavailable = true;
          // Só a mensagem, no log da aplicação — nunca na resposta HTTP (#1102).
          this.logger.warn(`Redis indisponível para o health check: ${err.message}`);
        }
      });
      this.client.on('ready', () => {
        this.warnedUnavailable = false;
      });
    } catch (err) {
      this.clientFailed = true;
      this.client = null;
      this.logger.warn(`Falha ao criar client Redis do health check: ${(err as Error).message}`);
    }
    return this.client;
  }

  /** `PING` no Redis. Nunca lança: devolve `false` em qualquer falha. */
  async ping(): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;
    try {
      return (await client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client?.quit();
    } catch {
      /* encerramento best-effort */
    }
    this.client = null;
  }
}
