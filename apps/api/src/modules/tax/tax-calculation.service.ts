import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TaxOperationType, ProductType } from '@prisma/client';

export interface TaxInput {
  companyId: string;
  operationType: TaxOperationType;
  ncm?: string;
  productType?: ProductType;
  ufOrigem: string;
  ufDestino: string;
  itemValue: number; // valor total do item (qty × unitPrice)
  consumidorFinal?: boolean; // true quando destinatário é consumidor final (sem IE ou pessoa física)
  origem?: string; // origem da mercadoria 0-8 — 1/2/3/8 = importado → interestadual 4% (RSF 13/2012) (#480)
}

/** Origens de mercadoria importada — alíquota interestadual fixa de 4% (Resolução Senado Federal 13/2012) */
const IMPORTED_ORIGINS = ['1', '2', '3', '8'];

export interface DifAlResult {
  baseCalculo: number;
  aliquotaInterna: number;
  aliquotaInterestadual: number;
  valor: number; // 100% destino (EC 87/2015 — desde 2019)
  // FCP do UF destino (#445) — SP/RJ 2%; mesma base do DIFAL
  fcpAliquota: number;
  fcpValor: number;
}

export interface IbsCbsTax {
  cst: string;
  baseCalculo: number;
  aliquota: number;
  valor: number;
}

export interface TaxResult {
  cfop: string;
  icms: { cst: string; baseCalculo: number; aliquota: number; valor: number };
  ipi: { cst: string; baseCalculo: number; aliquota: number; valor: number };
  pis: { cst: string; baseCalculo: number; aliquota: number; valor: number };
  cofins: { cst: string; baseCalculo: number; aliquota: number; valor: number };
  difal?: DifAlResult;
  // Reforma Tributária NT 2025.002-RTC (#414) — presentes quando a TaxRule tem cbsAliquota
  cClassTrib?: string;
  cbs?: IbsCbsTax;
  ibsUf?: IbsCbsTax;
  ibsMun?: IbsCbsTax;
  totalTributos: number;
}

/**
 * Erro orientado ao usuário quando nenhuma TaxRule cobre a operação (#498).
 * Nunca emitir com tributação genérica: a SEFAZ autoriza nota fiscalmente
 * errada (valida estrutura, não adequação) — o antigo FALLBACK_RULE (CFOP
 * 5101/ICMS 18% sem IBS/CBS) criava passivo tributário em silêncio.
 */
export function missingTaxRuleMessage(input: TaxInput): string {
  return (
    `Nenhuma regra fiscal cadastrada para ${input.operationType} ` +
    `${input.ufOrigem}→${input.ufDestino}` +
    (input.ncm ? ` (NCM ${input.ncm})` : '') +
    `. Cadastre a regra em Regras Fiscais (POST /tax-rules) antes de emitir.`
  );
}

@Injectable()
export class TaxCalculationService {
  private readonly logger = new Logger(TaxCalculationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async calculateTaxes(input: TaxInput): Promise<TaxResult> {
    const r = await this.findBestRule(input);

    // Sem regra = bloqueio orientado, nunca tributação genérica (#498)
    if (!r) {
      this.logger.warn(`Emissão bloqueada: ${missingTaxRuleMessage(input)}`);
      throw new UnprocessableEntityException(missingTaxRuleMessage(input));
    }

    const isInterstate = input.ufOrigem !== input.ufDestino;

    // RSF 13/2012: mercadoria importada (orig 1/2/3/8) em operação interestadual
    // tem alíquota fixa de 4%, independente da regra cadastrada (#480)
    const isImported = IMPORTED_ORIGINS.includes(input.origem ?? '0');
    let icmsAliquota = Number(r.icmsAliquota);
    if (isInterstate && isImported && icmsAliquota > 4) {
      icmsAliquota = 4;
    }
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
    // CST 99 (outras operações): NF-e real #14236 autorizada emite vBC=0 (#371)
    const pisBase = r.pisCst === '99' ? 0 : input.itemValue;
    const pisValor = round2(pisBase * pisAliquota / 100);

    const cofinsBase = r.cofinsCst === '99' ? 0 : input.itemValue;
    const cofinsValor = round2(cofinsBase * cofinsAliquota / 100);

    // DIFAL — EC 87/2015: operação interestadual para consumidor final não-contribuinte
    // Desde 2019: 100% do diferencial vai para o UF destino
    let difal: DifAlResult | undefined;
    const icmsInternaDestino = r.icmsInternaDestino ? Number(r.icmsInternaDestino) : null;

    if (isInterstate && input.consumidorFinal && icmsInternaDestino && icmsInternaDestino > icmsAliquota) {
      const difalBase = icmsBaseFull; // base = valor + IPI (mesma base do ICMS)
      const difalValor = round2(difalBase * (icmsInternaDestino - icmsAliquota) / 100);
      // FCP do UF destino (#445): NF-e real #14236 (PR→SP) destaca 2%; vBCFCPUFDest = base do DIFAL
      const fcpAliquota = Number(r.fcpAliquotaDestino ?? 0);
      const fcpValor = fcpAliquota > 0 ? round2(difalBase * fcpAliquota / 100) : 0;
      difal = {
        baseCalculo: difalBase,
        aliquotaInterna: icmsInternaDestino,
        aliquotaInterestadual: icmsAliquota,
        valor: difalValor,
        fcpAliquota,
        fcpValor,
      };
    }

    // IBS/CBS — Reforma Tributária, fase teste 2026 (NT 2025.002-RTC) (#414)
    // Ativado por regra: só calcula quando a TaxRule tem cbsAliquota preenchida.
    // Base = valor da operação; alíquotas 2026: CBS 0,9%, IBS 0,1% UF + 0% Mun (LC 214/2025 art. 343).
    // IBS/CBS não compõem totalTributos em 2026 — fase informativa, sem recolhimento
    // (compensação com PIS/COFINS, LC 214/2025 art. 348).
    let cbs: IbsCbsTax | undefined;
    let ibsUf: IbsCbsTax | undefined;
    let ibsMun: IbsCbsTax | undefined;
    if (r.cbsAliquota != null) {
      const ibsCbsBase = input.itemValue;
      const cbsAliquota = Number(r.cbsAliquota);
      const ibsUfAliquota = Number(r.ibsUfAliquota ?? 0);
      const ibsMunAliquota = Number(r.ibsMunAliquota ?? 0);
      cbs = {
        cst: r.cbsCst ?? '000',
        baseCalculo: ibsCbsBase,
        aliquota: cbsAliquota,
        valor: round2(ibsCbsBase * cbsAliquota / 100),
      };
      ibsUf = {
        cst: r.ibsUfCst ?? r.cbsCst ?? '000',
        baseCalculo: ibsCbsBase,
        aliquota: ibsUfAliquota,
        valor: round2(ibsCbsBase * ibsUfAliquota / 100),
      };
      ibsMun = {
        cst: r.ibsMunCst ?? r.cbsCst ?? '000',
        baseCalculo: ibsCbsBase,
        aliquota: ibsMunAliquota,
        valor: round2(ibsCbsBase * ibsMunAliquota / 100),
      };
    }

    const totalTributos = round2(icmsValor + ipiValor + pisValor + cofinsValor + (difal?.valor ?? 0) + (difal?.fcpValor ?? 0));

    return {
      cfop: r.cfop,
      icms: { cst: r.icmsCst, baseCalculo: icmsBase, aliquota: icmsAliquota, valor: icmsValor },
      ipi: { cst: r.ipiCst, baseCalculo: ipiBase, aliquota: ipiAliquota, valor: ipiValor },
      pis: { cst: r.pisCst, baseCalculo: pisBase, aliquota: pisAliquota, valor: pisValor },
      cofins: { cst: r.cofinsCst, baseCalculo: cofinsBase, aliquota: cofinsAliquota, valor: cofinsValor },
      ...(difal && { difal }),
      ...(cbs && {
        cClassTrib: r.cClassTrib ?? '000001',
        cbs,
        ibsUf,
        ibsMun,
      }),
      totalTributos,
    };
  }

  /**
   * Busca a regra mais específica (maior priority) para a operação.
   * Ordem de especificidade: NCM + productType + UF > NCM + UF > UF > geral
   * Pública para pré-checagem de cobertura antes de efeitos colaterais (#498).
   */
  async findBestRule(input: Omit<TaxInput, 'itemValue'> & { itemValue?: number }) {
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
