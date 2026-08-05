/**
 * Nome em português de cada tipo de operação fiscal (enum `operationType`).
 * Fonte única — antes duplicada em compliance/page.tsx (cobertura de regras)
 * e rules/tax-rule-form.tsx (cadastro de regra); qualquer tela nova que
 * precise do rótulo importa daqui.
 */
export const OPERATION_LABELS: Record<string, string> = {
  VENDA_INTERNA: 'Venda interna',
  VENDA_INTERESTADUAL: 'Venda interestadual',
  DEVOLUCAO_VENDA: 'Devolução de venda',
  TRANSFERENCIA_INTERNA: 'Transferência interna',
  TRANSFERENCIA_INTERESTADUAL: 'Transferência interestadual',
  COMPRA_INTERNA: 'Compra interna',
  COMPRA_INTERESTADUAL: 'Compra interestadual',
  DEVOLUCAO_COMPRA: 'Devolução de compra',
  REMESSA_CONSERTO: 'Remessa p/ conserto',
  RETORNO_CONSERTO: 'Retorno de conserto',
  AMOSTRA_GRATIS: 'Amostra grátis',
  BONIFICACAO: 'Bonificação',
  INDUSTRIALIZACAO: 'Industrialização',
};
