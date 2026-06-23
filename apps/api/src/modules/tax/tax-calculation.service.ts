import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TaxOperationType, ProductType, Prisma } from '@prisma/client';

export interface TaxInput {
  companyId: string;
  operationType: TaxOperationType;
  ncm?: string;
  productType?: ProductType;
  ufOrigem: string;
  ufDestino: string;
  itemValue: number; // valor total do item (qty × unitPrice)
}

export interface TaxResult {
  cfop: string;
  icms: { cst: string; baseCalculo: number; aliquota: number; valor: number };
  ipi: { cst: string; baseCalculo: number; aliquota: number; valor: number };
  pis: { cst: string; baseCalculo: number; aliquota: number; valor: number };
  cofins: { cst: string; baseCalculo: number; aliquota: number; valor: number };
  totalTributos: number;
}

/** Regra padrão quando nenhuma TaxRule específica é encontrada */
const FALLBACK_RULE = {
  cfop: '5102',
  icmsCst: '00',
  icmsAliquota: new Prisma.Decimal(18),
  icmsBaseReducao: new Prisma.Decimal(100),
  ipiCst: '99',
  ipiAliquota: new Prisma.Decimal(0),
  pisCst: '01',
  pisAliquota: new Prisma.Decimal(0.65),
  cofinsCst: '01',
  cofinsAliquota: new Prisma.Decimal(3),
};

@Injectable()
export class TaxCalculationService {
  private readonly logger = new Logger(TaxCalculationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async calculateTaxes(input: TaxInput): Promise<TaxResult> {
    const rule = await this.findBestRule(input);

    if (!rule) {
      this.logger.warn(
        `Nenhuma TaxRule encontrada para ${input.operationType} ${input.ufOrigem}→${input.ufDestino}. Usando fallback.`,
      );
    }

    const r = rule ?? FALLBACK_RULE;

    const icmsAliquota = Number(r.icmsAliquota);
    const icmsBaseReducao = Number(r.icmsBaseReducao);
    const ipiAliquota = Number(r.ipiAliquota);
    const pisAliquota = Number(r.pisAliquota);
    const cofinsAliquota = Number(r.cofinsAliquota);

    // IPI incide por fora (base = valor do item)
    const ipiBase = input.itemValue;
    const ipiValor = round2(ipiBase * ipiAliquota / 100);

    // ICMS: base = valor do item + IPI (para industrial), com redução se aplicável
    const icmsBaseFull = input.itemValue + ipiValor;
    const icmsBase = round2(icmsBaseFull * icmsBaseReducao / 100);
    const icmsValor = round2(icmsBase * icmsAliquota / 100);

    // PIS e COFINS: base = valor do item (cumulativo no Lucro Presumido)
    const pisBase = input.itemValue;
    const pisValor = round2(pisBase * pisAliquota / 100);

    const cofinsBase = input.itemValue;
    const cofinsValor = round2(cofinsBase * cofinsAliquota / 100);

    const totalTributos = round2(icmsValor + ipiValor + pisValor + cofinsValor);

    return {
      cfop: r.cfop,
      icms: { cst: r.icmsCst, baseCalculo: icmsBase, aliquota: icmsAliquota, valor: icmsValor },
      ipi: { cst: r.ipiCst, baseCalculo: ipiBase, aliquota: ipiAliquota, valor: ipiValor },
      pis: { cst: r.pisCst, baseCalculo: pisBase, aliquota: pisAliquota, valor: pisValor },
      cofins: { cst: r.cofinsCst, baseCalculo: cofinsBase, aliquota: cofinsAliquota, valor: cofinsValor },
      totalTributos,
    };
  }

  /**
   * Busca a regra mais específica (maior priority) para a operação.
   * Ordem de especificidade: NCM + productType + UF > NCM + UF > UF > geral
   */
  private async findBestRule(input: TaxInput) {
    const rules = await this.prisma.taxRule.findMany({
      where: {
        companyId: input.companyId,
        operationType: input.operationType,
        isActive: true,
        // Filtrar regras que se aplicam (campo null = aplica a qualquer)
        OR: [
          { ufOrigem: input.ufOrigem, ufDestino: input.ufDestino },
          { ufOrigem: input.ufOrigem, ufDestino: null },
          { ufOrigem: null, ufDestino: null },
        ],
      },
      orderBy: { priority: 'desc' },
    });

    if (rules.length === 0) return null;

    // Filtrar por NCM e productType (mais específica primeiro)
    const byNcmAndType = rules.find(
      (r) => r.ncm === input.ncm && r.productType === input.productType,
    );
    if (byNcmAndType) return byNcmAndType;

    const byNcm = rules.find((r) => r.ncm === input.ncm && r.productType === null);
    if (byNcm) return byNcm;

    const byType = rules.find((r) => r.ncm === null && r.productType === input.productType);
    if (byType) return byType;

    // Regra geral (sem NCM nem productType)
    const general = rules.find((r) => r.ncm === null && r.productType === null);
    return general ?? rules[0];
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
