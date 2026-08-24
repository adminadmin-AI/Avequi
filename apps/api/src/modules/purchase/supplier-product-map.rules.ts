/**
 * Regras PURAS do SupplierProductMap (Fase 2 — conciliação de compras).
 *
 * Este módulo é a fonte única das regras de transição/validação usadas pelo
 * serviço de conciliação (PR-2/PR-3). Mantê-lo puro permite provar as regras
 * sem banco — e as mesmas invariantes existem como CHECK constraints na
 * migration 20260824230000 (defesa em profundidade).
 *
 * Decisões de produto (Rafael, 24/08/2026):
 *  - identidade canônica = (companyId, supplierId, supplierProductCode/cProd);
 *    descrição/NCM/unidade são evidências auxiliares, nunca identidade;
 *  - kind PRODUCT exige Product canônico; CONSUMABLE/ASSET/FREIGHT_OTHER são
 *    conciliados SEM criar Product artificial;
 *  - seed do producao_v2 e descrição normalizada geram no máximo SUGGESTED —
 *    CONFIRMED é sempre decisão humana;
 *  - NCM sozinho nunca identifica um Product (só ajuda a classificar/reduzir
 *    candidatos);
 *  - classificação auditável e reversível (SupplierProductMapEvent).
 */

export type SpmStatus = 'UNRESOLVED' | 'SUGGESTED' | 'CONFIRMED' | 'REVIEW';
export type SpmKind = 'PRODUCT' | 'CONSUMABLE' | 'ASSET' | 'FREIGHT_OTHER';
export type SuggestionSource = 'SEED_PRODUCAO_V2' | 'DESCRIPTION' | 'RULE_NCM' | 'MANUAL';

export interface SpmState {
  status: SpmStatus;
  kind: SpmKind | null;
  productId: string | null;
  confirmedAt: Date | null;
}

/** Valida as invariantes de um estado (espelho dos CHECKs do banco). */
export function validateState(s: SpmState): string[] {
  const errors: string[] = [];
  if (s.productId !== null && s.kind !== 'PRODUCT') {
    errors.push('productId só é permitido quando kind = PRODUCT');
  }
  if (s.status === 'CONFIRMED') {
    if (s.kind === null) errors.push('CONFIRMED exige kind');
    if (s.kind === 'PRODUCT' && s.productId === null) {
      errors.push('CONFIRMED como PRODUCT exige productId');
    }
    if (s.confirmedAt === null) errors.push('CONFIRMED exige confirmedAt');
  }
  return errors;
}

/** Transições de status permitidas. Reversibilidade: CONFIRMED pode voltar
 *  para REVIEW (evidência divergente) ou ser reclassificado — nunca apagado. */
const TRANSITIONS: Record<SpmStatus, SpmStatus[]> = {
  UNRESOLVED: ['SUGGESTED', 'CONFIRMED'],
  SUGGESTED: ['CONFIRMED', 'UNRESOLVED', 'SUGGESTED'],
  CONFIRMED: ['REVIEW', 'CONFIRMED'], // re-confirmação = reclassificação auditada
  REVIEW: ['CONFIRMED', 'SUGGESTED'],
};

export function canTransition(from: SpmStatus, to: SpmStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Sugestão NUNCA confirma: qualquer origem automática só pode levar a
 * SUGGESTED. Apenas ação humana (actorId presente) pode produzir CONFIRMED.
 */
export function maxStatusForSource(source: SuggestionSource, hasHumanActor: boolean): SpmStatus {
  if (!hasHumanActor) return 'SUGGESTED';
  return source === 'MANUAL' ? 'CONFIRMED' : 'SUGGESTED';
}

/** NCM sozinho nunca identifica Product — só classifica/filtra candidatos. */
export function ncmCanIdentifyProduct(): false {
  return false;
}

/** Faixas de NCM que indicam ativo/máquina (classificação sugerida, não identidade). */
export function suggestKindFromNcm(ncm: string | null): SpmKind | null {
  if (!ncm) return null;
  const prefix = ncm.replace(/\D/g, '').slice(0, 2);
  if (['84', '85', '90'].includes(prefix)) return 'ASSET';
  return null;
}

/**
 * Prioridade de conciliação (decisão de produto §5): combinação de valor
 * comprado, recorrência e relevância para as BOMs ativas — não só % do valor.
 * Retorna um score ordenável (maior = mais prioritário).
 */
export interface PriorityInput {
  totalPurchasedValue: number;
  occurrenceCount: number;
  /** o Product sugerido (se houver) aparece em alguma BOM ativa? */
  suggestedInActiveBom: boolean;
  /** em quantas BOMs ativas / modelos o candidato aparece */
  activeBomCount: number;
}

export function priorityScore(p: PriorityInput): number {
  // valor domina (log10 comprime ordens de grandeza), recorrência e presença
  // em BOM desempatam — um item de BOM ativa fura a fila de um avulso caro.
  const valueTerm = Math.log10(Math.max(p.totalPurchasedValue, 1));
  const recurrenceTerm = Math.log10(Math.max(p.occurrenceCount, 1));
  const bomTerm = p.suggestedInActiveBom ? 2 + Math.min(p.activeBomCount, 10) / 10 : 0;
  return valueTerm * 2 + recurrenceTerm + bomTerm;
}

/**
 * Gatilho de REVIEW: descrição nova diverge demais da confirmada.
 * Normalização barata + limiar conservador — divergência marca REVIEW, nunca
 * desfaz o vínculo sozinha.
 */
export function normalizeDescription(d: string): string {
  return d
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function descriptionDiverges(confirmed: string | null, incoming: string | null): boolean {
  if (!confirmed || !incoming) return false;
  const a = new Set(normalizeDescription(confirmed).split(' '));
  const b = new Set(normalizeDescription(incoming).split(' '));
  if (a.size === 0 || b.size === 0) return false;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const jaccard = inter / (a.size + b.size - inter);
  return jaccard < 0.3; // quase nada em comum → REVIEW
}
