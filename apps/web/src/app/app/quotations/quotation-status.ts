import type { QuotationStatus, Quotation } from '@/types/api';

type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export const QUOTATION_STATUS: Record<QuotationStatus, { label: string; variant: BadgeVariant }> = {
  DRAFT: { label: 'Rascunho', variant: 'neutral' },
  SENT: { label: 'Enviada', variant: 'info' },
  APPROVED: { label: 'Aprovada', variant: 'brand' },
  REJECTED: { label: 'Rejeitada', variant: 'danger' },
  EXPIRED: { label: 'Expirada', variant: 'warning' },
  CONVERTED: { label: 'Convertida em OV', variant: 'success' },
};

export const QUOTATION_STATUS_OPTIONS = Object.entries(QUOTATION_STATUS).map(([value, meta]) => ({
  value: value as QuotationStatus,
  label: meta.label,
}));

/** Total = Σ(quantidade × preço unitário − desconto do item). */
export function quotationTotal(q: Pick<Quotation, 'items'>): number {
  return (q.items ?? []).reduce((sum, it) => {
    const line = Number(it.quantity) * Number(it.unitPrice) - Number(it.discount ?? 0);
    return sum + Math.max(line, 0);
  }, 0);
}

export interface QuotationAction {
  endpoint: 'approve' | 'reject' | 'convert' | 'send';
  label: string;
  variant: 'primary' | 'secondary' | 'danger';
}

/** Ações disponíveis por status (espelha quotation.controller). */
export function availableQuotationActions(status: QuotationStatus): QuotationAction[] {
  switch (status) {
    case 'DRAFT':
      return [
        { endpoint: 'send', label: 'Enviar', variant: 'secondary' },
        { endpoint: 'approve', label: 'Aprovar', variant: 'primary' },
        { endpoint: 'reject', label: 'Rejeitar', variant: 'danger' },
      ];
    case 'SENT':
      return [
        { endpoint: 'approve', label: 'Aprovar', variant: 'primary' },
        { endpoint: 'reject', label: 'Rejeitar', variant: 'danger' },
      ];
    case 'APPROVED':
      return [{ endpoint: 'convert', label: 'Converter em OV', variant: 'primary' }];
    default:
      return [];
  }
}
