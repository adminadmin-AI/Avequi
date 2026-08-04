import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Escopo EMPRESARIAL (#947) — a ampliação explícita para o grupo de empresas.
 *
 * ── O que este serviço substitui ──────────────────────────────────────────
 * Até aqui, "ver mais de uma empresa" era `user.role === 'SUPER_ADMIN'`,
 * repetido em dois lugares que já divergiam entre si:
 *
 *   - `CompanyService.hasGlobalScope` → `company.findMany({})`, ou seja
 *     **todas as empresas do banco**, de TODOS os tenants;
 *   - `UserService.findAll` → `where: {}`, mesma coisa para usuários.
 *
 * Isso é mais amplo do que "multiempresa": num banco multi-tenant, o admin de
 * um cliente enxergava a existência dos outros clientes. O #947 fecha isso: a
 * ampliação passa a ser uma CAPABILITY explícita e o alvo dela é o **grupo
 * empresarial** (empresa raiz + suas filiais), nunca o banco inteiro.
 *
 * ── As três travas ────────────────────────────────────────────────────────
 *  1. **Só amplia quem pede.** `companyId` continua sendo o padrão: quem não
 *     tem a capability recebe `[companyId]` e as queries seguem filtradas.
 *     Nenhum caminho aqui devolve "sem filtro" — o retorno é sempre uma lista
 *     fechada de ids, então esquecer o filtro vira lista vazia, não visão
 *     total.
 *  2. **Só perfil ESTRUTURAL concede.** A capability só vale se vier de um
 *     perfil `isSystem` com `companyId: null` (os perfis do catálogo, criados
 *     pelo seed). Um administrador de tenant pode criar um perfil customizado
 *     e chamá-lo do que quiser — se ele carregar este código, NÃO atravessa
 *     empresa nenhuma. Sem esta trava, "criar perfil" (permissão que o
 *     ADMIN_EMPRESA tem) viraria escalada para fora da própria empresa.
 *  3. **Fail-closed.** Erro de banco, ciclo na árvore ou profundidade
 *     absurda → não amplia. Indisponibilidade nunca vira permissão a mais.
 *
 * ── Por que não usa o cache de permissões ─────────────────────────────────
 * Deliberadamente lê do banco. O `PermissionService` cacheia o conjunto
 * efetivo (TTL 5 min) e não guarda a ORIGEM de cada permissão — e a origem é
 * justamente a trava 2. Além disso, "falha de cache nunca amplia" é mais fácil
 * de garantir sem cache do que com ele. O custo é uma query por chamada, em
 * dois endpoints de listagem administrativa.
 *
 * ── Por que NÃO honra o fallback legado ───────────────────────────────────
 * O fallback do #946 resolve o perfil-espelho do enum a partir do catálogo —
 * e o espelho do `SUPER_ADMIN` é o `ADMIN_GLOBAL`, que TEM esta capability.
 * Honrá-lo aqui devolveria pelo enum exatamente o poder que este PR está
 * tirando dele. Quem não tem RBAC v2 não amplia, ponto.
 */

/** Capability de ampliação — declarada em permissions.catalog.ts (#947). */
export const CROSS_COMPANY_PERMISSION = 'iam.tenant-scope.cross-company';

/** Profundidade máxima da árvore de empresas ao subir até a raiz. */
const MAX_TREE_DEPTH = 10;

/** Profundidade máxima da cadeia de herança de perfis. */
const MAX_ROLE_DEPTH = 10;

export interface EscopoEmpresarial {
  /** Empresas que a consulta pode ler. NUNCA vazio, NUNCA "todas". */
  companyIds: string[];
  /** true = a ampliação explícita foi autorizada (grupo inteiro). */
  ampliado: boolean;
}

@Injectable()
export class TenantScopeService {
  private readonly logger = new Logger(TenantScopeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * O escopo empresarial efetivo de quem está consultando.
   *
   * Sem a capability: `{ companyIds: [companyId], ampliado: false }` — o mesmo
   * recorte de sempre. Com ela: a árvore do grupo (raiz + filiais).
   */
  async resolverEscopo(userId: string, companyId: string): Promise<EscopoEmpresarial> {
    const pode = await this.podeAmpliar(userId, companyId);
    if (!pode) return { companyIds: [companyId], ampliado: false };

    const grupo = await this.empresasDoGrupo(companyId);
    return { companyIds: grupo, ampliado: true };
  }

  /**
   * O usuário tem a capability, vinda de perfil ESTRUTURAL? (trava 2)
   *
   * Um deny — de perfil ou individual — vence sempre. Grant individual NÃO
   * concede: a capability é estrutural por definição, e um `UserPermission`
   * avulso é exatamente o atalho que a trava 2 existe para fechar.
   */
  async podeAmpliar(userId: string, companyId: string): Promise<boolean> {
    try {
      const agora = new Date();
      const naoExpirado = { OR: [{ expiresAt: null }, { expiresAt: { gt: agora } }] };

      // Deny individual vence tudo — inclusive perfil estrutural.
      const denyIndividual = await this.prisma.userPermission.findFirst({
        where: {
          userId,
          companyId,
          granted: false,
          permission: { code: CROSS_COMPANY_PERMISSION },
          ...naoExpirado,
        },
        select: { id: true },
      });
      if (denyIndividual) return false;

      // Só perfis ESTRUTURAIS entram na conta (isSystem + companyId null).
      const assignments = await this.prisma.userRoleAssignment.findMany({
        where: {
          userId,
          companyId,
          ...naoExpirado,
          role: { isActive: true, isSystem: true, companyId: null },
        },
        select: { roleId: true },
      });
      if (assignments.length === 0) return false;

      return await this.cadeiaEstruturalConcede(assignments.map((a) => a.roleId));
    } catch (error) {
      // Fail-closed: indisponibilidade não amplia escopo.
      this.logger.error(
        JSON.stringify({
          event: 'tenant_scope_resolve_error',
          userId,
          companyId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return false;
    }
  }

  /**
   * Empresas do grupo de `companyId`: sobe até a raiz VERDADEIRA e desce nas
   * filiais dela. Subir é necessário porque quem consulta pode estar numa
   * filial — o grupo é o mesmo, a raiz é que muda de lugar.
   *
   * `Company.parentId` é auto-relação SEM constraint de profundidade e o
   * create aceita `parentId` sem validar a árvore: por isso o passeio tem
   * guarda de ciclo e teto de profundidade. Bateu no teto → devolve só a
   * própria empresa (fail-closed), nunca uma árvore parcial que pareça
   * completa.
   */
  private async empresasDoGrupo(companyId: string): Promise<string[]> {
    const raiz = await this.resolverRaiz(companyId);
    if (!raiz) return [companyId];

    const filiais = await this.prisma.company.findMany({
      where: { parentId: raiz },
      select: { id: true },
    });
    const ids = new Set<string>([raiz, companyId, ...filiais.map((f) => f.id)]);
    return [...ids];
  }

  /** Sobe a árvore até a raiz verdadeira. null = ciclo ou árvore funda demais. */
  private async resolverRaiz(companyId: string): Promise<string | null> {
    let atual = companyId;
    const visitados = new Set<string>([atual]);

    for (let i = 0; i < MAX_TREE_DEPTH; i++) {
      const empresa = await this.prisma.company.findUnique({
        where: { id: atual },
        select: { parentId: true },
      });
      if (!empresa) return null;
      if (!empresa.parentId) return atual; // chegou na raiz
      if (visitados.has(empresa.parentId)) {
        this.logger.error(
          JSON.stringify({ event: 'tenant_scope_company_cycle', companyId, at: atual }),
        );
        return null;
      }
      visitados.add(empresa.parentId);
      atual = empresa.parentId;
    }

    this.logger.error(
      JSON.stringify({ event: 'tenant_scope_tree_too_deep', companyId, max: MAX_TREE_DEPTH }),
    );
    return null;
  }

  /**
   * A cadeia de herança destes perfis concede a capability?
   *
   * Caminha em largura, mas SÓ por nós estruturais: se a herança passar por um
   * perfil de empresa, o ramo morre ali. Deny de perfil vence grant de perfil,
   * como no resolvedor central.
   */
  private async cadeiaEstruturalConcede(roleIdsIniciais: string[]): Promise<boolean> {
    const visitados = new Set<string>();
    let fronteira = roleIdsIniciais;
    let concede = false;

    for (let nivel = 0; nivel < MAX_ROLE_DEPTH && fronteira.length > 0; nivel++) {
      const novos = fronteira.filter((id) => !visitados.has(id));
      if (novos.length === 0) break;
      novos.forEach((id) => visitados.add(id));

      const roles = await this.prisma.role.findMany({
        // isSystem + companyId null repetidos a cada nível DE PROPÓSITO: a
        // trava não pode valer só para o perfil atribuído diretamente.
        where: { id: { in: novos }, isActive: true, isSystem: true, companyId: null },
        select: {
          parentId: true,
          rolePermissions: {
            where: { permission: { code: CROSS_COMPANY_PERMISSION } },
            select: { granted: true },
          },
        },
      });

      for (const role of roles) {
        for (const rp of role.rolePermissions) {
          if (!rp.granted) return false; // deny de perfil vence
          concede = true;
        }
      }

      fronteira = roles.map((r) => r.parentId).filter((id): id is string => !!id);
    }

    return concede;
  }
}
