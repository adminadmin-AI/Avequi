import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Denylist Redis de sessões — issue #342 (Fase F3.3/M4).
 *
 * Implementa a válvula de revogação imediata da Decisão 4 (token híbrido,
 * docs/iam/ARQUITETURA-IAM-V2.md): o access token JWT é stateless e carrega o
 * claim `sessionId`; quando uma sessão é revogada CRITICAMENTE (inativação,
 * troca de senha, reset por admin, admin revoke), o sessionId entra aqui com
 * TTL = vida do access token. Assim o token deixa de valer IMEDIATAMENTE em
 * vez de sobreviver até expirar.
 *
 * QUEM CONSOME (#823): a JwtStrategy chama `isSessionDenylisted(sessionId)`
 * na validação de TODO access token normal com claim sessionId — um GET no
 * Redis por request autenticada, nunca query no banco. Sessão denylistada →
 * 401 antes de Company/Roles/PermissionGuard e do controller. Token legado
 * sem sessionId (transição M4) não consulta — expira naturalmente.
 *
 * FALLBACK GRACIOSO (mesma regra do PermissionCacheService): Redis fora do ar
 * NUNCA derruba login/request. `deny` vira no-op e `isSessionDenylisted`
 * devolve `false` (fail-open consciente: a janela volta a ser a vida restante
 * do access token — exatamente o comportamento pré-denylist, nunca pior; o
 * refresh segue bloqueado pelos mecanismos persistentes). A falha NÃO é
 * silenciosa: log estruturado ERROR uma vez por indisponibilidade (nunca
 * loga JWT/sessionId completo).
 *
 * Chave: `iam:session-denylist:{sessionId}` → "1" com TTL.
 */

/** Fallback do TTL = vida default do access token (15 min — JWT_EXPIRY). */
export const SESSION_DENYLIST_TTL_SECONDS = 15 * 60;

const KEY_PREFIX = 'iam:session-denylist:';

/**
 * Converte JWT_EXPIRY em segundos, cobrindo EXATAMENTE os formatos que o
 * Joi do boot permite (env.validation.ts: /^\d+(ms|s|m|h|d|w|y)?$/) — se o
 * parser cobrisse menos que o Joi, um formato válido (ex.: '2w') cairia no
 * fallback e o TTL subcobriria o token. Sem unidade = segundos (superset
 * seguro do ms() do jsonwebtoken, que lê número puro como milissegundos —
 * errar para MAIS nunca subcobre). Formato fora do Joi → fallback de 15 min
 * (inalcançável em produção: o boot rejeita). Exportada para o teste que
 * trava a invariante TTL ≥ vida do access token.
 */
export function parseExpiryToSeconds(
  expiry: string | undefined,
  fallback: number = SESSION_DENYLIST_TTL_SECONDS,
): number {
  if (!expiry) return fallback;
  const match = /^(\d+)\s*(ms|s|m|h|d|w|y)?$/.exec(String(expiry).trim());
  if (!match) return fallback;
  const value = parseInt(match[1], 10);
  const unit = (match[2] ?? 's') as 'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'y';
  const factor = { ms: 1 / 1000, s: 1, m: 60, h: 3600, d: 86400, w: 604800, y: 31536000 }[unit];
  return Math.ceil(value * factor);
}

@Injectable()
export class SessionDenylistService implements OnModuleDestroy {
  private readonly logger = new Logger(SessionDenylistService.name);
  private client: Redis | null = null;
  private clientFailed = false;
  private warnedUnavailable = false;
  /** TTL efetivo: acompanha o JWT_EXPIRY configurado (nunca menor que ele). */
  private readonly ttlSeconds: number;

  constructor(private readonly config: ConfigService) {
    // O TTL precisa cobrir a vida INTEIRA do access token: um token emitido
    // imediatamente antes da revogação vive JWT_EXPIRY segundos. TTL fixo de
    // 15 min subcobriria um JWT_EXPIRY configurado maior (ex.: '1h').
    this.ttlSeconds = Math.max(
      parseExpiryToSeconds(this.config.get<string>('JWT_EXPIRY')),
      SESSION_DENYLIST_TTL_SECONDS,
    );
  }

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
        this.reportUnavailable(err.message);
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

  /**
   * Log estruturado ERROR, uma vez por indisponibilidade (o 'ready' rearma).
   * Nunca inclui JWT, sessionId ou dado sensível — só o motivo técnico.
   */
  private reportUnavailable(message: string): void {
    if (this.warnedUnavailable) return;
    this.warnedUnavailable = true;
    this.logger.error(
      JSON.stringify({
        event: 'session_denylist_unavailable',
        effect: 'fail-open: janela = expiração natural do access token; refresh segue bloqueado',
        message,
      }),
    );
  }

  private key(sessionId: string): string {
    return `${KEY_PREFIX}${sessionId}`;
  }

  /**
   * Coloca a sessão na denylist. TTL default = vida do access token derivada
   * do JWT_EXPIRY (não precisa ser mais que isso: depois o token expira
   * sozinho). Best-effort: erro = no-op com log estruturado (fail-open).
   */
  async deny(sessionId: string, ttlSeconds: number = this.ttlSeconds): Promise<void> {
    const client = this.getClient();
    if (!client) return;
    try {
      await client.set(this.key(sessionId), '1', 'EX', ttlSeconds);
    } catch (err) {
      this.reportUnavailable((err as Error).message);
    }
  }

  /**
   * Consulta da JwtStrategy (#823): a sessão do access token foi revogada
   * criticamente? Redis fora do ar → `false` (fail-open com log ERROR).
   */
  async isSessionDenylisted(sessionId: string): Promise<boolean> {
    if (!sessionId) return false;
    const client = this.getClient();
    if (!client) return false;
    try {
      const hit = await client.get(this.key(sessionId));
      return hit !== null;
    } catch (err) {
      this.reportUnavailable((err as Error).message);
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
