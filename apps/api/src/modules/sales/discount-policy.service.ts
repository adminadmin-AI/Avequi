import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionService } from '../iam/permission.service';

/**
 * Alçadas de desconto (#391, Wellington 5.4 Pricing).
 *
 * Desconto implícito do item = (salePrice − unitPrice) / salePrice. Cada papel
 * tem um teto (DiscountPolicy); vender acima do teto bloqueia a criação da OV
 * com mensagem orientada (quem pode aprovar).
 *
 * ── #947: quem ultrapassa o teto ──────────────────────────────────────────
 * ANTES, o "sem teto" era hardcoded no enum: `userRole === 'SUPER_ADMIN'`
 * virava 100% mesmo sem política cadastrada. Agora quem ultrapassa é quem tem
 * a PERMISSÃO `sales.discount.override` — o enum não concede mais nada aqui.
 *
 * A TABELA de tetos continua indexada pelo enum nesta fase (decisão Rafael:
 * sem migration de `DiscountPolicy.role` agora). Ela é CONFIGURAÇÃO da
 * empresa, editável na tela de alçadas — não é poder embutido em código. O
 * que saiu foi a exceção hardcoded; migrar o eixo da tabela para perfil v2
 * é trabalho da #948.
 *
 * ⚠️ A checagem NÃO honra o fallback legado do #946 de propósito: o espelho
 * do enum SUPER_ADMIN é o ADMIN_GLOBAL, que TEM esta permissão — honrá-lo
 * devolveria pelo enum o poder que este PR está tirando dele.
 */

/**
 * Alçadas semeadas por padrão — a escada aprovada na issue #391:
 * "0-10% livre, 10-20% gerente, >20% diretor".
 *
 * #947: as linhas `DIRECTOR: 100` e `SUPER_ADMIN: 100` SAÍRAM daqui. Elas
 * nunca foram alçada aprovada: eram o jeito que o código de #391 encontrou de
 * escrever ">20% é do diretor", ou seja "o diretor não tem teto". Sob o #947,
 * "não ter teto" deixou de ser um valor de tabela e passou a ser a permissão
 * `sales.discount.override` — quem a tem ultrapassa qualquer alçada.
 */
export const DEFAULT_DISCOUNT_POLICIES = [
  { role: 'COMMERCIAL', maxDiscountPct: 10 },
  { role: 'STORE', maxDiscountPct: 10 },
  { role: 'MANAGER', maxDiscountPct: 20 },
];

const FALLBACK_LIMIT = 10; // papel sem política cadastrada (faixa "livre" do #391)

/**
 * 100% = preço zero = dar o produto. Isso não é uma ALÇADA, é a AUSÊNCIA de
 * alçada — o topo matemático da escala, não um patamar de negócio.
 *
 * Não é percentual inventado: é o valor que a tabela usava para dizer "sem
 * teto", e é exatamente o que está semeado em produção para DIRECTOR e
 * SUPER_ADMIN (verificado em consulta read-only, sem nenhum registro de
 * auditoria — ninguém jamais editou essas linhas; são herança do seed).
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
    return this.prisma.discountPolicy.findMany({
      where: { companyId },
      orderBy: { maxDiscountPct: 'asc' },
    });
  }

  async seedDefaults(companyId: string) {
    let created = 0;
    for (const p of DEFAULT_DISCOUNT_POLICIES) {
      const exists = await this.prisma.discountPolicy.findFirst({
        where: { companyId, role: p.role },
        select: { id: true },
      });
      if (exists) continue;
      await this.prisma.discountPolicy.create({ data: { companyId, ...p } });
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
    return this.prisma.discountPolicy.update({ where: { id }, data: dto });
  }

  /**
   * Valida os itens da OV contra a alçada. Lança BadRequest com o detalhe
   * (item, desconto, teto, quem aprova) quando excede — a menos que quem
   * opera tenha `sales.discount.override` (#947).
   *
   * `userId` ausente = operação de SISTEMA (listener/scheduler, contexto
   * SYSTEM do #347-B). Aí não há a quem perguntar permissão: a alçada é
   * aplicada sem override, que é o lado seguro — sistema não vende com
   * desconto excepcional em nome de ninguém.
   */
  async assertWithinLimit(
    companyId: string,
    userRole: string | undefined,
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

    const policies = await this.prisma.discountPolicy.findMany({
      where: { companyId, isActive: true },
    });
    const own = policies.find((p) => p.role === userRole);
    // #947: sem exceção por enum. Papel sem política = teto default, seja ele
    // SUPER_ADMIN ou VENDEDOR — quem passa do teto é quem tem a permissão.
    //
    // E o buraco que faltava fechar: uma política de 100% (herança do seed
    // legado para DIRECTOR/SUPER_ADMIN) NÃO é alçada — é ausência de alçada
    // escrita como dado. Sem esta linha, um usuário com enum congelado em
    // DIRECTOR nunca chegaria na checagem de permissão, porque desconto
    // nenhum "ultrapassa" 100% — e o poder que o #947 tira pelo código
    // voltaria inteiro pela tabela.
    const politicaSemTeto = !!own && Number(own.maxDiscountPct) >= TETO_EQUIVALENTE_A_SEM_TETO;
    const limit = own && !politicaSemTeto ? Number(own.maxDiscountPct) : FALLBACK_LIMIT;

    if (maxDiscount <= limit) return;

    // #947: override por PERMISSÃO. Só depois de saber que estourou o teto —
    // não gastar uma resolução de permissão em toda venda dentro da alçada.
    if (userId && (await this.podeUltrapassar(userId, companyId))) return;

    // quem tem alçada suficiente (para orientar o vendedor)
    // #947: política "sem teto" (100%) não conta como aprovador — quem
    // aprova desconto excepcional é quem tem a PERMISSÃO, não quem herdou uma
    // linha de 100% do seed antigo.
    const aprovadores = policies
      .filter(
        (p) =>
          Number(p.maxDiscountPct) >= maxDiscount &&
          Number(p.maxDiscountPct) < TETO_EQUIVALENTE_A_SEM_TETO,
      )
      .map((p) => p.role)
      .join(', ');

    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: 'SalesOrder',
        action: 'DISCOUNT_BLOCKED',
        payload: {
          sku: worst.sku,
          discountPct: worst.discount,
          role: userRole ?? null,
          limit,
          // #947: deixa explícito na trilha que o bloqueio foi por AUSÊNCIA da
          // permissão, não por um enum "fraco" — quem investigar o caso vê o
          // que precisa conceder.
          missingPermission: DISCOUNT_OVERRIDE_PERMISSION,
          // #947: deixa rastro quando o teto veio do default por a política do
          // papel ser "sem teto" (100%) — o caso do enum legado congelado.
          ...(politicaSemTeto ? { ignoredUncappedPolicy: true } : {}),
        },
      },
    });

    throw new BadRequestException(
      `Desconto de ${worst.discount}% no item ${worst.sku} excede sua alçada (teto ${limit}% para ${userRole ?? 'seu papel'}). ` +
        (aprovadores
          ? `Peça a criação da venda a: ${aprovadores}.`
          : 'Nenhum papel tem alçada para este desconto — ajuste o preço ou ' +
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

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
