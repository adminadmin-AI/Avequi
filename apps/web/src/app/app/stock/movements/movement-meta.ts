import type { MovementType } from '@/types/api';

type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export const MOVEMENT_TYPE: Record<MovementType, { label: string; variant: BadgeVariant; sign: number }> = {
  ENTRY: { label: 'Entrada', variant: 'success', sign: 1 },
  EXIT: { label: 'Saída', variant: 'danger', sign: -1 },
  ADJUSTMENT: { label: 'Ajuste', variant: 'warning', sign: 0 },
  REVERSAL: { label: 'Estorno', variant: 'neutral', sign: 0 },
  TRANSFER_OUT: { label: 'Transf. saída', variant: 'info', sign: -1 },
  TRANSFER_IN: { label: 'Transf. entrada', variant: 'info', sign: 1 },
};

export const MOVEMENT_TYPE_OPTIONS = Object.entries(MOVEMENT_TYPE).map(([value, meta]) => ({
  value: value as MovementType,
  label: meta.label,
}));
