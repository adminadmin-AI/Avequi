// ─── Fila VEHICLE_QUEUE (#532) — jobs da integração BIN/RENAVE/ATPV-e ─────────
// Todo job carrega apenas o id da RenaveOperation (ledger #527): o processor
// recarrega o estado do banco, o que torna retry/replay idempotente por design.

export const VEHICLE_QUEUE = 'vehicle-queue';

export const VEHICLE_JOB_BIN_REGISTER = 'bin-register';
export const VEHICLE_JOB_STOCK_IN = 'renave-entrada';
export const VEHICLE_JOB_SALE_OUT = 'renave-saida';
export const VEHICLE_JOB_ATPV_PDF = 'atpv-pdf';
export const VEHICLE_JOB_ATPV_EMAIL = 'atpv-email';
export const VEHICLE_JOB_CANCEL_SALE_OUT = 'renave-cancel';
export const VEHICLE_JOB_RETURN_MANUFACTURER = 'renave-devolver';

export interface VehicleJobPayload {
  operationId: string;
}

/** Opções default dos jobs: retry exponencial + dead-letter visível (padrão AUDIT_QUEUE) */
export const VEHICLE_JOB_OPTS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: true,
  removeOnFail: false, // job que esgota retries fica retido p/ inspeção + retry manual
};
