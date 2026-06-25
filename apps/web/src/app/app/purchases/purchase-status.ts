import type { PurchaseOrderStatus, PurchaseOrder } from '@/types/api';

type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export const PO_STATUS: Record<PurchaseOrderStatus, { label: string; variant: BadgeVariant }> = {
  DRAFT: { label: 'Rascunho', variant: 'neutral' },
  APPROVED: { label: 'Aprovada', variant: 'brand' },
  PARTIALLY_RECEIVED: { label: 'Recebida parcial', variant: 'warning' },
  RECEIVED: { label: 'Recebida', variant: 'success' },
  CANCELLED: { label: 'Cancelada', variant: 'neutral' },
};

export const PO_STATUS_OPTIONS = Object.entries(PO_STATUS).map(([value, meta]) => ({
  value: value as PurchaseOrderStatus,
  label: meta.label,
}));

/** Total da PO = Σ(quantidade × custo unitário) dos itens. */
export function purchaseOrderTotal(po: Pick<PurchaseOrder, 'items'>): number {
  return (po.items ?? []).reduce(
    (sum, it) => sum + Number(it.quantity) * Number(it.unitCost),
    0,
  );
}

export interface POAction {
  endpoint: 'approve' | 'cancel';
  label: string;
  variant: 'primary' | 'danger';
}

/** Ações disponíveis por status (espelha purchase.controller). */
export function availablePOActions(status: PurchaseOrderStatus): POAction[] {
  switch (status) {
    case 'DRAFT':
      return [
        { endpoint: 'approve', label: 'Aprovar', variant: 'primary' },
        { endpoint: 'cancel', label: 'Cancelar', variant: 'danger' },
      ];
    case 'APPROVED':
    case 'PARTIALLY_RECEIVED':
      return [{ endpoint: 'cancel', label: 'Cancelar', variant: 'danger' }];
    default:
      return [];
  }
}
