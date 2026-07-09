import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ProductType, TaxOperationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TaxCalculationService } from '../tax/tax-calculation.service';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface PricingSimulation {
  productId: string;
  sku: string;
  name: string;
  productType: ProductType | null;
  cost: {
    base: number;
    source: 'override' | 'avgCost' | 'costPrice';
    materialFromBom: number | null;
    conversion: number | null; // base − material (MOD + CIF implícito no avgCost)
    breakdown:
      | Array<{ componentId: string; sku: string; name: string; quantity: number; unitCost: number; subtotal: number }>
      | null;
  };
  taxes: {
    ruleId: string | null;
    totalPct: number;
    icmsPct: number;
    ipiPct: number;
    pisPct: number;
    cofinsPct: number;
    warning?: string;
  };
  marginPct: number;
  suggestedPrice: number;
  currentPrice: number | null;
  comparison: {
    delta: number | null; // sugerido − atual
    deltaPct: number | null;
    currentMarginPct: number | null; // margem líquida realizada no preço atual
  };
}

/**
 * #395 Formação de Preço — calculadora custo + impostos + margem desejada.
 *
 * Fórmula markup (proposta consultoria Wellington §5.4): o preço embute a
 * margem e os impostos como percentuais do próprio preço de venda:
 *
 *     preço = custo / (1 − margem% − impostos%)
 *
 * Simplificação assumida: IPI é somado à carga como percentual do preço
 * (na NF-e o IPI incide "por fora"); para formação de preço-alvo essa é a
 * aproximação pedida pela consultoria. Os percentuais de imposto vêm da
 * TaxRule real do produto (reuso de TaxCalculationService.findBestRule),
 * cenário venda interna (ufOrigem = ufDestino = UF da empresa).
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taxCalc: TaxCalculationService,
  ) {}

  async simulate(
    companyId: string,
    productId: string,
    marginPct: number,
    opts: { costOverride?: number } = {},
  ): Promise<PricingSimulation> {
    if (!Number.isFinite(marginPct) || marginPct < 0) {
      throw new BadRequestException('marginPct deve ser um número ≥ 0');
    }
    if (opts.costOverride != null && (!Number.isFinite(opts.costOverride) || opts.costOverride < 0)) {
      throw new BadRequestException('costOverride deve ser um número ≥ 0');
    }

    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId },
      select: {
        id: true,
        sku: true,
        name: true,
        ncm: true,
        type: true,
        avgCost: true,
        costPrice: true,
        salePrice: true,
      },
    });
    if (!product) throw new NotFoundException(`Produto ${productId} não encontrado`);

    // ─── Custo real ──────────────────────────────────────────────────────────
    const avgCost = product.avgCost != null ? Number(product.avgCost) : null;
    const costPrice = product.costPrice != null ? Number(product.costPrice) : null;

    let base: number;
    let source: PricingSimulation['cost']['source'];
    if (opts.costOverride != null) {
      base = opts.costOverride;
      source = 'override';
    } else if (avgCost != null && avgCost > 0) {
      base = avgCost;
      source = 'avgCost';
    } else if (costPrice != null && costPrice > 0) {
      base = costPrice;
      source = 'costPrice';
    } else {
      throw new UnprocessableEntityException(
        `Produto ${product.sku} sem custo cadastrado (avgCost/costPrice) — informe costOverride ou cadastre o custo`,
      );
    }

    const { materialFromBom, breakdown } = await this.explodeBom(companyId, productId);
    const conversion = materialFromBom != null ? round2(base - materialFromBom) : null;

    // ─── Impostos reais (TaxRule) — cenário venda interna ────────────────────
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { state: true },
    });
    const uf = company?.state ?? 'PR';

    const rule = await this.taxCalc.findBestRule({
      companyId,
      // string literal (não a constante do enum) — o mock jest de @prisma/client
      // não exporta TaxOperationType; mesmo padrão de sales/fiscal.service
      operationType: 'VENDA_INTERNA' as TaxOperationType,
      ncm: product.ncm ?? undefined,
      productType: product.type ?? undefined,
      ufOrigem: uf,
      ufDestino: uf,
      origem: '0',
    });

    let icmsPct = 0;
    let ipiPct = 0;
    let pisPct = 0;
    let cofinsPct = 0;
    let ruleId: string | null = null;
    let warning: string | undefined;

    if (rule) {
      ruleId = rule.id;
      // ICMS efetivo já aplica a redução de base
      icmsPct = round2(Number(rule.icmsAliquota) * Number(rule.icmsBaseReducao) / 100);
      ipiPct = Number(rule.ipiAliquota);
      // CST 99 (outras operações) emite base 0 — não onera o preço (espelha o cálculo fiscal)
      pisPct = rule.pisCst === '99' ? 0 : Number(rule.pisAliquota);
      cofinsPct = rule.cofinsCst === '99' ? 0 : Number(rule.cofinsAliquota);
    } else {
      warning = 'Sem TaxRule para o produto (venda interna) — impostos não considerados no preço sugerido';
    }

    const totalPct = round2(icmsPct + ipiPct + pisPct + cofinsPct);

    // ─── Markup ──────────────────────────────────────────────────────────────
    const denom = 1 - marginPct / 100 - totalPct / 100;
    if (denom <= 0) {
      throw new BadRequestException(
        `Margem (${marginPct}%) + impostos (${totalPct}%) ≥ 100% — preço inviável pela fórmula de markup`,
      );
    }
    const suggestedPrice = round2(base / denom);

    // ─── Comparativo com o preço atual ───────────────────────────────────────
    const currentPrice = product.salePrice != null ? Number(product.salePrice) : null;
    let delta: number | null = null;
    let deltaPct: number | null = null;
    let currentMarginPct: number | null = null;
    if (currentPrice != null && currentPrice > 0) {
      delta = round2(suggestedPrice - currentPrice);
      deltaPct = round2((delta / currentPrice) * 100);
      // margem líquida realizada hoje: (preço − impostos − custo) / preço
      currentMarginPct = round2(
        ((currentPrice * (1 - totalPct / 100) - base) / currentPrice) * 100,
      );
    }

    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      productType: product.type ?? null,
      cost: { base: round2(base), source, materialFromBom, conversion, breakdown },
      taxes: { ruleId, totalPct, icmsPct, ipiPct, pisPct, cofinsPct, warning },
      marginPct,
      suggestedPrice,
      currentPrice,
      comparison: { delta, deltaPct, currentMarginPct },
    };
  }

  /**
   * Explode a BOM ativa do produto para mostrar quais matérias-primas compõem
   * o custo (apoia a simulação de variação de custo de MP). Retorna null quando
   * o produto não tem BOM ativa (ex.: MP comprada, não fabricada).
   */
  private async explodeBom(
    companyId: string,
    productId: string,
  ): Promise<{
    materialFromBom: number | null;
    breakdown: PricingSimulation['cost']['breakdown'];
  }> {
    const bom = await this.prisma.bomVersion.findFirst({
      where: { productId, companyId, isActive: true },
      include: { items: { include: { component: true } } },
    });
    if (!bom || bom.items.length === 0) {
      return { materialFromBom: null, breakdown: null };
    }

    let material = 0;
    const breakdown = bom.items.map((item) => {
      const qty = Number(item.quantity) * (1 + Number(item.scrapPct) / 100);
      const unitCost = Number(item.component.avgCost ?? item.component.costPrice ?? 0);
      const subtotal = round2(qty * unitCost);
      material += subtotal;
      return {
        componentId: item.componentId,
        sku: item.component.sku,
        name: item.component.name,
        quantity: round2(qty),
        unitCost: round2(unitCost),
        subtotal,
      };
    });

    return { materialFromBom: round2(material), breakdown };
  }
}
