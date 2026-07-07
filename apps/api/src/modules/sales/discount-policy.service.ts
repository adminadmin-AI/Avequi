import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Alçadas de desconto (#391, Wellington 5.4 Pricing).
 *
 * Desconto implícito do item = (salePrice − unitPrice) / salePrice. Cada papel
 * tem um teto (DiscountPolicy); vender acima do teto do próprio papel bloqueia
 * a criação da OV com mensagem orientada (quem pode aprovar). SUPER_ADMIN sem
 * política cadastrada = sem teto; demais papéis sem política = teto default 10%.
 */

export const DEFAULT_DISCOUNT_POLICIES = [
  { role: 'COMMERCIAL', maxDiscountPct: 10 },
  { role: 'STORE', maxDiscountPct: 10 },
  { role: 'MANAGER', maxDiscountPct: 20 },
  { role: 'DIRECTOR', maxDiscountPct: 100 },
  { role: 'SUPER_ADMIN', maxDiscountPct: 100 },
];

const FALLBACK_LIMIT = 10; // papel sem política cadastrada

@Injectable()
export class DiscountPolicyService {
  constructor(private readonly prisma: PrismaService) {}

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
    return this.prisma.discountPolicy.update({ where: { id }, data: dto });
  }

  /**
   * Valida os itens da OV contra a alçada do papel. Lança BadRequest com o
   * detalhe (item, desconto, teto, quem aprova) quando excede.
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
      const salePrice = Number(p?.salePrice ?? 0);
      if (!p || salePrice <= 0) continue; // sem preço de tabela = sem base de alçada
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
    const limit = own ? Number(own.maxDiscountPct) : userRole === 'SUPER_ADMIN' ? 100 : FALLBACK_LIMIT;

    if (maxDiscount <= limit) return;

    // quem tem alçada suficiente (para orientar o vendedor)
    const aprovadores = policies
      .filter((p) => Number(p.maxDiscountPct) >= maxDiscount)
      .map((p) => p.role)
      .join(', ');

    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: 'SalesOrder',
        action: 'DISCOUNT_BLOCKED',
        payload: { sku: worst.sku, discountPct: worst.discount, role: userRole ?? null, limit },
      },
    });

    throw new BadRequestException(
      `Desconto de ${worst.discount}% no item ${worst.sku} excede sua alçada (teto ${limit}% para ${userRole ?? 'seu papel'}). ` +
        (aprovadores
          ? `Peça a criação da venda a: ${aprovadores}.`
          : 'Nenhum papel tem alçada para este desconto — ajuste o preço.'),
    );
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
