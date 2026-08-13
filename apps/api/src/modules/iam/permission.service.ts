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
 * Este serviço CALCULA o conjunto efetivo; quem bloqueia o request é o
 * PermissionGuard (@RequirePermission), entregue na #341.
 *
 * #948-C1: a nota de shadow mode que ficava aqui saiu junto com o
 * ShadowModeService. Ele comparava esta resolução com o comportamento do
 * @Roles legado durante a migração (#340) — desde o #946 o RBAC v2 é a fonte
 * de verdade, e o @Roles não decide mais nada. Não há o que comparar.
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

/**
 * De onde partiu uma resolução com fallback legado — SÓ telemetria (#1006 D1).
 *
 * São exatamente os dois pontos de entrada permitidos do fallback: o guard de
 * rota (enforcement real) e o GET /auth/me/permissions (menu do frontend).
 * `desconhecida` é o padrão defensivo: se algum caminho novo aparecer sem
 * declarar origem, o evento sai mesmo assim — telemetria cega é pior que
 * telemetria imprecisa. Não influencia decisão de acesso nenhuma.
 */
export type OrigemDaResolucao = 'route_guard' | 'auth_me_permissions' | 'desconhecida';

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
   * - QUALQUER assignment sem branchId → COMPANY. DECISÃO DE PRODUTO
   *   (11/07/2026, reconfirmada pelo Rafael em 03/08/2026): em assignments
   *   MISTOS (um corporativo + um de filial), o COMPANY prevalece — um perfil
   *   corporativo não perde a visão da empresa por também exercer função
   *   local. É também o retrocompatível: hoje nenhum assignment tem branch;
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
    try {
      await this.cache.setScope(companyId, userId, {
        v: 1,
        level: scope.level,
        branchIds: scope.branchIds,
        warehouseIds: scope.warehouseIds,
      });
    } catch {
      // best-effort: falha de cache nunca impede devolver o escopo do banco
    }
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
   * Consulta REVERSA: quais usuários da empresa têm esta permissão? (#1002-C3)
   *
   * Todo o resto do serviço responde "este usuário pode?". Aqui a pergunta é a
   * inversa — "quem pode?" — e ela aparece quando a permissão marca uma CLASSE
   * de pessoas, não uma ação: quem é elegível a receber um lead, por exemplo.
   *
   * ── Por que não iterar usuário a usuário ───────────────────────────────────
   * O caminho óbvio seria listar os usuários da empresa e chamar
   * `hasPermission` em cada um. Isso é N+1: numa empresa de 50 usuários, 50
   * resoluções a cada lead captado. Aqui a resolução é feita ao contrário, em
   * **três queries de tamanho previsível**, independentemente do número de
   * usuários:
   *
   *   1. perfis da empresa (system + customizados) com a marca desta
   *      permissão e o `parentId` — a herança é resolvida EM MEMÓRIA;
   *   2. atribuições vigentes desses perfis, já filtrando usuário ativo;
   *   3. overrides individuais (`UserPermission`) desta permissão.
   *
   * ── Precedência ────────────────────────────────────────────────────────────
   * Idêntica à de `resolveFromDatabase`, e é isso que importa: as duas
   * respostas TÊM de coincidir, ou um usuário apareceria na lista e levaria
   * 403 na ação (ou o contrário).
   *
   *   efetivo = ((grants de perfil − denys de perfil) ∪ grants individuais)
   *             − denys individuais
   *
   * Um deny de perfil em QUALQUER elo da cadeia anula o grant de qualquer
   * outro elo — não é "o mais próximo vence". Um deny individual anula tudo.
   * Um grant individual torna elegível quem não tem perfil nenhum.
   *
   * NÃO honra o fallback legado do #946: o enum não torna ninguém elegível.
   */
  async usersWithPermission(
    companyId: string,
    code: string,
    opcoes: { apenasAtivos?: boolean } = {},
  ): Promise<string[]> {
    const apenasAtivos = opcoes.apenasAtivos ?? true;
    const agora = new Date();
    const naoExpirado = { OR: [{ expiresAt: null }, { expiresAt: { gt: agora } }] };

    // 1. Perfis visíveis à empresa: os globais/system (companyId null) e os
    //    customizados dela. Traz só a marca DESTA permissão — a linha existe
    //    quando o perfil concede (granted true) ou nega (false) explicitamente.
    // tenant-lint: ok (companyId no filtro; null = perfil global do sistema)
    const perfis = await this.prisma.role.findMany({
      where: { isActive: true, OR: [{ companyId: null }, { companyId }] },
      select: {
        id: true,
        parentId: true,
        rolePermissions: {
          where: { permission: { code } },
          select: { granted: true },
        },
      },
    });

    const porId = new Map(perfis.map((p) => [p.id, p]));

    /**
     * O perfil concede a permissão, considerando a cadeia inteira?
     * Sobe até a raiz; deny em qualquer nível vence. Anti-ciclo por caminho e
     * teto de profundidade — o mesmo cuidado do `collectRoleChain`.
     */
    const concede = (roleId: string): boolean => {
      let atual: string | null = roleId;
      const visitados = new Set<string>();
      let temGrant = false;
      let profundidade = 0;
      while (atual && !visitados.has(atual) && profundidade < MAX_INHERITANCE_DEPTH) {
        visitados.add(atual);
        profundidade += 1;
        const perfil = porId.get(atual);
        if (!perfil) break; // perfil inativo ou de outra empresa: cadeia para
        for (const rp of perfil.rolePermissions) {
          if (!rp.granted) return false; // deny em qualquer elo vence
          temGrant = true;
        }
        atual = perfil.parentId;
      }
      return temGrant;
    };

    const perfisQueConcedem = perfis.filter((p) => concede(p.id)).map((p) => p.id);

    // 2. Quem tem esses perfis, com atribuição vigente e usuário ativo.
    const atribuicoes = perfisQueConcedem.length
      ? await this.prisma.userRoleAssignment.findMany({
          where: {
            companyId,
            roleId: { in: perfisQueConcedem },
            ...naoExpirado,
            ...(apenasAtivos ? { user: { isActive: true } } : {}),
          },
          select: { userId: true },
        })
      : [];

    // 3. Overrides individuais desta permissão nesta empresa.
    const overrides = await this.prisma.userPermission.findMany({
      where: { companyId, permission: { code }, ...naoExpirado },
      select: { userId: true, granted: true },
    });

    const negados = new Set(overrides.filter((o) => !o.granted).map((o) => o.userId));
    const elegiveis = new Set(atribuicoes.map((a) => a.userId));
    for (const o of overrides) {
      if (o.granted) elegiveis.add(o.userId); // grant individual entra mesmo sem perfil
    }
    for (const userId of negados) {
      elegiveis.delete(userId); // deny individual vence tudo
    }

    if (elegiveis.size === 0 || !apenasAtivos) return [...elegiveis];

    // Um grant individual pode ter entrado sem passar pelo filtro de usuário
    // ativo da query 2 — confere só esses, sem custo relevante.
    const porGrantIndividual = overrides
      .filter((o) => o.granted && elegiveis.has(o.userId))
      .map((o) => o.userId);
    if (porGrantIndividual.length === 0) return [...elegiveis];

    const ativos = await this.prisma.user.findMany({
      where: { id: { in: porGrantIndividual }, companyId, isActive: true },
      select: { id: true },
    });
    const ativosSet = new Set(ativos.map((u) => u.id));
    for (const userId of porGrantIndividual) {
      if (!ativosSet.has(userId)) elegiveis.delete(userId);
    }
    return [...elegiveis];
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
    origem: OrigemDaResolucao = 'auth_me_permissions',
  ): Promise<MyEffectivePermissions> {
    const { resolved, legacyFallback } = await this.resolveWithLegacyFallback(
      userId,
      companyId,
      legacyEnumRole,
      origem,
    );
    return { ...resolved, legacyFallback, resolvedAt: new Date().toISOString() };
  }

  /**
   * Resolução efetiva COM o fallback legado — ponto ÚNICO da regra (#946).
   *
   * Antes, o fallback existia só aqui (menu, via /auth/me/permissions) e o
   * PermissionGuard resolvia sem ele: usuário legado sem RBAC v2 via o item
   * no menu e tomava 403 na API. Agora guard e menu chamam o MESMO método —
   * não há duas versões da regra para divergir.
   *
   * ⚠️ TEMPORÁRIO: o fallback existe enquanto o enum `User.role` for espelho
   * de compatibilidade (#780). Sai na Fase D, junto com a aposentadoria do
   * enum. NÃO usar fora deste mecanismo central de resolução.
   *
   * A regra de quando ele vale é a de sempre: só quando o usuário NÃO tem
   * nada no v2 (nenhum perfil E nenhuma exceção). Qualquer configuração v2
   * existente — inclusive um único deny — desliga o fallback, porque remover
   * acessos de alguém é decisão administrativa que precisa valer.
   */
  async resolveWithLegacyFallback(
    userId: string,
    companyId: string,
    legacyEnumRole?: string,
    origem: OrigemDaResolucao = 'desconhecida',
  ): Promise<{ resolved: PermissionSet; legacyFallback: boolean }> {
    const resolved = await this.getUserPermissions(userId, companyId);

    const isEmptyInV2 = resolved.roles.length === 0 && resolved.permissions.length === 0;
    if (isEmptyInV2 && legacyEnumRole) {
      const mirrorCode = ENUM_ROLE_TO_SYSTEM_ROLE[legacyEnumRole];
      if (mirrorCode && findSystemRole(mirrorCode)) {
        this.registrarUsoDoFallback(userId, companyId, legacyEnumRole, mirrorCode, origem);
        return {
          resolved: {
            roles: [mirrorCode],
            permissions: [...resolveEffectivePermissions(mirrorCode)].sort(),
          },
          legacyFallback: true,
        };
      }
      this.logger.warn(
        `Usuário ${userId} sem RBAC v2 e com enum role desconhecido ` +
          `('${legacyEnumRole}') — respondendo conjunto vazio (fail-closed).`,
      );
    }

    return { resolved, legacyFallback: false };
  }

  /**
   * Telemetria do fallback legado — Fase D, etapa D1 (#1006).
   *
   * Emitido SOMENTE quando o fallback realmente concede o perfil-espelho, que
   * é o evento que precisamos medir antes de removê-lo. O inventário
   * (determinístico, no banco) diz quem PODERIA cair aqui; este evento diz
   * quem CAIU de verdade. Os dois juntos são o portão do D2: uma semana
   * operacional com zero eventos + inventário zerado.
   *
   * Best-effort por decisão explícita: telemetria NUNCA pode derrubar nem
   * alterar uma resolução de acesso. Falha de log é engolida — a requisição
   * segue com exatamente o mesmo resultado que teria sem este método.
   *
   * Sem dado pessoal além dos identificadores já presentes em outros eventos
   * IAM do projeto (mesmo formato do `iam_permission_guard_error`).
   */
  private registrarUsoDoFallback(
    userId: string,
    companyId: string,
    legacyRole: string,
    mirrorCode: string,
    origem: OrigemDaResolucao,
  ): void {
    try {
      this.logger.warn(
        JSON.stringify({
          event: 'iam_legacy_fallback_used',
          userId,
          companyId,
          legacyRole,
          mirrorCode,
          origem,
        }),
      );
    } catch {
      /* best-effort: telemetria nunca interfere na autorização (#1006 D1) */
    }
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

  /**
   * Perfis v2 VIGENTES do usuário (não expirados, perfil ativo), DIRETOS —
   * sem expandir herança.
   *
   * É a MESMA regra de vigência do `resolveFromDatabase`; existe como método
   * público para quem precisa dos perfis em si (e não das permissões
   * efetivas), como a alçada de desconto (#1004) — assim a definição de
   * "vigente" mora num lugar só.
   */
  getVigentAssignments(
    userId: string,
    companyId: string,
  ): Promise<Array<{ roleId: string; role: { code: string } }>> {
    return this.prisma.userRoleAssignment.findMany({
      where: {
        userId,
        companyId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        role: { isActive: true },
      },
      select: { roleId: true, role: { select: { code: true } } },
    });
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

    const assignments = await this.getVigentAssignments(userId, companyId);

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

      // tenant-lint: ok (resolução RBAC: ids vêm das atribuições do próprio usuário)
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
      // tenant-lint: ok (resolução RBAC: expansão da hierarquia de papéis do próprio usuário)
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
