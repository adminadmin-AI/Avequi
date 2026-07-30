/**
 * Carga específica da GDR Reboques — setores da fábrica → WorkCenter (#816).
 *
 * Este arquivo é o ADAPTADOR da implantação GDR: contém os dados crus da fonte,
 * a taxonomia da ferramenta de origem e as regras de transformação DESTA
 * implantação. Nada aqui é regra global do ERP — o núcleo genérico
 * (`src/common/production/work-center-import.ts`) só conhece o formato final
 * { code, name, description, isActive }.
 *
 * ORIGEM: tabela `Setores_Operacionais` do SQL Server local da ferramenta
 * interna `producao_v2` (projeto_sql_xml). Extração manual conferida em
 * 29/07/2026 — 34 registros, ordenados por `OrdemExibicao`. O ERP NÃO conecta
 * ao SQL Server: quando o cadastro mudar na ferramenta, atualize
 * `GDR_WORK_CENTER_SOURCE` manualmente e reexecute o CLI
 * `apps/api/scripts/import-work-centers-gdr.ts`.
 *
 * Regras DA GDR (não do produto):
 *   - isActive por tipo: Producao/Opcional → ativo; Estoque/Apoio → inativo.
 *   - description: "Grupo · Tipo".
 *
 * O que este arquivo NÃO contém, de propósito: companyId por registro,
 * credenciais/conexões, capacidade, custo/hora, operadores, eficiência.
 */

import type { DesiredWorkCenter } from '../../../../common/production/work-center-import';

/** CNPJ da GDR Reboques — empresa-alvo padrão do wrapper `import-work-centers-gdr`. */
export const GDR_COMPANY_CNPJ = '46247069000115';

/** Tipo do setor na ferramenta de origem da GDR. */
export type GdrSectorType = 'Producao' | 'Opcional' | 'Estoque' | 'Apoio';

export interface GdrSectorSource {
  /** Código do setor — chave natural do upsert junto com a empresa. */
  code: string;
  /** Nome do setor. */
  name: string;
  /** Grupo do setor na fábrica (vira parte da description). */
  group: string;
  /** Tipo na origem (vira parte da description e decide isActive). */
  type: GdrSectorType;
  /** Ordem de exibição na ferramenta de origem — documentação/validação. */
  displayOrder: number;
}

/** Regra DA GDR: mercados (estoque) e apoio não são centros de trabalho reais. */
const GDR_ACTIVE_BY_TYPE: Record<GdrSectorType, boolean> = {
  Producao: true,
  Opcional: true,
  Estoque: false,
  Apoio: false,
};

export function gdrResolveIsActive(type: GdrSectorType): boolean {
  const active = GDR_ACTIVE_BY_TYPE[type];
  if (active === undefined) {
    throw new Error(
      `Tipo de setor desconhecido na carga GDR: "${type}" — tipos aceitos: ${Object.keys(GDR_ACTIVE_BY_TYPE).join(', ')}`,
    );
  }
  return active;
}

/** Description padronizada da carga GDR: "Grupo · Tipo". */
export function gdrBuildDescription(sector: Pick<GdrSectorSource, 'group' | 'type'>): string {
  return `${sector.group} · ${sector.type}`;
}

/** Espelho fiel da tabela `Setores_Operacionais` (34 linhas em 29/07/2026). */
export const GDR_WORK_CENTER_SOURCE: readonly GdrSectorSource[] = [
  { code: 'SET-MET-001', name: 'Corte', group: 'Metalúrgica', type: 'Producao', displayOrder: 1 },
  { code: 'SET-MET-002', name: 'Dobra', group: 'Metalúrgica', type: 'Producao', displayOrder: 2 },

  { code: 'SET-SOL-001', name: 'Solda do Robô de Solda', group: 'Solda', type: 'Producao', displayOrder: 3 },
  { code: 'SET-SOL-002', name: 'Solda 1', group: 'Solda', type: 'Producao', displayOrder: 4 },
  { code: 'SET-SOL-003', name: 'Solda 2', group: 'Solda', type: 'Producao', displayOrder: 5 },
  { code: 'SET-SOL-004', name: 'Solda 3', group: 'Solda', type: 'Producao', displayOrder: 6 },
  { code: 'SET-SOL-005', name: 'Solda 4', group: 'Solda', type: 'Producao', displayOrder: 7 },
  { code: 'SET-SOL-006', name: 'Solda 5', group: 'Solda', type: 'Producao', displayOrder: 8 },

  { code: 'SET-GAL-001', name: 'Decapagem', group: 'Galvanização', type: 'Producao', displayOrder: 9 },
  { code: 'SET-GAL-002', name: 'Banho', group: 'Galvanização', type: 'Producao', displayOrder: 10 },
  { code: 'SET-GAL-003', name: 'Acabamento', group: 'Galvanização', type: 'Producao', displayOrder: 11 },

  { code: 'SET-EPX-001', name: 'Pintura EPOX a pó', group: 'Pintura EPOX', type: 'Opcional', displayOrder: 12 },

  { code: 'SET-MAR-001', name: 'Corte de Madeira', group: 'Marcenaria', type: 'Producao', displayOrder: 13 },
  { code: 'SET-MAR-002', name: 'Pintura/Verniz da Madeira', group: 'Marcenaria', type: 'Producao', displayOrder: 14 },

  { code: 'SET-MON-001', name: 'Montagem de Para-choque', group: 'Montagem', type: 'Producao', displayOrder: 15 },
  { code: 'SET-MON-002', name: 'Montagem de Chassi', group: 'Montagem', type: 'Producao', displayOrder: 16 },
  { code: 'SET-MON-003', name: 'Montagem de Lateral', group: 'Montagem', type: 'Producao', displayOrder: 17 },
  { code: 'SET-MON-004', name: 'Montagem de Tampa', group: 'Montagem', type: 'Producao', displayOrder: 18 },
  { code: 'SET-MON-005', name: 'Montagem de Eixo', group: 'Montagem', type: 'Producao', displayOrder: 19 },
  { code: 'SET-MON-006', name: 'Gravação de Número de Chassi', group: 'Montagem', type: 'Producao', displayOrder: 20 },

  { code: 'SET-EXP-001', name: 'Almoxarifado - Montagem de Kits', group: 'Expedição', type: 'Producao', displayOrder: 21 },
  { code: 'SET-EXP-002', name: 'Montagem de Kit Carretinha', group: 'Expedição', type: 'Producao', displayOrder: 22 },
  { code: 'SET-EXP-003', name: 'Carregamento', group: 'Expedição', type: 'Producao', displayOrder: 23 },

  { code: 'SET-MER-001', name: 'Mercado Corte Chapas', group: 'Mercados', type: 'Estoque', displayOrder: 24 },
  { code: 'SET-MER-002', name: 'Mercado Corte Tubos', group: 'Mercados', type: 'Estoque', displayOrder: 25 },
  { code: 'SET-MER-003', name: 'Mercado Dobra', group: 'Mercados', type: 'Estoque', displayOrder: 26 },
  { code: 'SET-MER-004', name: 'Mercado Solda', group: 'Mercados', type: 'Estoque', displayOrder: 27 },
  { code: 'SET-MER-005', name: 'Mercado Galvanização', group: 'Mercados', type: 'Estoque', displayOrder: 28 },
  { code: 'SET-MER-006', name: 'Mercado Montagem - Metalúrgica', group: 'Mercados', type: 'Estoque', displayOrder: 29 },
  { code: 'SET-MER-007', name: 'Mercado Montagem - Marcenaria', group: 'Mercados', type: 'Estoque', displayOrder: 30 },
  { code: 'SET-MER-008', name: 'Almoxarifado', group: 'Mercados', type: 'Estoque', displayOrder: 31 },

  { code: 'SET-ADM-001', name: 'Administrativo', group: 'Administrativo', type: 'Apoio', displayOrder: 32 },
  { code: 'SET-DIR-001', name: 'Diretoria', group: 'Diretoria', type: 'Apoio', displayOrder: 33 },
  { code: 'SET-REF-001', name: 'Refeitório', group: 'Refeitório', type: 'Apoio', displayOrder: 34 },
];

/**
 * Estado final desejado da carga GDR — o que o núcleo genérico consome.
 * Toda a taxonomia da GDR é resolvida AQUI; o núcleo nunca a vê.
 */
export const GDR_WORK_CENTERS: readonly DesiredWorkCenter[] = GDR_WORK_CENTER_SOURCE.map((sector) => ({
  code: sector.code,
  name: sector.name,
  description: gdrBuildDescription(sector),
  isActive: gdrResolveIsActive(sector.type),
}));
