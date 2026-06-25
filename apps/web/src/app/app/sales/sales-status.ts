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

/** Etapas principais do pipeline para o stepper visual (caminho feliz). */
export const SALES_PIPELINE: { status: SalesOrderStatus; label: string }[] = [
  { status: 'DRAFT', label: 'Rascunho' },
  { status: 'RESERVED', label: 'Reservada' },
  { status: 'AWAITING_PICKING', label: 'Separação' },
  { status: 'READY_TO_INVOICE', label: 'Pronta' },
  { status: 'INVOICED', label: 'Faturada' },
];

export interface SalesAction {
  /** sufixo do endpoint PATCH /sales/:id/<endpoint> */
  endpoint: 'approve-credit' | 'reserve' | 'confirm' | 'invoice' | 'return' | 'cancel';
  label: string;
  variant: 'primary' | 'secondary' | 'danger';
}

/**
 * Ações disponíveis por status, espelhando as transições válidas do
 * sales.controller. O backend é a fonte da verdade (erros tratados na UI).
 */
export function availableSalesActions(status: SalesOrderStatus): SalesAction[] {
  switch (status) {
    case 'CREDIT_HOLD':
      return [
        { endpoint: 'approve-credit', label: 'Aprovar crédito', variant: 'primary' },
        { endpoint: 'cancel', label: 'Cancelar', variant: 'danger' },
      ];
    case 'DRAFT':
      return [
        { endpoint: 'reserve', label: 'Reservar estoque', variant: 'primary' },
        { endpoint: 'cancel', label: 'Cancelar', variant: 'danger' },
      ];
    case 'RESERVED':
      return [
        { endpoint: 'confirm', label: 'Confirmar OV', variant: 'primary' },
        { endpoint: 'cancel', label: 'Cancelar', variant: 'danger' },
      ];
    case 'CONFIRMED':
    case 'AWAITING_PICKING':
      return [{ endpoint: 'cancel', label: 'Cancelar', variant: 'danger' }];
    case 'READY_TO_INVOICE':
      return [{ endpoint: 'invoice', label: 'Faturar (emitir NF-e)', variant: 'primary' }];
    case 'INVOICED':
      return [{ endpoint: 'return', label: 'Devolver', variant: 'secondary' }];
    default:
      return [];
  }
}
