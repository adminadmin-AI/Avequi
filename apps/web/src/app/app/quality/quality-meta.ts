type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

// ─── Inspeções ──────────────────────────────────────────────────────────────
export type InspectionStatus = 'PENDING' | 'IN_PROGRESS' | 'PASSED' | 'FAILED' | 'ON_HOLD';
export type InspectionType = 'RECEIVING' | 'IN_PROCESS' | 'FINAL';

export const INSPECTION_STATUS: Record<InspectionStatus, { label: string; variant: BadgeVariant }> = {
  PENDING: { label: 'Pendente', variant: 'neutral' },
  IN_PROGRESS: { label: 'Em andamento', variant: 'info' },
  PASSED: { label: 'Aprovada', variant: 'success' },
  FAILED: { label: 'Reprovada', variant: 'danger' },
  ON_HOLD: { label: 'Em espera', variant: 'warning' },
};

export const INSPECTION_TYPE: Record<InspectionType, string> = {
  RECEIVING: 'Recebimento',
  IN_PROCESS: 'Em processo',
  FINAL: 'Final',
};

// ─── NCR ────────────────────────────────────────────────────────────────────
export type NcrStatus = 'OPEN' | 'UNDER_ANALYSIS' | 'CORRECTIVE_ACTION' | 'CLOSED' | 'CANCELLED';
export type NcrSeverity = 'MINOR' | 'MAJOR' | 'CRITICAL';

export const NCR_STATUS: Record<NcrStatus, { label: string; variant: BadgeVariant }> = {
  OPEN: { label: 'Aberta', variant: 'info' },
  UNDER_ANALYSIS: { label: 'Em análise', variant: 'warning' },
  CORRECTIVE_ACTION: { label: 'Ação corretiva', variant: 'brand' },
  CLOSED: { label: 'Fechada', variant: 'success' },
  CANCELLED: { label: 'Cancelada', variant: 'neutral' },
};

export const NCR_SEVERITY: Record<NcrSeverity, { label: string; variant: BadgeVariant }> = {
  MINOR: { label: 'Menor', variant: 'neutral' },
  MAJOR: { label: 'Maior', variant: 'warning' },
  CRITICAL: { label: 'Crítica', variant: 'danger' },
};
