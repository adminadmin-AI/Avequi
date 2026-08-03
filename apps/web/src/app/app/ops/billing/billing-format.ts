import type { InvoiceMethod, InvoiceStatus } from '@/types/api';
import type { BadgeVariant } from '@/components/ui/badge';

/**
 * Rótulos/formatadores puros do billing da operadora — OPS WP5 (#912).
 * Extraído de `billing-shared.tsx` (que também exporta os dialogs em JSX)
 * para poder ser testado sem depender de jsdom/testing-library — convenção
 * do repo: lógica pura em `.ts`, testada em `.spec.ts` (ver fiscal-status.ts).
 */

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  OPEN: 'Em aberto',
  OVERDUE: 'Vencida',
  PAID: 'Paga',
  VOID: 'Anulada',
};

export const INVOICE_STATUS_VARIANT: Record<InvoiceStatus, BadgeVariant> = {
  OPEN: 'warning',
  OVERDUE: 'danger',
  PAID: 'success',
  VOID: 'neutral',
};

export const INVOICE_METHOD_LABEL: Record<InvoiceMethod, string> = {
  PIX: 'PIX',
  BOLETO: 'Boleto',
  TRANSFER: 'Transferência',
  OUTRO: 'Outro',
};

/** Competência (1º dia do mês, ISO) → "MM/AAAA"; entrada inválida → "—". */
export function formatPeriod(period: string): string {
  const d = new Date(period);
  if (Number.isNaN(d.getTime())) return '—';
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${mm}/${d.getUTCFullYear()}`;
}
