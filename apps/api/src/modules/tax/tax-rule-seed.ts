import { Prisma, TaxOperationType } from '@prisma/client';

/**
 * Regras fiscais iniciais de um tenant novo (#1071, épico #1068).
 *
 * ⚠️ NASCEM INATIVAS DE PROPÓSITO.
 *
 * O motor filtra por `isActive: true` (tax-calculation.service.ts), então nada
 * aqui emite nota sozinho: o tenant continua recebendo o erro orientado do #498
 * até um contador revisar e ativar. Isso resolve o "tenant novo nasce sem nada
 * e descobre na primeira emissão" SEM reabrir a porta do FALLBACK_RULE, que
 * criava passivo tributário em silêncio — a SEFAZ valida estrutura, não
 * adequação, e autoriza nota fiscalmente errada sem reclamar.
 *
 * Só semeia CRT=1/2. Regime normal tem variância demais (ST, IPI por NCM,
 * cClassTrib da reforma) para ter um padrão seguro — lá o vazio é mais honesto.
 */

/** Ponto de partida conservador: sem crédito, sem ST, sem destaque de tributo federal. */
const CSOSN_PADRAO = '102'; // Tributada pelo Simples sem permissão de crédito

/**
 * `icmsCst` é NOT NULL no schema, mas não é lido quando há `icmsCsosn` — o
 * mapper dá precedência ao CSOSN. '90' (Outras) é só o preenchimento do campo.
 */
const CST_PLACEHOLDER = '90';

interface SeedRule {
  operationType: TaxOperationType;
  cfop: string;
  description: string;
}

const OPERACOES_SIMPLES: SeedRule[] = [
  { operationType: 'VENDA_INTERNA', cfop: '5101', description: 'Venda de produção própria — dentro do estado' },
  { operationType: 'VENDA_INTERESTADUAL', cfop: '6101', description: 'Venda de produção própria — interestadual' },
  { operationType: 'DEVOLUCAO_VENDA', cfop: '1202', description: 'Devolução de venda — entrada' },
  { operationType: 'TRANSFERENCIA_INTERNA', cfop: '5152', description: 'Transferência — dentro do estado' },
  { operationType: 'TRANSFERENCIA_INTERESTADUAL', cfop: '6152', description: 'Transferência — interestadual' },
  { operationType: 'BONIFICACAO', cfop: '5910', description: 'Bonificação / brinde' },
];

/**
 * Monta as regras iniciais para o regime do tenant.
 * Devolve [] para CRT=3 ou CRT ausente — nada a semear.
 */
export function buildInitialTaxRules(
  companyId: string,
  crt?: number | null,
): Prisma.TaxRuleCreateManyInput[] {
  if (crt !== 1 && crt !== 2) return [];

  return OPERACOES_SIMPLES.map((op) => ({
    companyId,
    operationType: op.operationType,
    cfop: op.cfop,
    icmsCst: CST_PLACEHOLDER,
    icmsCsosn: CSOSN_PADRAO,
    icmsAliquota: new Prisma.Decimal(0), // Simples recolhe no DAS, não destaca ICMS
    // Optante do Simples não destaca IPI/PIS/COFINS na nota
    ipiCst: '53', // Saída não-tributada
    ipiAliquota: new Prisma.Decimal(0),
    pisCst: '49', // Outras operações de saída
    pisAliquota: new Prisma.Decimal(0),
    cofinsCst: '49',
    cofinsAliquota: new Prisma.Decimal(0),
    description: `[REVISAR] ${op.description}`,
    isActive: false,
  }));
}
