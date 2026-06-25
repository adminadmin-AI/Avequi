export type AlertType =
  | 'STOCK_MIN'
  | 'PAYABLE_DUE'
  | 'PRODUCTION_LATE'
  | 'NFE_REJECTED'
  | 'MRP_RUN_DONE'
  | 'FOCUS_NFE_DOWN'
  | 'QC_INSPECTION_FAILED'
  | 'MAINTENANCE_DUE'
  | 'MANIFEST_OVERDUE';

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  body: string;
  entityId: string | null;
  entityType: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  STOCK_MIN: 'Estoque mínimo',
  PAYABLE_DUE: 'Conta a pagar vencendo',
  PRODUCTION_LATE: 'OP atrasada',
  NFE_REJECTED: 'NF-e rejeitada',
  MRP_RUN_DONE: 'MRP concluído',
  FOCUS_NFE_DOWN: 'Focus NFe indisponível',
  QC_INSPECTION_FAILED: 'Inspeção reprovada',
  MAINTENANCE_DUE: 'Manutenção prevista',
  MANIFEST_OVERDUE: 'Manifestação pendente',
};

export const ALERT_SEVERITY: Record<AlertSeverity, { label: string; variant: BadgeVariant }> = {
  INFO: { label: 'Info', variant: 'info' },
  WARNING: { label: 'Aviso', variant: 'warning' },
  CRITICAL: { label: 'Crítico', variant: 'danger' },
};

/**
 * Mapeia o item relacionado ao alerta para a rota correspondente no app.
 * Retorna null quando não há tela específica.
 */
export function alertLink(a: Alert): string | null {
  if (!a.entityId && a.entityType !== 'NfeManifest') return null;
  switch (a.entityType) {
    case 'Product':
      return '/app/products';
    case 'FinancialEntry':
      return '/app/finance/payables';
    case 'ProductionOrder':
      return `/app/production/${a.entityId}`;
    case 'FiscalDocument':
      return `/app/fiscal/${a.entityId}`;
    case 'Equipment':
      return '/app/maintenance';
    case 'MrpRun':
      return '/app/production/mrp';
    case 'NfeManifest':
      return '/app/fiscal';
    default:
      return null;
  }
}
