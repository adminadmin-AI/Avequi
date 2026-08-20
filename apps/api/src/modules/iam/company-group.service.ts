import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * CompanyGroupService — GRUPO ECONÔMICO (#1119), lado LEITURA.
 *
 * Responde a duas perguntas, e só a estas duas:
 *   1. "quais empresas formam o grupo econômico desta aqui?"  → empresasDoGrupo
 *   2. "esta pessoa pode assumir aquela empresa?"             → empresasDoUsuario
 *
 * A ESCRITA do grupo (criar, associar, desassociar tenant) mora no control
 * plane da operadora — `modules/ops/groups.service.ts`. Aqui ninguém cria
 * laço nenhum: se a operadora não declarou o grupo, toda pergunta cruzada
 * responde "não".
 *
 * ── Por que não reusa o TenantScopeService ────────────────────────────────
 * O #947 resolve outra coisa: "quais empresas esta consulta pode LER de uma
 * vez" (ampliação de escopo de listagem administrativa, dentro de um tenant).
 * Aqui é "em qual empresa esta sessão pode TRABALHAR, uma por vez" — e o eixo
 * é o grupo econômico entre tenants distintos, que o #947 deliberadamente não
 * atravessa. Compartilhar o serviço misturaria as duas fronteiras.
 *
 * ── Duas travas ───────────────────────────────────────────────────────────
 *  1. **O vínculo manda, não o grupo.** Estar no mesmo grupo NÃO dá acesso a
 *     nada: só torna o acesso *concedível*. Quem abre a porta é o
 *     `UserRoleAssignment` na empresa destino. Grupo sem vínculo = zero.
 *  2. **Fail-closed.** Erro de banco, empresa sem grupo, ciclo na árvore →
 *     devolve o recorte mínimo (a própria empresa). Indisponibilidade nunca
 *     amplia.
 */
@Injectable()
export class CompanyGroupService {
  private readonly logger = new Logger(CompanyGroupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Raiz do tenant de uma empresa — MESMO critério do billing
   * (`EntitlementService.rootIdOf`): um hop, `parentId ?? id`. A árvore real é
   * MATRIZ→FILIAL e o grupo econômico é declarado sempre na raiz.
   */
  async raizDe(companyId: string): Promise<string> {
    // tenant-lint: ok (resolução de árvore de empresas — o id É o tenant)
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, parentId: true },
    });
    return company?.parentId ?? companyId;
  }

  /**
   * Todas as empresas do grupo econômico de `companyId` — as raízes
   * declaradas no grupo MAIS as filiais de cada uma.
   *
   * Sem grupo declarado, o "grupo" é o próprio tenant (raiz + filiais): é o
   * que já valia antes do #1119, e é o que mantém a resposta útil para os
   * milhares de tenants que nunca vão ter grupo nenhum.
   */
  async empresasDoGrupo(companyId: string): Promise<string[]> {
    try {
      const raiz = await this.raizDe(companyId);
      // tenant-lint: ok (resolução de árvore de empresas — o id É o tenant)
      const empresa = await this.prisma.company.findUnique({
        where: { id: raiz },
        select: { groupId: true },
      });

      const raizes = empresa?.groupId
        ? (
            await this.prisma.company.findMany({
              // tenant-lint: ok (grupo econômico declarado pela operadora, #1119)
              where: { groupId: empresa.groupId, parentId: null },
              select: { id: true },
            })
          ).map((c) => c.id)
        : [raiz];

      // Raiz sozinha num grupo (ou grupo sumido) nunca devolve lista vazia.
      const raizesEfetivas = raizes.length > 0 ? raizes : [raiz];

      const filiais = await this.prisma.company.findMany({
        // tenant-lint: ok (filiais das raízes já autorizadas acima)
        where: { parentId: { in: raizesEfetivas } },
        select: { id: true },
      });

      return [...new Set([...raizesEfetivas, ...filiais.map((f) => f.id)])];
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'company_group_resolve_error',
          companyId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      // Fail-closed: só a própria empresa.
      return [companyId];
    }
  }

  /**
   * As empresas que o usuário pode ASSUMIR como empresa ativa: aquelas onde
   * ele tem perfil vigente E que estão no grupo econômico da empresa-casa.
   *
   * A dupla condição não é redundância: o vínculo pode ter sido criado quando
   * o grupo existia e sobreviver à desassociação (a remoção limpa os vínculos,
   * mas é best-effort e pode falhar no meio). Conferir os dois eixos a cada
   * troca faz a desassociação valer na hora, mesmo com limpeza parcial.
   *
   * A empresa-casa entra SEMPRE, com ou sem perfil v2 — é a empresa do
   * cadastro, e tirá-la da lista trancaria para fora quem ainda não tem
   * vínculo v2 nenhum.
   */
  async empresasDoUsuario(userId: string, homeCompanyId: string): Promise<string[]> {
    try {
      const doGrupo = new Set(await this.empresasDoGrupo(homeCompanyId));
      const agora = new Date();

      const vinculos = await this.prisma.userRoleAssignment.findMany({
        // tenant-lint: ok (vínculos do próprio usuário; o filtro de empresa é o Set abaixo)
        where: {
          userId,
          OR: [{ expiresAt: null }, { expiresAt: { gt: agora } }],
          role: { isActive: true },
        },
        select: { companyId: true },
      });

      const permitidas = vinculos
        .map((v) => v.companyId)
        .filter((id) => doGrupo.has(id));

      return [...new Set([homeCompanyId, ...permitidas])];
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'company_group_user_scope_error',
          userId,
          homeCompanyId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return [homeCompanyId];
    }
  }

  /** O usuário pode assumir esta empresa como ativa? */
  async podeAssumir(
    userId: string,
    homeCompanyId: string,
    destinoCompanyId: string,
  ): Promise<boolean> {
    const permitidas = await this.empresasDoUsuario(userId, homeCompanyId);
    return permitidas.includes(destinoCompanyId);
  }
}
