import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Cache Redis do PermissionService — issue #340 (Fase F3.1/M2).
 *
 * Implementa a Decisão 2 da arquitetura (docs/iam/ARQUITETURA-IAM-V2.md):
 * permissões resolvidas do banco, cacheadas no Redis com TTL de 5 minutos
 * MAIS invalidação ativa (todo grant/revoke deleta a chave imediatamente —
 * o TTL é só a rede de segurança).
 *
 * FALLBACK GRACIOSO (regra de ouro): Redis fora do ar NUNCA bloqueia um
 * request. Toda operação aqui é best-effort — em erro, `get` devolve `null`
 * (o PermissionService resolve direto no banco) e as escritas viram no-op.
 * Segurança não depende do cache; o cache só acelera.
 *
 * Chave: `iam:perms:{companyId}:{userId}` → JSON de CachedPermissionSet.
 */

/** TTL do cache de permissões (5 minutos — Decisão 2 da arquitetura). */
export const PERMISSION_CACHE_TTL_SECONDS = 300;

const KEY_PREFIX = 'iam:perms:';
const SCOPE_KEY_PREFIX = 'iam:scope:';

/** Payload versionado gravado no Redis (v permite migrar o formato sem lixo). */
export interface CachedPermissionSet {
  v: 1;
  /** Codes dos perfis DIRETAMENTE atribuídos ao usuário (sem herança). */
  roles: string[];
  /** Codes de permissão EFETIVOS (herança + exceções já aplicadas). */
  permissions: string[];
}

/**
 * Escopo de dados cacheado (#347-B). Mesmo ciclo de vida do cache de
 * permissões: TTL 5 min + invalidação ativa nos mesmos pontos (grant/revoke
 * de assignment muda os DOIS). Mudança de vínculo depósito→filial
 * (Warehouse.branchId) é cadastro raro de admin — o TTL cobre.
 */
export interface CachedScope {
  v: 1;
  level: 'COMPANY' | 'BRANCH' | 'OWN';
  branchIds: string[];
  warehouseIds: string[];
}

@Injectable()
export class PermissionCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(PermissionCacheService.name);
  private client: Redis | null = null;
  private clientFailed = false;
  private warnedUnavailable = false;

  constructor(private readonly config: ConfigService) {}

  /**
   * Cria o client sob demanda. `enableOfflineQueue: false` faz comandos
   * falharem IMEDIATAMENTE quando o Redis está fora (em vez de enfileirar e
   * travar o request esperando reconexão) — essencial para o fallback.
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
      // Sem handler de 'error' o ioredis derruba o processo (unhandled error).
      this.client.on('error', (err) => {
        if (!this.warnedUnavailable) {
          this.warnedUnavailable = true;
          this.logger.warn(
            `Redis indisponível para cache de permissões (fallback: banco). Motivo: ${err.message}`,
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
        `Falha ao criar client Redis (cache de permissões desativado): ${(err as Error).message}`,
      );
    }
    return this.client;
  }

  private key(companyId: string, userId: string): string {
    return `${KEY_PREFIX}${companyId}:${userId}`;
  }

  private scopeKey(companyId: string, userId: string): string {
    return `${SCOPE_KEY_PREFIX}${companyId}:${userId}`;
  }

  /** Lê o escopo cacheado (#347-B). `null` = miss OU Redis indisponível. */
  async getScope(companyId: string, userId: string): Promise<CachedScope | null> {
    const client = this.getClient();
    if (!client) return null;
    try {
      const raw = await client.get(this.scopeKey(companyId, userId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedScope;
      if (
        parsed?.v !== 1 ||
        !['COMPANY', 'BRANCH', 'OWN'].includes(parsed.level) ||
        !Array.isArray(parsed.branchIds) ||
        !Array.isArray(parsed.warehouseIds)
      ) {
        return null; // formato desconhecido → trata como miss
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /** Grava o escopo com o mesmo TTL das permissões. Best-effort. */
  async setScope(companyId: string, userId: string, value: CachedScope): Promise<void> {
    const client = this.getClient();
    if (!client) return;
    try {
      await client.set(
        this.scopeKey(companyId, userId),
        JSON.stringify(value),
        'EX',
        PERMISSION_CACHE_TTL_SECONDS,
      );
    } catch {
      // best-effort
    }
  }

  /** Lê o conjunto cacheado. `null` = cache miss OU Redis indisponível. */
  async get(companyId: string, userId: string): Promise<CachedPermissionSet | null> {
    const client = this.getClient();
    if (!client) return null;
    try {
      const raw = await client.get(this.key(companyId, userId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedPermissionSet;
      if (parsed?.v !== 1 || !Array.isArray(parsed.permissions) || !Array.isArray(parsed.roles)) {
        return null; // formato desconhecido → trata como miss
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /** Grava o conjunto com TTL de 5 min. Best-effort (erro = no-op). */
  async set(companyId: string, userId: string, value: CachedPermissionSet): Promise<void> {
    const client = this.getClient();
    if (!client) return;
    try {
      await client.set(
        this.key(companyId, userId),
        JSON.stringify(value),
        'EX',
        PERMISSION_CACHE_TTL_SECONDS,
      );
    } catch {
      // best-effort
    }
  }

  /** Invalida os caches (permissões + escopo) de UM usuário em UMA empresa. */
  async del(companyId: string, userId: string): Promise<void> {
    const client = this.getClient();
    if (!client) return;
    try {
      await client.del(this.key(companyId, userId), this.scopeKey(companyId, userId));
    } catch {
      // best-effort
    }
  }

  /** Invalida os caches de um usuário em TODAS as empresas. */
  async delUserAllCompanies(userId: string): Promise<void> {
    await this.delByPattern(`${KEY_PREFIX}*:${userId}`);
    await this.delByPattern(`${SCOPE_KEY_PREFIX}*:${userId}`);
  }

  /** Invalida os caches de TODOS os usuários de uma empresa. */
  async delCompany(companyId: string): Promise<void> {
    await this.delByPattern(`${KEY_PREFIX}${companyId}:*`);
    await this.delByPattern(`${SCOPE_KEY_PREFIX}${companyId}:*`);
  }

  /** SCAN incremental (nunca KEYS — bloqueia o Redis) + DEL em lotes. */
  private async delByPattern(pattern: string): Promise<void> {
    const client = this.getClient();
    if (!client) return;
    try {
      let cursor = '0';
      do {
        const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        if (keys.length > 0) await client.del(...keys);
      } while (cursor !== '0');
    } catch {
      // best-effort: o TTL de 5 min é a rede de segurança
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
