import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ENTITLEMENTS_CATALOG,
  ENTITLEMENT_KEYS,
  EntitlementValue,
} from './entitlements.catalog';

/**
 * EntitlementService — OPS WP4 (#911): o que ESTA CONTA contratou.
 *
 * Resolução por key (sempre na empresa RAIZ do tenant):
 *   override do tenant  >  plano  >  default DESLIGADO (fail-closed)
 *
 * EXCEÇÃO DE MIGRAÇÃO: tenant SEM plano (planId null) = LEGADO → tudo
 * liberado e sem limites. Racional: GDR/CRD rodam hoje sem plano; fail-closed
 * aqui derrubaria módulos em produção no deploy. O caminho é o operador
 * atribuir plano no portal; a partir daí a resolução normal (fail-closed)
 * assume. Keys desconhecidas são SEMPRE desligadas, com ou sem plano.
 *
 * Cache: em memória com TTL de 60s + invalidação ativa nas escritas do ops.
 * Racional: mudança de plano é evento raro; 60s de propagação entre
 * instâncias cumpre o "muda sem redeploy" sem arrastar Redis pra cá.
 */

export interface ResolvedEntitlements {
  /** null = tenant legado sem plano (tudo liberado) */
  planCode: string | null;
  values: Record<string, EntitlementValue>;
  legacy: boolean;
}

const CACHE_TTL_MS = 60_000;

@Injectable()
export class EntitlementService {
  private readonly logger = new Logger(EntitlementService.name);
  private readonly cache = new Map<
    string,
    { resolved: ResolvedEntitlements; expiresAt: number }
  >();

  constructor(private readonly prisma: PrismaService) {}

  /** Resolve o mapa efetivo do tenant de um companyId qualquer (raiz ou filial). */
  async resolve(companyId: string): Promise<ResolvedEntitlements> {
    const rootId = await this.rootIdOf(companyId);
    const hit = this.cache.get(rootId);
    if (hit && hit.expiresAt > Date.now()) return hit.resolved;

    const root = await this.prisma.company.findUniqueOrThrow({
      where: { id: rootId },
      select: {
        plan: { select: { code: true, entitlements: true, active: true } },
        entitlementOverrides: { select: { key: true, value: true } },
      },
    });

    let resolved: ResolvedEntitlements;
    if (!root.plan) {
      // LEGADO: sem plano = comportamento pré-WP4 (tudo liberado, sem limite)
      const values: Record<string, EntitlementValue> = {};
      for (const def of ENTITLEMENTS_CATALOG) {
        values[def.key] = def.type === 'bool' ? true : null;
      }
      resolved = { planCode: null, values, legacy: true };
    } else {
      const planMap = (root.plan.entitlements ?? {}) as Record<string, EntitlementValue>;
      const values: Record<string, EntitlementValue> = {};
      for (const def of ENTITLEMENTS_CATALOG) {
        // default fail-closed: bool → false; limit → 0
        values[def.key] = def.type === 'bool' ? false : 0;
        if (def.key in planMap) values[def.key] = planMap[def.key];
      }
      for (const o of root.entitlementOverrides) {
        if (ENTITLEMENT_KEYS.has(o.key)) {
          values[o.key] = o.value as EntitlementValue;
        }
        // key fora do catálogo no banco: ignorada (fail-closed) — o catálogo
        // em código é a fonte da verdade, igual ao permissions.catalog
      }
      resolved = { planCode: root.plan.code, values, legacy: false };
    }

    this.cache.set(rootId, { resolved, expiresAt: Date.now() + CACHE_TTL_MS });
    return resolved;
  }

  /** Módulo ligado para a conta? Key desconhecida → false (fail-closed). */
  async can(companyId: string, key: string): Promise<boolean> {
    if (!ENTITLEMENT_KEYS.has(key)) return false;
    const { values } = await this.resolve(companyId);
    return values[key] === true;
  }

  /** Limite numérico da conta. null = ilimitado; key desconhecida → 0. */
  async limit(companyId: string, key: string): Promise<number | null> {
    if (!ENTITLEMENT_KEYS.has(key)) return 0;
    const { values } = await this.resolve(companyId);
    const v = values[key];
    if (v === null) return null;
    return typeof v === 'number' ? v : 0;
  }

  /** Invalidação ativa — chamada pelas escritas do ops (plano/override). */
  invalidate(rootCompanyId: string): void {
    this.cache.delete(rootCompanyId);
  }

  /** Raiz do tenant (1 hop — árvore MATRIZ→FILIAL). */
  private async rootIdOf(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { id: true, parentId: true },
    });
    return company.parentId ?? company.id;
  }
}
