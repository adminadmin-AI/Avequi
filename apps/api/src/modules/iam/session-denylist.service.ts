import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Denylist Redis de sessões — issue #342 (Fase F3.3/M4).
 *
 * Implementa a válvula de revogação imediata da Decisão 4 (token híbrido,
 * docs/iam/ARQUITETURA-IAM-V2.md): o access token JWT é stateless (15 min) e
 * carrega o claim `sessionId`; quando uma sessão é revogada CRITICAMENTE
 * (admin revoke, lockout, evento de segurança), o sessionId entra aqui com
 * TTL = vida restante do access token (~15 min). Assim o token deixa de valer
 * IMEDIATAMENTE em vez de sobreviver até expirar.
 *
 * QUEM CONSOME: o JwtAuthGuard vai chamar `isSessionDenylisted(sessionId)` na
 * issue #341 (Onda B) — um GET no Redis por request, nunca query no banco.
 * NESTA fase o guard NÃO é alterado (evita conflito com PRs pendentes); o
 * método fica exposto e pronto.
 *
 * FALLBACK GRACIOSO (mesma regra do PermissionCacheService): Redis fora do ar
 * NUNCA derruba login/request. `deny` vira no-op e `isSessionDenylisted`
 * devolve `false` (fail-open consciente: a janela volta a ser os 15 min do
 * access token — exatamente o comportamento pré-denylist, nunca pior).
 *
 * Chave: `iam:session-denylist:{sessionId}` → "1" com TTL.
 */

/** TTL padrão = vida do access token (15 min — JWT_EXPIRY). */
export const SESSION_DENYLIST_TTL_SECONDS = 15 * 60;

const KEY_PREFIX = 'iam:session-denylist:';

@Injectable()
export class SessionDenylistService implements OnModuleDestroy {
  private readonly logger = new Logger(SessionDenylistService.name);
  private client: Redis | null = null;
  private clientFailed = false;
  private warnedUnavailable = false;

  constructor(private readonly config: ConfigService) {}

  /**
   * Client sob demanda. `enableOfflineQueue: false` faz comandos falharem
   * IMEDIATAMENTE com Redis fora (em vez de enfileirar e travar o request).
   */
  private getClient(): Redis | null {
    if (this.client) return this.client;
    if (this.clientFailed) return null;
    try {
      const url = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
      this.client = new Redis(url, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2000,
        retryStrategy: (times) => Math.min(times * 1000, 15_000),
      });
      this.client.on('error', (err) => {
        if (!this.warnedUnavailable) {
          this.warnedUnavailable = true;
          this.logger.warn(
            `Redis indisponível para denylist de sessões (fail-open: janela = TTL do access token). Motivo: ${err.message}`,
          );
        }
      });
      this.client.on('ready', () => {
        this.warnedUnavailable = false;
      });
    } catch (err) {
      this.clientFailed = true;
      this.client = null;
      this.logger.warn(
        `Falha ao criar client Redis (denylist de sessões desativada): ${(err as Error).message}`,
      );
    }
    return this.client;
  }

  private key(sessionId: string): string {
    return `${KEY_PREFIX}${sessionId}`;
  }

  /**
   * Coloca a sessão na denylist. TTL = vida restante do access token
   * (default 15 min — não precisa ser mais que isso: depois o token expira
   * sozinho). Best-effort: erro = no-op logado.
   */
  async deny(sessionId: string, ttlSeconds: number = SESSION_DENYLIST_TTL_SECONDS): Promise<void> {
    const client = this.getClient();
    if (!client) return;
    try {
      await client.set(this.key(sessionId), '1', 'EX', ttlSeconds);
    } catch {
      // best-effort — fail-open documentado no header
    }
  }

  /**
   * Consulta para o JwtAuthGuard (#341): a sessão do access token foi
   * revogada criticamente? Redis fora do ar → `false` (fail-open).
   */
  async isSessionDenylisted(sessionId: string): Promise<boolean> {
    if (!sessionId) return false;
    const client = this.getClient();
    if (!client) return false;
    try {
      const hit = await client.get(this.key(sessionId));
      return hit !== null;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      try {
        this.client.disconnect();
      } catch {
        // encerrando de qualquer forma
      }
      this.client = null;
    }
  }
}
