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

/**
 * Valida as invariantes de um estado (espelho dos CHECKs do banco).
 * productId e kind representam EXCLUSIVAMENTE a verdade canônica (confirmada,
 * ou confirmada e depois posta em REVIEW). Sugestão vive só nos campos
 * suggested* — antes da confirmação, os canônicos ficam vazios.
 */
export function validateState(s: SpmState): string[] {
  const errors: string[] = [];
  const preCanonical = s.status === 'UNRESOLVED' || s.status === 'SUGGESTED';
  if (preCanonical) {
    if (s.kind !== null) errors.push(`${s.status} não pode ter kind canônico (sugestão vai em suggestedKind)`);
    if (s.productId !== null) errors.push(`${s.status} não pode ter productId canônico (sugestão vai em suggestedProductId)`);
    if (s.confirmedAt !== null) errors.push(`${s.status} não pode ter confirmedAt`);
  } else {
    // CONFIRMED e REVIEW carregam a verdade canônica (REVIEW NÃO perde o
    // vínculo anterior — só sinaliza que precisa de reavaliação humana).
    if (s.kind === null) errors.push(`${s.status} exige kind`);
    if (s.confirmedAt === null) errors.push(`${s.status} exige confirmedAt`);
    if (s.kind === 'PRODUCT' && s.productId === null) {
      errors.push(`${s.status} como PRODUCT exige productId`);
    }
    if (s.kind !== null && s.kind !== 'PRODUCT' && s.productId !== null) {
      errors.push('productId só é permitido quando kind = PRODUCT');
    }
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

// NCM: decisão de produto (24/08) — NCM sozinho NUNCA identifica um Product
// nem define kind (84/85/90 contêm componentes legítimos de BOM). Ele pode
// entrar numa heurística FUTURA combinada (descrição+histórico+seed+natureza
// contábil), deliberadamente NÃO codificada no PR-1.

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

/**
 * PROVISÓRIO (fundação): a política concreta de pesos será calibrada no PR-2
 * com o dataset real da listagem. Direção aprovada: valor domina; presença em
 * BOM ativa recebe peso FORTE PORÉM FINITO (nunca ultrapassa qualquer item de
 * fora da BOM independentemente do valor); recorrência desempata.
 */
export function provisionalPriorityScore(p: PriorityInput): number {
  const valueTerm = Math.log10(Math.max(p.totalPurchasedValue, 1)) * 2;
  const recurrenceTerm = Math.log10(Math.max(p.occurrenceCount, 1)) * 0.5;
  // boost limitado: equivale a no máx. ~1 ordem de grandeza de valor
  const bomTerm = p.suggestedInActiveBom ? 1.5 + Math.min(p.activeBomCount, 10) / 20 : 0;
  return valueTerm + recurrenceTerm + bomTerm;
}

/**
 * Isolamento entre empresas — padrão multi-tenant do Avequi (guard de
 * serviço com { id, companyId }; não há FK composta por tenant no schema).
 * O serviço (PR-2/3) DEVE carregar supplier/product/suggestedProduct com o
 * companyId do map e passar por aqui antes de gravar.
 */
export interface TenantRefs {
  mapCompanyId: string;
  supplierCompanyId: string | null; // null = supplier não encontrado no tenant
  productCompanyId: string | null | undefined; // undefined = sem product
  suggestedProductCompanyId: string | null | undefined;
}

export function validateTenantConsistency(refs: TenantRefs): string[] {
  const errors: string[] = [];
  if (refs.supplierCompanyId !== refs.mapCompanyId) {
    errors.push('supplier não pertence à company do map');
  }
  if (refs.productCompanyId !== undefined && refs.productCompanyId !== refs.mapCompanyId) {
    errors.push('product não pertence à company do map');
  }
  if (
    refs.suggestedProductCompanyId !== undefined &&
    refs.suggestedProductCompanyId !== refs.mapCompanyId
  ) {
    errors.push('suggestedProduct não pertence à company do map');
  }
  return errors;
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
