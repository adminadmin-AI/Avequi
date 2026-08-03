import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Invariante do último ADMIN_GLOBAL — #752.
 *
 * REGRA DE PRODUTO: cada grupo empresarial (empresa-raiz + descendentes)
 * deve manter, a todo momento, pelo menos um administrador global ATIVO e
 * EFETIVO. "Efetivo" aqui é PERPÉTUO por decisão desta issue:
 *   - usuário ativo (User.isActive);
 *   - vínculo ao perfil system ADMIN_GLOBAL (Role.companyId null — perfil de
 *     plataforma; homônimo de tenant NÃO conta);
 *   - perfil ativo (Role.isActive);
 *   - assignment SEM expiração (expiresAt null). Um admin "com prazo" é uma
 *     violação agendada: não existe job de expiração (ela é interpretada só
 *     na consulta), então aceitar um único admin expirável deixaria o grupo
 *     sem administrador no vencimento, sem nenhum evento para impedir.
 *
 * ÁRVORE EMPRESARIAL: Company.parentId é auto-relação SEM constraint de
 * profundidade, e o create de empresa aceita parentId sem validação — logo
 * árvores de N níveis são possíveis. A resolução aqui é defensiva: sobe até
 * a raiz verdadeira e desce coletando TODOS os descendentes, com guarda de
 * ciclo e limite de profundidade (dado corrompido → fail-closed, nunca
 * escopo errado).
 *
 * MECANISMO (alternativa aprovada pelo Rafael em 03/08/2026): lock
 * pessimista via SELECT ... FOR UPDATE na linha da EMPRESA-RAIZ do grupo,
 * dentro de transação interativa — mesmo padrão do stock.service (#219),
 * já provado em produção com o pooler do Supabase. Toda operação capaz de
 * remover um admin de cena passa por `executarProtegido`: o lock serializa
 * as operações concorrentes do mesmo grupo, a contagem acontece DEPOIS do
 * lock e DENTRO da mesma transação, e a violação faz rollback integral —
 * nunca check-then-act com compensação posterior.
 *
 * Semântica antes/depois: a operação só é bloqueada se ELA reduziu o grupo
 * a zero (antes > 0 e depois = 0). Um grupo que já esteja sem admin (estado
 * quebrado pré-existente) não trava operações que não pioram nada — a
 * recuperação é sempre possível porque conceder perfil apenas ADICIONA.
 */

export const LAST_ADMIN_ERROR_MESSAGE =
  'Não é possível concluir a operação: o grupo empresarial precisa manter ao menos um administrador global ativo.';

/** #752 (decisão Rafael 03/08/2026): admin temporário só COM lastro perpétuo. */
export const TEMP_ADMIN_ERROR_MESSAGE =
  'Não é possível conceder administrador global temporário: o grupo precisa ter antes um administrador global permanente.';

/** Limite defensivo p/ subir/descer a árvore de empresas (dado vivo pode corromper). */
const MAX_TREE_DEPTH = 10;

/** Vínculo ADMIN_GLOBAL de plataforma, com perfil ativo. */
const VINCULO_ADMIN_SYSTEM = {
  role: { code: 'ADMIN_GLOBAL', isActive: true, companyId: null },
} as const;

/** Contexto entregue à operação protegida (estado APÓS o lock). */
export interface ContextoDoGrupo {
  rootId: string;
  /** Todas as empresas do grupo (raiz + descendentes, qualquer profundidade). */
  grupoIds: string[];
  /** Admins perpétuos existentes ANTES da operação. */
  adminsPerpetuosAntes: number;
}

@Injectable()
export class LastAdminInvariantService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Executa `operacao` sob o lock do grupo empresarial e valida a invariante
   * antes do commit. A `operacao` recebe o transaction client e o contexto
   * do grupo (contagem pós-lock) e DEVE fazer todas as escritas através do
   * tx — qualquer violação desfaz tudo.
   */
  async executarProtegido<T>(
    companyId: string,
    operacao: (tx: Prisma.TransactionClient, ctx: ContextoDoGrupo) => Promise<T>,
  ): Promise<T> {
    const rootId = await this.resolveRootId(this.prisma, companyId);
    if (!rootId) {
      // Fail-closed: sem grupo resolvido (empresa inexistente, ciclo ou
      // árvore fora do limite) não há como validar a invariante.
      throw new ConflictException(LAST_ADMIN_ERROR_MESSAGE);
    }
    return this.prisma.$transaction(async (tx) => {
      // Lock determinístico do grupo (linha da empresa-raiz): serializa toda
      // operação perigosa do MESMO grupo; grupos diferentes não se bloqueiam.
      await tx.$queryRaw`SELECT "id" FROM "gdr_companies" WHERE "id" = ${rootId} FOR UPDATE`;
      // Membros do grupo resolvidos DEPOIS do lock (a estrutura não muda
      // debaixo de nós enquanto a transação viver).
      const grupoIds = await this.coletarGrupo(tx, rootId);
      const antes = await this.contarAdminsPerpetuos(tx, grupoIds);
      const resultado = await operacao(tx, { rootId, grupoIds, adminsPerpetuosAntes: antes });
      const depois = await this.contarAdminsPerpetuos(tx, grupoIds);
      if (depois === 0 && antes > 0) {
        throw new ConflictException(LAST_ADMIN_ERROR_MESSAGE);
      }
      return resultado;
    });
  }

  /**
   * O usuário tem vínculo ADMIN_GLOBAL PERPÉTUO (o que a invariante conta)?
   * Usado pelos call sites para decidir se a operação precisa do lock —
   * remover/inativar quem não conta na invariante nunca a viola.
   */
  async temVinculoAdminPerpetuo(userId: string): Promise<boolean> {
    // tenant-lint: ok (escopo por userId: atribuições do próprio usuário)
    const count = await this.prisma.userRoleAssignment.count({
      where: { userId, expiresAt: null, ...VINCULO_ADMIN_SYSTEM },
    });
    return count > 0;
  }

  /**
   * O usuário é admin global EFETIVO AGORA (vínculo válido, mesmo que
   * expirável)? Usado pelas sanidades de deny (#752): enquanto administra,
   * não pode ser trancado para fora da própria gestão.
   */
  async ehAdminGlobalEfetivo(userId: string): Promise<boolean> {
    // tenant-lint: ok (escopo por userId: atribuições do próprio usuário)
    const count = await this.prisma.userRoleAssignment.count({
      where: {
        userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        ...VINCULO_ADMIN_SYSTEM,
      },
    });
    return count > 0;
  }

  /**
   * Sobe até a EMPRESA-RAIZ verdadeira (parentId null), com guarda de ciclo
   * e limite de profundidade. `null` = irresolvível → fail-closed no caller.
   */
  private async resolveRootId(
    db: Pick<Prisma.TransactionClient, 'company'>,
    companyId: string,
  ): Promise<string | null> {
    const visitados = new Set<string>();
    let atualId = companyId;
    for (let salto = 0; salto <= MAX_TREE_DEPTH; salto++) {
      if (visitados.has(atualId)) return null; // ciclo — dado corrompido
      visitados.add(atualId);
      const company = await db.company.findUnique({
        where: { id: atualId },
        select: { id: true, parentId: true },
      });
      if (!company) return null;
      if (!company.parentId) return company.id;
      atualId = company.parentId;
    }
    return null; // árvore mais funda que o limite defensivo
  }

  /**
   * Coleta a raiz + TODOS os descendentes (BFS, qualquer profundidade), com
   * guarda de ciclo e limite defensivo.
   */
  private async coletarGrupo(
    tx: Prisma.TransactionClient,
    rootId: string,
  ): Promise<string[]> {
    const grupo = new Set<string>([rootId]);
    let fronteira = [rootId];
    for (let nivel = 0; nivel < MAX_TREE_DEPTH && fronteira.length > 0; nivel++) {
      const filhos = await tx.company.findMany({
        where: { parentId: { in: fronteira } },
        select: { id: true },
      });
      fronteira = filhos.map((f) => f.id).filter((id) => !grupo.has(id));
      fronteira.forEach((id) => grupo.add(id));
    }
    return [...grupo];
  }

  /** Admins perpétuos do grupo — SEMPRE depois do lock, dentro da transação. */
  private contarAdminsPerpetuos(
    tx: Prisma.TransactionClient,
    grupoIds: string[],
  ): Promise<number> {
    // tenant-lint: ok (escopo pelo grupo empresarial: raiz + descendentes, resolvido no servidor)
    return tx.user.count({
      where: {
        isActive: true,
        companyId: { in: grupoIds },
        roleAssignments: { some: { expiresAt: null, ...VINCULO_ADMIN_SYSTEM } },
      },
    });
  }
}
