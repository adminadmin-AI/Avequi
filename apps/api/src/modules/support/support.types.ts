/** Fila da triagem repo-aware (#768). Segunda camada do épico #764. */
export const TRIAGE_QUEUE = 'support-triage';

/** Job da fila — só o id; o processor recarrega o incidente REDIGIDO do banco. */
export interface TriageJobData {
  incidentId: string;
}

/** Severidade do diagnóstico — espelha o enum Prisma SupportIncidentSeverity. */
export type TriageSeverity = 'P0' | 'P1' | 'P2' | 'P3';

/**
 * Contrato do diagnóstico gravado pelo runner (write-back assinado). Fonte da
 * verdade do formato: o schema no `scripts/support-triage.mjs` e o
 * `UpdateDiagnosisDto`. INTERNO — nunca cliente-facing (ver listMine).
 */
export interface TriageDiagnosis {
  probableCause: string;
  files: Array<{ path: string; line: number; reason: string }>;
  module: string;
  severity: TriageSeverity;
  isDuplicateOf: string | null;
  confidence: number;
  suggestedFix: string | null;
  safeSelfServiceStep: string | null;
  needsHuman: boolean;
}
