import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionCacheService } from './permission-cache.service';
import { companyScope, EffectiveScope } from './scope';
import {
  ENUM_ROLE_TO_SYSTEM_ROLE,
  findSystemRole,
  resolveEffectivePermissions,
} from './roles.catalog';

/**
 * PermissionService — motor de autorização RBAC do IAM v2. Issue #340
 * (Fase F3.1/M2 da arquitetura, docs/iam/ARQUITETURA-IAM-V2.md).
 *
 * Responde à pergunta central: "o usuário X pode Y na empresa Z?"
 * considerando perfis atribuídos (UserRoleAssignment), herança de perfis
 * (Role.parentId, N níveis), exceções individuais (UserPermission
 * grant/deny) e expiração (expiresAt), com cache Redis (TTL 5 min +
 * invalidação ativa — PermissionCacheService).
 *
 * ⚠️ FASE M2 = SHADOW MODE: este serviço ainda NÃO bloqueia nenhum request.
 * O enforcement (PermissionGuard + @RequirePermission) é a issue #341
 * (Onda B). Aqui ele só CALCULA; o ShadowModeService compara com o
 * comportamento do @Roles atual e loga divergências.
 *
 * ── Semântica de precedência (do mais forte para o mais fraco) ──────────────
 *   1. DENY individual   (UserPermission.granted = false)  → sempre vence
 *   2. GRANT individual  (UserPermission.granted = true)   → sobrepõe deny/ausência de perfil
 *   3. DENY de perfil    (RolePermission.granted = false)  → vence grant de qualquer perfil
 *   4. GRANT de perfil   (RolePermission.granted = true)   → via perfil direto ou herdado
 *   5. Ausência          → negado (na dúvida, restringir — docs/RBAC.md)
 *
 * Em fórmula: efetivo = ((grantsPerfis − denysPerfis) ∪ grantsUsuario) − denysUsuario
 *
 * ── Wildcards ───────────────────────────────────────────────────────────────
 * O BANCO só guarda codes exatos do catálogo (permissions.catalog.ts).
 * Wildcard existe apenas no LADO DA CONSULTA, como conveniência dos checks:
 * `hasPermission(u, c, 'sales.*')` = "tem ALGUMA permissão do módulo sales?".
 * Formatos aceitos: `*`, `modulo.*`, `modulo.recurso.*` (sufixo apenas).
 */

/** Conjunto efetivo resolvido para um par (usuário, empresa). */
export interface PermissionSet {
  /** Codes dos perfis DIRETAMENTE atribuídos (sem os herdados via parent). */
  roles: string[];
  /** Codes de permissão efetivos, já com herança e exceções aplicadas. */
  permissions: string[];
}

/**
 * Payload do GET /auth/me/permissions (#351) — o que o frontend consome
 * para o usePermission()/<Can>.
 */
export interface MyEffectivePermissions extends PermissionSet {
  /**
   * true quando o usuário NÃO tem nada no RBAC v2 (nenhum UserRoleAssignment
   * nem UserPermission) e as permissões foram derivadas do perfil-espelho do
   * enum `User.role` legado (ENUM_ROLE_TO_SYSTEM_ROLE + catálogo em código).
   * Garante que usuário ainda não migrado nunca fica sem permissão nenhuma.
   */
  legacyFallback: boolean;
  /** Timestamp ISO da resolução — o frontend usa para invalidar/depurar. */
  resolvedAt: string;
}

/** Limite defensivo da caminhada na cadeia de herança (os catálogos garantem
 *  ausência de ciclos, mas dado vivo no banco pode ser corrompido). */
const MAX_INHERITANCE_DEPTH = 20;

/**
 * Casa um code efetivo contra um code de consulta (com suporte a wildcard
 * de sufixo). Padrões inválidos (ex.: `sa*les.x`) retornam false — nunca
 * lançam (fail-closed).
 */
export function permissionMatches(effective: ReadonlySet<string>, query: string): boolean {
  if (!query.includes('*')) return effective.has(query);
  if (query === '*') return effective.size > 0;
  // Só aceita wildcard de sufixo: 'modulo.*' ou 'modulo.recurso.*'
  if (!query.endsWith('.*') || query.indexOf('*') !== query.length - 1) return false;
  const prefix = query.slice(0, -1); // mantém o ponto: 'sales.'
  for (const code of effective) {
    if (code.startsWith(prefix)) return true;
  }
  return false;
}

@Injectable()
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: PermissionCacheService,
  ) {}

  // ─── Resolução ─────────────────────────────────────────────────────────────

  /**
   * Resolve o conjunto EFETIVO de permissões do usuário na empresa.
   * Cache-first (Redis, TTL 5 min); miss ou Redis fora → resolve no banco
   * e tenta popular o cache (best-effort).
   */
  async getUserPermissions(userId: string, companyId: string): Promise<PermissionSet> {
    const cached = await this.cache.get(companyId, userId);
    if (cached) {
      return { roles: cached.roles, permissions: cached.permissions };
    }
    const resolved = await this.resolveFromDatabase(userId, companyId);
    await this.cache.set(companyId, userId, { v: 1, ...resolved });
    return resolved;
  }

  /** O usuário tem a permissão? Aceita code exato ou wildcard de sufixo. */
  async hasPermission(userId: string, companyId: string, code: string): Promise<boolean> {
    const { permissions } = await this.getUserPermissions(userId, companyId);
    return permissionMatches(new Set(permissions), code);
  }

  /**
   * Escopo de DADOS efetivo do usuário na empresa — #347 fase 2 (347-A).
   *
   * Regras (decisões Rafael 11/07/2026; ver scope.ts e docs/iam/ESCOPO-FILIAL.md):
   * - Nenhum assignment ativo (usuário legado em fallback de enum) → COMPANY;
   * - QUALQUER assignment sem branchId → COMPANY (o vínculo mais amplo vence —
   *   e é o retrocompatível: hoje nenhum assignment tem branch, então todo
   *   mundo permanece com a visão global que sempre teve);
   * - Todos os assignments com branchId → BRANCH, com a união das filiais
   *   (gerente que acumula lojas = múltiplos assignments) e dos depósitos
   *   ativos dessas filiais (Warehouse.branchId, a ponte operacional).
   *
   * #347-B: entrou no caminho quente (services de VENDAS consomem via
   * scopeWhere) — cache-first como o de permissões (TTL 5 min + invalidação
   * ativa nos mesmos pontos: todo grant/revoke de assignment limpa os dois).
   */
  async getUserScope(userId: string, companyId: string): Promise<EffectiveScope> {
    const cached = await this.cache.getScope(companyId, userId);
    if (cached) {
      return {
        level: cached.level,
        branchIds: cached.branchIds,
        warehouseIds: cached.warehouseIds,
        userId,
      };
    }
    const scope = await this.resolveScopeFromDatabase(userId, companyId);
    await this.cache.setScope(companyId, userId, {
      v: 1,
      level: scope.level,
      branchIds: scope.branchIds,
      warehouseIds: scope.warehouseIds,
    });
    return scope;
  }

  private async resolveScopeFromDatabase(
    userId: string,
    companyId: string,
  ): Promise<EffectiveScope> {
    const now = new Date();
    const notExpired = { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };

    const assignments = await this.prisma.userRoleAssignment.findMany({
      where: { userId, companyId, ...notExpired, role: { isActive: true } },
      select: { branchId: true },
    });

    if (assignments.length === 0 || assignments.some((a) => !a.branchId)) {
      return companyScope(userId);
    }

    const branchIds = [...new Set(assignments.map((a) => a.branchId as string))];
    const warehouses = await this.prisma.warehouse.findMany({
      where: { companyId, branchId: { in: branchIds }, isActive: true },
      select: { id: true },
    });

    return {
      level: 'BRANCH',
      branchIds,
      warehouseIds: warehouses.map((w) => w.id),
      userId,
    };
  }

  /** O usuário tem PELO MENOS UMA das permissões? (1 resolução, N checks) */
  async hasAnyPermission(userId: string, companyId: string, codes: string[]): Promise<boolean> {
    if (codes.length === 0) return false;
    const { permissions } = await this.getUserPermissions(userId, companyId);
    const effective = new Set(permissions);
    return codes.some((code) => permissionMatches(effective, code));
  }

  /** O usuário tem TODAS as permissões? (1 resolução, N checks) */
  async hasAllPermissions(userId: string, companyId: string, codes: string[]): Promise<boolean> {
    if (codes.length === 0) return true;
    const { permissions } = await this.getUserPermissions(userId, companyId);
    const effective = new Set(permissions);
    return codes.every((code) => permissionMatches(effective, code));
  }

  /**
   * O usuário tem o perfil DIRETAMENTE atribuído? (herança NÃO conta aqui:
   * "Supervisor herda permissões de Operador" ≠ "Supervisor É Operador".)
   */
  async hasRole(userId: string, companyId: string, roleCode: string): Promise<boolean> {
    const { roles } = await this.getUserPermissions(userId, companyId);
    return roles.includes(roleCode);
  }

  /**
   * Permissões efetivas do PRÓPRIO usuário para o frontend (#351,
   * GET /auth/me/permissions), com fallback de compatibilidade para
   * usuários legados ainda não migrados para o RBAC v2.
   *
   * Fallback (NUNCA deixar usuário legado sem permissão nenhuma):
   * se o usuário não tem NADA no RBAC v2 (zero UserRoleAssignment e zero
   * UserPermission → roles e permissions vazios), resolvemos o perfil-espelho
   * do enum `User.role` (ENUM_ROLE_TO_SYSTEM_ROLE, mesmo mapeamento que o
   * seed #463 usou no espelhamento) direto do catálogo em código — sem tocar
   * o banco e sem poluir o cache Redis (o cache guarda apenas o estado REAL
   * do RBAC v2; o fallback é recalculado por request, custo O(catálogo)).
   *
   * Se o usuário TEM qualquer coisa no v2 (mesmo que só um deny individual),
   * o v2 é a fonte da verdade e o fallback NÃO se aplica — remover todos os
   * perfis de alguém é uma decisão administrativa que deve valer.
   */
  async getMyEffectivePermissions(
    userId: string,
    companyId: string,
    legacyEnumRole?: string,
  ): Promise<MyEffectivePermissions> {
    const resolved = await this.getUserPermissions(userId, companyId);
    const resolvedAt = new Date().toISOString();

    const isEmptyInV2 = resolved.roles.length === 0 && resolved.permissions.length === 0;
    if (isEmptyInV2 && legacyEnumRole) {
      const mirrorCode = ENUM_ROLE_TO_SYSTEM_ROLE[legacyEnumRole];
      if (mirrorCode && findSystemRole(mirrorCode)) {
        return {
          roles: [mirrorCode],
          permissions: [...resolveEffectivePermissions(mirrorCode)].sort(),
          legacyFallback: true,
          resolvedAt,
        };
      }
      this.logger.warn(
        `Usuário ${userId} sem RBAC v2 e com enum role desconhecido ` +
          `('${legacyEnumRole}') — respondendo conjunto vazio (fail-closed).`,
      );
    }

    return { ...resolved, legacyFallback: false, resolvedAt };
  }

  // ─── Invalidação ativa (Decisão 2) ────────────────────────────────────────
  // Quem chama: as futuras telas/serviços de administração de acesso (#352)
  // e os fluxos de grant/revoke — todo assignment que muda DEVE invalidar.

  /** Invalida o cache de um usuário (numa empresa ou, sem companyId, em todas). */
  async invalidateUser(userId: string, companyId?: string): Promise<void> {
    if (companyId) {
      await this.cache.del(companyId, userId);
    } else {
      await this.cache.delUserAllCompanies(userId);
    }
  }

  /**
   * Invalida o cache de todos os usuários afetados por um perfil — o próprio
   * E os descendentes (quem tem um perfil filho herda do pai; mudar o pai
   * muda o efetivo do filho).
   */
  async invalidateRole(roleId: string): Promise<void> {
    const affectedRoleIds = await this.collectDescendantRoleIds(roleId);
    const assignments = await this.prisma.userRoleAssignment.findMany({
      where: { roleId: { in: affectedRoleIds } },
      select: { userId: true, companyId: true },
    });
    const seen = new Set<string>();
    for (const { userId, companyId } of assignments) {
      const key = `${companyId}:${userId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await this.cache.del(companyId, userId);
    }
  }

  /** Invalida o cache de TODOS os usuários de uma empresa. */
  async invalidateCompany(companyId: string): Promise<void> {
    await this.cache.delCompany(companyId);
  }

  // ─── Internos ──────────────────────────────────────────────────────────────

  /**
   * Resolve direto no banco:
   *  1. UserRoleAssignment vigentes (não expirados, perfil ativo)
   *  2. Cadeia de herança de cada perfil (parent → ... , com defesa a ciclo)
   *  3. RolePermission: grants − denys (deny de perfil vence grant de perfil)
   *  4. UserPermission vigentes: aplica grants, depois denys (deny individual
   *     vence tudo)
   */
  private async resolveFromDatabase(userId: string, companyId: string): Promise<PermissionSet> {
    const now = new Date();
    const notExpired = { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };

    const assignments = await this.prisma.userRoleAssignment.findMany({
      where: {
        userId,
        companyId,
        ...notExpired,
        role: { isActive: true },
      },
      select: { roleId: true, role: { select: { code: true } } },
    });

    const directRoleCodes = [...new Set(assignments.map((a) => a.role.code))];
    const chainRoles = await this.collectRoleChain(assignments.map((a) => a.roleId));

    const roleGrants = new Set<string>();
    const roleDenies = new Set<string>();
    for (const role of chainRoles) {
      for (const rp of role.rolePermissions) {
        if (rp.granted) roleGrants.add(rp.permission.code);
        else roleDenies.add(rp.permission.code);
      }
    }

    const userPerms = await this.prisma.userPermission.findMany({
      where: { userId, companyId, ...notExpired },
      select: { granted: true, permission: { select: { code: true } } },
    });

    // efetivo = ((grantsPerfis − denysPerfis) ∪ grantsUsuario) − denysUsuario
    const effective = new Set<string>();
    for (const code of roleGrants) {
      if (!roleDenies.has(code)) effective.add(code);
    }
    for (const up of userPerms) {
      if (up.granted) effective.add(up.permission.code);
    }
    for (const up of userPerms) {
      if (!up.granted) effective.delete(up.permission.code);
    }

    return { roles: directRoleCodes, permissions: [...effective].sort() };
  }

  /**
   * Caminha a cadeia de herança em largura (uma query por nível), com
   * conjunto de visitados (defesa a ciclo) e profundidade máxima defensiva.
   */
  private async collectRoleChain(initialRoleIds: string[]): Promise<
    Array<{
      id: string;
      parentId: string | null;
      rolePermissions: Array<{ granted: boolean; permission: { code: string } }>;
    }>
  > {
    const visited = new Set<string>();
    const collected: Array<{
      id: string;
      parentId: string | null;
      rolePermissions: Array<{ granted: boolean; permission: { code: string } }>;
    }> = [];

    let frontier = [...new Set(initialRoleIds)];
    let depth = 0;

    while (frontier.length > 0) {
      depth += 1;
      if (depth > MAX_INHERITANCE_DEPTH) {
        this.logger.warn(
          `Cadeia de herança de perfis excedeu ${MAX_INHERITANCE_DEPTH} níveis ` +
            `(possível ciclo no banco) — interrompendo em: ${frontier.join(', ')}`,
        );
        break;
      }
      frontier.forEach((id) => visited.add(id));

      const roles = await this.prisma.role.findMany({
        where: { id: { in: frontier }, isActive: true },
        select: {
          id: true,
          parentId: true,
          rolePermissions: {
            select: { granted: true, permission: { select: { code: true } } },
          },
        },
      });
      collected.push(...roles);

      frontier = [
        ...new Set(
          roles
            .map((r) => r.parentId)
            .filter((id): id is string => id !== null && !visited.has(id)),
        ),
      ];
    }

    return collected;
  }

  /** roleId + todos os descendentes (children transitivo), com defesa a ciclo. */
  private async collectDescendantRoleIds(roleId: string): Promise<string[]> {
    const visited = new Set<string>([roleId]);
    let frontier = [roleId];
    let depth = 0;

    while (frontier.length > 0 && depth < MAX_INHERITANCE_DEPTH) {
      depth += 1;
      const children = await this.prisma.role.findMany({
        where: { parentId: { in: frontier } },
        select: { id: true },
      });
      frontier = children.map((c) => c.id).filter((id) => !visited.has(id));
      frontier.forEach((id) => visited.add(id));
    }

    return [...visited];
  }
}
