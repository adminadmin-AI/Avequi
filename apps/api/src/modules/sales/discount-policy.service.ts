import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionService } from '../iam/permission.service';

/**
 * Alçadas de desconto (#391, Wellington 5.4 Pricing).
 *
 * Desconto implícito do item = (salePrice − unitPrice) / salePrice. Cada
 * PERFIL tem um teto (DiscountPolicy); vender acima do teto bloqueia a
 * criação da OV com mensagem orientada (quem pode aprovar).
 *
 * ── #947: quem ultrapassa o teto ──────────────────────────────────────────
 * ANTES, o "sem teto" era hardcoded no enum: `userRole === 'SUPER_ADMIN'`
 * virava 100% mesmo sem política cadastrada. Agora quem ultrapassa é quem tem
 * a PERMISSÃO `sales.discount.override` — o enum não concede mais nada aqui.
 *
 * ── #1004 (IAM C5): o EIXO da tabela saiu do enum ─────────────────────────
 * A tabela de tetos deixou de ser indexada pelo enum `UserRole` congelado e
 * passou a apontar para o PERFIL v2 (`DiscountPolicy.roleId` → `Role`). O
 * teto de quem opera é resolvido pelos perfis VIGENTES dele
 * (`UserRoleAssignment`, direto — herança de perfil não transfere alçada):
 * com mais de um perfil com política, vale a MAIOR alçada; sem nenhum perfil
 * com política, vale o FALLBACK. O enum não participa de mais nada — nem
 * poder (#947) nem teto (#1004).
 *
 * ⚠️ A checagem NÃO honra o fallback legado do #946 de propósito: usuário sem
 * RBAC v2 cai no teto default, nunca no espelho do enum — honrá-lo devolveria
 * pelo enum o que o #947/#1004 tiraram dele.
 */

/**
 * Alçadas semeadas por padrão — a escada aprovada na issue #391
 * ("0-10% livre, 10-20% gerente, >20% diretor"), agora por perfil v2 (#1004):
 * os codes são os espelhos system dos enums que o seed antigo usava
 * (COMMERCIAL→VENDEDOR, STORE→LOJA_OPERACIONAL, MANAGER→GERENTE_GERAL).
 *
 * #947: as linhas `DIRECTOR: 100` e `SUPER_ADMIN: 100` SAÍRAM daqui. Elas
 * nunca foram alçada aprovada: eram o jeito que o código de #391 encontrou de
 * escrever "o diretor não tem teto". Sob o #947, "não ter teto" deixou de ser
 * um valor de tabela e passou a ser a permissão `sales.discount.override`.
 */
export const DEFAULT_DISCOUNT_POLICIES = [
  { roleCode: 'VENDEDOR', maxDiscountPct: 10 },
  { roleCode: 'LOJA_OPERACIONAL', maxDiscountPct: 10 },
  { roleCode: 'GERENTE_GERAL', maxDiscountPct: 20 },
];

const FALLBACK_LIMIT = 10; // perfil sem política cadastrada (faixa "livre" do #391)

/**
 * 100% = preço zero = dar o produto. Isso não é uma ALÇADA, é a AUSÊNCIA de
 * alçada — o topo matemático da escala, não um patamar de negócio.
 *
 * Não é percentual inventado: é o valor que a tabela usava para dizer "sem
 * teto" (herança do seed para DIRECTOR/SUPER_ADMIN). A migration da #1004
 * DESATIVA essas duas linhas em produção; o guarda continua aqui porque um
 * toggle de isActive poderia ressuscitá-las.
 */
const TETO_EQUIVALENTE_A_SEM_TETO = 100;

/** Permissão que autoriza vender acima do teto configurado (#947). */
export const DISCOUNT_OVERRIDE_PERMISSION = 'sales.discount.override';

@Injectable()
export class DiscountPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {}

  findAll(companyId: string) {
    // #1004: a tela mostra o NOME do perfil, não o enum — o code vai junto
    // para chave/ordenação estável no front.
    return this.prisma.discountPolicy.findMany({
      where: { companyId },
      include: { roleRef: { select: { id: true, code: true, name: true } } },
      orderBy: { maxDiscountPct: 'asc' },
    });
  }

  async seedDefaults(companyId: string) {
    let created = 0;
    for (const p of DEFAULT_DISCOUNT_POLICIES) {
      // Perfis system são globais (companyId null) — catálogo semeado pelo IAM v2.
      // tenant-lint: ok (perfil global do sistema; a política criada é da empresa)
      const role = await this.prisma.role.findFirst({
        where: { code: p.roleCode, companyId: null, isSystem: true, isActive: true },
        select: { id: true },
      });
      if (!role) {
        // Catálogo IAM ausente = ambiente sem seed v2. Semear alçada sem
        // perfil recriaria o eixo cego que a #1004 aposentou — melhor falhar.
        throw new BadRequestException(
          `Perfil do sistema "${p.roleCode}" não encontrado. Rode o seed do IAM v2 antes de criar as alçadas padrão.`,
        );
      }
      const exists = await this.prisma.discountPolicy.findFirst({
        where: { companyId, roleId: role.id },
        select: { id: true },
      });
      if (exists) continue;
      await this.prisma.discountPolicy.create({
        data: { companyId, roleId: role.id, maxDiscountPct: p.maxDiscountPct },
      });
      created++;
    }
    return { created, total: DEFAULT_DISCOUNT_POLICIES.length };
  }

  async update(id: string, companyId: string, dto: { maxDiscountPct?: number; isActive?: boolean }) {
    const policy = await this.prisma.discountPolicy.findFirst({ where: { id, companyId } });
    if (!policy) throw new NotFoundException(`Alçada ${id} não encontrada`);
    // #947: impede recavar o buraco. Configurar 100% seria conceder override
    // ilimitado por DADO, contornando a permissão — e sem deixar rastro de que
    // foi isso que aconteceu. Alçada é teto; ausência de teto é permissão.
    if (
      dto.maxDiscountPct !== undefined &&
      dto.maxDiscountPct >= TETO_EQUIVALENTE_A_SEM_TETO
    ) {
      throw new BadRequestException(
        `Teto de ${TETO_EQUIVALENTE_A_SEM_TETO}% não é uma alçada — é desconto sem limite (preço zero). ` +
          `Para permitir desconto acima da alçada, conceda a permissão "${DISCOUNT_OVERRIDE_PERMISSION}" ` +
          'ao perfil, em Perfis e permissões.',
      );
    }
    // #1004: reativar uma linha de 100% herdada do seed ressuscitaria o "sem
    // teto por dado" que a migration desativou — mesmo buraco, outra porta.
    // Vale o teto EFETIVO pós-update: reativar corrigindo o teto no mesmo
    // pedido (isActive:true + maxDiscountPct:15) é legítimo e passa.
    const tetoEfetivo = dto.maxDiscountPct ?? Number(policy.maxDiscountPct);
    if (dto.isActive === true && tetoEfetivo >= TETO_EQUIVALENTE_A_SEM_TETO) {
      throw new BadRequestException(
        `Esta linha tem teto de ${TETO_EQUIVALENTE_A_SEM_TETO}% (herança do seed antigo) e não pode ser reativada. ` +
          `Para desconto sem limite, conceda a permissão "${DISCOUNT_OVERRIDE_PERMISSION}" ao perfil.`,
      );
    }
    return this.prisma.discountPolicy.update({ where: { id }, data: dto });
  }

  /**
   * Valida os itens da OV contra a alçada. Lança BadRequest com o detalhe
   * (item, desconto, teto, quem aprova) quando excede — a menos que quem
   * opera tenha `sales.discount.override` (#947).
   *
   * #1004: o teto vem dos PERFIS v2 vigentes do usuário. Mais de um perfil
   * com política = a maior alçada vale (perfis somam capacidades, nunca se
   * subtraem). Nenhum perfil com política = FALLBACK_LIMIT.
   *
   * `userId` ausente = operação de SISTEMA (listener/scheduler, contexto
   * SYSTEM do #347-B). Aí não há perfis a resolver nem a quem perguntar
   * permissão: vale o teto default sem override, que é o lado seguro —
   * sistema não vende com desconto excepcional em nome de ninguém.
   */
  async assertWithinLimit(
    companyId: string,
    items: Array<{ productId: string; unitPrice: number }>,
    userId?: string,
  ) {
    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId },
      select: { id: true, sku: true, salePrice: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    let maxDiscount = 0;
    let worst: { sku: string; discount: number } | null = null;
    for (const i of items) {
      const p = byId.get(i.productId);
      // Produto que não é desta empresa (ou não existe) nunca deve chegar
      // numa OV — deixar passar aqui significava vender um id arbitrário sem
      // nenhuma base de preço para comparar.
      if (!p) {
        throw new BadRequestException(
          `Produto ${i.productId} não encontrado nesta empresa.`,
        );
      }
      const salePrice = Number(p.salePrice ?? 0);
      // Produto sem preço de tabela segue SEM validação de alçada, e isso é
      // um buraco conhecido: o `unitPrice` do corpo passa sem teto, porque não
      // há base com o que comparar.
      //
      // O fail-closed (recusar a venda) foi escrito e revertido antes de ir ao
      // ar: 338 dos 339 produtos ativos da GDR têm `salePrice` nulo, então a
      // regra recusaria o catálogo inteiro, em qualquer papel, logo no POST
      // /sales. E o dado não está faltando por descuido — reboque é vendido
      // por negociação, não por tabela; exigir a base assume um modelo de
      // negócio que não é o do cliente.
      //
      // Fechar de verdade exige decidir ANTES o que é a base de preço nesse
      // modelo (preço mínimo? custo + margem?). Enquanto isso não é decidido,
      // recusar a venda troca um risco interno controlado por RBAC por uma
      // parada de operação. Ver a issue de alçada sem tabela de preço.
      if (salePrice <= 0) continue;
      const discount = ((salePrice - Number(i.unitPrice)) / salePrice) * 100;
      if (discount > maxDiscount) {
        maxDiscount = discount;
        worst = { sku: p.sku, discount: round1(discount) };
      }
    }
    if (!worst || maxDiscount <= 0) return; // sem desconto — nada a validar

    // #1004: perfis v2 VIGENTES de quem opera — a definição de "vigente" mora
    // no PermissionService (mesma regra do resolvedor de permissões). Direto,
    // sem herança: "Supervisor herda permissões de Operador" não significa
    // "Supervisor tem a alçada de Operador" — alçada é atribuída, não
    // deduzida. Contexto SYSTEM (sem userId) não tem perfil: lista vazia.
    const [policies, meusPerfis] = await Promise.all([
      this.prisma.discountPolicy.findMany({
        where: { companyId, isActive: true },
      }),
      userId
        ? this.permissions.getVigentAssignments(userId, companyId)
        : Promise.resolve([]),
    ]);
    const meusRoleIds = new Set(meusPerfis.map((a) => a.roleId));

    const minhasPoliticas = policies.filter((p) => p.roleId && meusRoleIds.has(p.roleId));
    // #947: política de 100% NÃO é alçada — é ausência de alçada escrita como
    // dado (herança do seed para DIRECTOR/SUPER_ADMIN). A migration da #1004
    // as desativa, mas o filtro fica: reativada, ela devolveria por DADO o
    // poder que virou a permissão de override.
    const comTeto = minhasPoliticas.filter(
      (p) => Number(p.maxDiscountPct) < TETO_EQUIVALENTE_A_SEM_TETO,
    );
    const politicaSemTeto = minhasPoliticas.length > comTeto.length;
    // Mais de um perfil com política: vale a MAIOR alçada (capacidades somam).
    const limit = comTeto.length
      ? Math.max(...comTeto.map((p) => Number(p.maxDiscountPct)))
      : FALLBACK_LIMIT;

    if (maxDiscount <= limit) return;

    // #947: override por PERMISSÃO. Só depois de saber que estourou o teto —
    // não gastar uma resolução de permissão em toda venda dentro da alçada.
    if (userId && (await this.podeUltrapassar(userId, companyId))) return;

    // quem tem alçada suficiente (para orientar o vendedor) — pelo NOME do
    // perfil (#1004). Só se resolve AQUI, no ramo do bloqueio: a venda dentro
    // da alçada (o caminho quente) não paga esse lookup. Política "sem teto"
    // (100%) não conta como aprovador: quem aprova desconto excepcional é
    // quem tem a PERMISSÃO (#947). Linha legada sem roleId fica de fora — o
    // enum cru não é nome apresentável.
    const aprovadorRoleIds = policies
      .filter(
        (p) =>
          p.roleId &&
          Number(p.maxDiscountPct) >= maxDiscount &&
          Number(p.maxDiscountPct) < TETO_EQUIVALENTE_A_SEM_TETO,
      )
      .map((p) => p.roleId as string);
    // tenant-lint: ok (ids vêm de políticas já filtradas pela empresa; perfis
    // system são globais, companyId null)
    const aprovadores = aprovadorRoleIds.length
      ? (
          await this.prisma.role.findMany({
            where: { id: { in: aprovadorRoleIds } },
            select: { name: true },
          })
        )
          .map((r) => r.name)
          .join(', ')
      : '';

    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: 'SalesOrder',
        action: 'DISCOUNT_BLOCKED',
        payload: {
          sku: worst.sku,
          discountPct: worst.discount,
          // #1004: a trilha registra os PERFIS v2 de quem operou (o eixo real
          // do teto), não mais o enum congelado.
          roleCodes: meusPerfis.map((a) => a.role.code),
          limit,
          // #947: deixa explícito na trilha que o bloqueio foi por AUSÊNCIA da
          // permissão, não por um enum "fraco" — quem investigar o caso vê o
          // que precisa conceder.
          missingPermission: DISCOUNT_OVERRIDE_PERMISSION,
          // #947: deixa rastro quando alguma política do usuário foi
          // desconsiderada por ser "sem teto" (100%) — o caso do seed legado.
          ...(politicaSemTeto ? { ignoredUncappedPolicy: true } : {}),
        },
      },
    });

    throw new BadRequestException(
      `Desconto de ${worst.discount}% no item ${worst.sku} excede sua alçada (teto ${limit}%). ` +
        (aprovadores
          ? `Peça a criação da venda a: ${aprovadores}.`
          : 'Nenhum perfil tem alçada para este desconto — ajuste o preço ou ' +
            `peça a quem tenha a permissão "${DISCOUNT_OVERRIDE_PERMISSION}".`),
    );
  }

  /**
   * Quem opera pode ultrapassar o teto? (#947)
   *
   * Usa `hasAnyPermission`, que resolve o RBAC v2 puro — SEM o fallback
   * legado do #946 (ver cabeçalho). Falha na resolução propaga: negar acesso
   * por erro de infraestrutura é o lado seguro num poder de exceção.
   */
  private podeUltrapassar(userId: string, companyId: string): Promise<boolean> {
    return this.permissions.hasAnyPermission(userId, companyId, [
      DISCOUNT_OVERRIDE_PERMISSION,
    ]);
  }
}

/**
 * Arredonda o desconto exibido para CIMA (1 casa): 15.04% mostrado como
 * "15.1%" nunca contradiz o teto de 15% que causou o bloqueio — arredondar
 * para baixo mostraria "15%" numa venda recusada por exceder 15%.
 */
function round1(v: number): number {
  return Math.ceil(v * 10) / 10;
}
