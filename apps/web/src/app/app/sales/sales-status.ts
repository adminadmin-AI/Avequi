import type { SalesOrderStatus, SalesOrder } from '@/types/api';

type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

interface StatusMeta {
  label: string;
  variant: BadgeVariant;
}

/** Pipeline de status da OV (espelha SalesOrderStatus do schema). */
export const SALES_STATUS: Record<SalesOrderStatus, StatusMeta> = {
  DRAFT: { label: 'Rascunho', variant: 'neutral' },
  CREDIT_HOLD: { label: 'Bloqueio de crédito', variant: 'danger' },
  RESERVED: { label: 'Reservada', variant: 'info' },
  CONFIRMED: { label: 'Confirmada', variant: 'brand' },
  AWAITING_PICKING: { label: 'Aguardando separação', variant: 'warning' },
  READY_TO_INVOICE: { label: 'Pronta p/ faturar', variant: 'warning' },
  INVOICED: { label: 'Faturada', variant: 'success' },
  RETURNED: { label: 'Devolvida', variant: 'neutral' },
  CANCELLED: { label: 'Cancelada', variant: 'neutral' },
};

export const SALES_STATUS_OPTIONS = Object.entries(SALES_STATUS).map(([value, meta]) => ({
  value: value as SalesOrderStatus,
  label: meta.label,
}));

/** Total da OV = soma de quantidade × preço unitário dos itens. */
export function salesOrderTotal(order: Pick<SalesOrder, 'items'>): number {
  return (order.items ?? []).reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
    0,
  );
}
