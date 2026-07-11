/**
 * Categorias estruturadas de motivo de perda (#570) — espelho do enum
 * LostReasonCategory do backend. Categoria é OBRIGATÓRIA ao marcar Perdido;
 * o texto livre é complemento opcional. `null` = lead antigo, exibir
 * "Não categorizado".
 */
export type LostReasonCategory =
  | 'PRECO'
  | 'CONCORRENTE'
  | 'SEM_RESPOSTA'
  | 'DESISTIU'
  | 'PRAZO_ENTREGA'
  | 'FORA_DO_PERFIL'
  | 'OUTRO';

export const LOST_REASON_LABELS: Record<LostReasonCategory, string> = {
  PRECO: 'Preço',
  CONCORRENTE: 'Fechou com concorrente',
  SEM_RESPOSTA: 'Parou de responder',
  DESISTIU: 'Desistiu da compra',
  PRAZO_ENTREGA: 'Prazo de entrega',
  FORA_DO_PERFIL: 'Fora do perfil (spam/engano)',
  OUTRO: 'Outro',
};

export const LOST_REASON_OPTIONS = (
  Object.keys(LOST_REASON_LABELS) as LostReasonCategory[]
).map((value) => ({ value, label: LOST_REASON_LABELS[value] }));

export function lostReasonLabel(category: string | null | undefined): string {
  if (!category) return 'Não categorizado';
  return LOST_REASON_LABELS[category as LostReasonCategory] ?? category;
}
