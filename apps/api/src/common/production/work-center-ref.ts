/**
 * #815 — Resolução de centro de trabalho a partir de uma etapa de roteiro.
 *
 * `RoutingStep.workCenterId` é a referência OFICIAL. O campo textual
 * `RoutingStep.workCenter` continua existindo porque a remoção de coluna é
 * proibida em migration neste projeto e porque três consumidores legados ainda
 * o leem (capacity, costing e as respostas de production).
 *
 * Enquanto existirem etapas com `workCenterId` nulo — roteiro criado antes do
 * backfill, ou cujo texto não casou com nenhum `WorkCenter.code` —, a leitura
 * cai para o texto. Esse fallback é explícito, centralizado aqui e coberto por
 * teste; não é comportamento implícito espalhado pelo código.
 *
 * Quando o campo textual for removido (issue posterior), basta apagar os
 * ramos de fallback deste arquivo.
 */

/** Forma mínima de uma etapa de roteiro para efeito de resolução. */
export interface EtapaComCentro {
  workCenterId?: string | null;
  workCenter?: string | null;
}

/** Forma mínima de um centro de trabalho. */
export interface CentroDeTrabalho {
  id: string;
  code: string;
}

/**
 * A etapa pertence a este centro de trabalho?
 *
 * Prioriza a FK. Só considera o texto quando a etapa ainda não tem FK — assim
 * uma etapa já migrada nunca casa por texto com um centro diferente.
 */
export function stepEhDoCentro(step: EtapaComCentro, wc: CentroDeTrabalho): boolean {
  if (step.workCenterId) return step.workCenterId === wc.id;
  return !!step.workCenter && step.workCenter === wc.code;
}

/**
 * Código do centro de trabalho de uma etapa, para agrupamento e exibição.
 *
 * Prioriza o `code` vindo da relação carregada; cai para o texto legado; e
 * devolve `null` quando não há centro definido — cabe a quem chama decidir o
 * rótulo (os consumidores atuais usam 'UNKNOWN').
 */
export function codigoDoCentro(
  step: EtapaComCentro & { workCenterRef?: { code: string } | null },
): string | null {
  return step.workCenterRef?.code ?? step.workCenter ?? null;
}
