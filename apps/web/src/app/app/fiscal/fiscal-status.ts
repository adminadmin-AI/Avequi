import type { FiscalStatus, FiscalDocumentType } from '@/types/api';

type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export const FISCAL_STATUS: Record<FiscalStatus, { label: string; variant: BadgeVariant }> = {
  PENDING: { label: 'Pendente', variant: 'neutral' },
  PROCESSING: { label: 'Processando', variant: 'info' },
  AUTHORIZED: { label: 'Autorizada', variant: 'success' },
  REJECTED: { label: 'Rejeitada', variant: 'danger' },
  CANCELLED: { label: 'Cancelada', variant: 'neutral' },
  ERROR: { label: 'Erro', variant: 'danger' },
};

export const FISCAL_STATUS_OPTIONS = Object.entries(FISCAL_STATUS).map(([value, meta]) => ({
  value: value as FiscalStatus,
  label: meta.label,
}));

export const FISCAL_TYPE_LABEL: Record<FiscalDocumentType, string> = {
  NFE: 'NF-e',
  NFCE: 'NFC-e',
};
