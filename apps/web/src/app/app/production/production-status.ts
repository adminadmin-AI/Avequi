import type { ProductionOrderStatus } from '@/types/api';

type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export const PRODUCTION_STATUS: Record<ProductionOrderStatus, { label: string; variant: BadgeVariant }> = {
  DRAFT: { label: 'Planejada', variant: 'neutral' },
  RELEASED: { label: 'Liberada', variant: 'info' },
  IN_PROGRESS: { label: 'Em produção', variant: 'brand' },
  PENDING_INSPECTION: { label: 'Aguardando inspeção', variant: 'warning' },
  DONE: { label: 'Concluída', variant: 'success' },
  CANCELLED: { label: 'Cancelada', variant: 'neutral' },
};

export const PRODUCTION_STATUS_OPTIONS = Object.entries(PRODUCTION_STATUS).map(([value, meta]) => ({
  value: value as ProductionOrderStatus,
  label: meta.label,
}));

/** Etapas do pipeline para o stepper. */
export const PRODUCTION_PIPELINE: { status: ProductionOrderStatus; label: string }[] = [
  { status: 'DRAFT', label: 'Planejada' },
  { status: 'RELEASED', label: 'Liberada' },
  { status: 'IN_PROGRESS', label: 'Em produção' },
  { status: 'DONE', label: 'Concluída' },
];

export interface ProductionAction {
  endpoint: 'release' | 'start' | 'complete' | 'cancel';
  label: string;
  variant: 'primary' | 'danger';
}

/** Ações por status (espelha production.controller — transições são PATCH). */
export function availableProductionActions(status: ProductionOrderStatus): ProductionAction[] {
  switch (status) {
    case 'DRAFT':
      return [
        { endpoint: 'release', label: 'Liberar OP', variant: 'primary' },
        { endpoint: 'cancel', label: 'Cancelar', variant: 'danger' },
      ];
    case 'RELEASED':
      return [
        { endpoint: 'start', label: 'Iniciar produção', variant: 'primary' },
        { endpoint: 'cancel', label: 'Cancelar', variant: 'danger' },
      ];
    case 'IN_PROGRESS':
      return [
        { endpoint: 'complete', label: 'Concluir', variant: 'primary' },
        { endpoint: 'cancel', label: 'Cancelar', variant: 'danger' },
      ];
    case 'PENDING_INSPECTION':
      return [{ endpoint: 'cancel', label: 'Cancelar', variant: 'danger' }];
    default:
      return [];
  }
}
