import type {
  EquipmentStatus,
  MaintenanceOrderStatus,
  MaintenanceType,
} from '@/types/api';

type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

/**
 * Status reais da Ordem de Manutenção (espelha o enum `MaintenanceOrderStatus`
 * do backend: OPEN → IN_PROGRESS → DONE | CANCELLED).
 * Obs.: a issue #133 citava "PLANNED", que NÃO existe no schema — o estado
 * inicial é OPEN.
 */
export const MAINTENANCE_ORDER_STATUS: Record<
  MaintenanceOrderStatus,
  { label: string; variant: BadgeVariant }
> = {
  OPEN: { label: 'Aberta', variant: 'info' },
  IN_PROGRESS: { label: 'Em andamento', variant: 'brand' },
  DONE: { label: 'Concluída', variant: 'success' },
  CANCELLED: { label: 'Cancelada', variant: 'neutral' },
};

/** Tipos de manutenção (enum `MaintenanceType`). */
export const MAINTENANCE_TYPE: Record<
  MaintenanceType,
  { label: string; variant: BadgeVariant }
> = {
  PREVENTIVE: { label: 'Preventiva', variant: 'info' },
  CORRECTIVE: { label: 'Corretiva', variant: 'danger' },
  CALIBRATION: { label: 'Calibração', variant: 'warning' },
  INSPECTION: { label: 'Inspeção', variant: 'neutral' },
};

/** Status do equipamento (enum `EquipmentStatus`). */
export const EQUIPMENT_STATUS: Record<
  EquipmentStatus,
  { label: string; variant: BadgeVariant }
> = {
  ACTIVE: { label: 'Ativo', variant: 'success' },
  INACTIVE: { label: 'Inativo', variant: 'neutral' },
  UNDER_MAINTENANCE: { label: 'Em manutenção', variant: 'warning' },
  SCRAPPED: { label: 'Sucateado', variant: 'danger' },
};

/** Nº curto derivado do id (não há número sequencial no schema). */
export function shortId(id: string) {
  return id.slice(-6).toUpperCase();
}
