'use client';

import { useState } from 'react';
import type { InvoiceMethod } from '@/types/api';
import { Field } from '@/components/ui/field';
import { FormDialog } from '@/components/ui/form-dialog';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { INVOICE_METHOD_LABEL } from './billing-format';

/**
 * Peças compartilhadas do billing da operadora — OPS WP5 (#912): usadas tanto
 * pela lista `/app/ops/billing` quanto pela aba "Financeiro" do drill-down do
 * tenant (mesma ação de baixa/anulação de fatura nos dois lugares).
 *
 * Rótulos/formatadores puros ficam em `billing-format.ts` (testado em
 * `.spec.ts` sem depender de jsdom) — reexportados aqui para não quebrar os
 * imports existentes.
 */
export { INVOICE_STATUS_LABEL, INVOICE_STATUS_VARIANT, INVOICE_METHOD_LABEL, formatPeriod } from './billing-format';

// ─── Dar baixa (POST .../pay) ────────────────────────────────────────────────
export function PayInvoiceDialog({
  open,
  onOpenChange,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  loading: boolean;
  onConfirm: (method: InvoiceMethod) => void;
}) {
  const [method, setMethod] = useState<InvoiceMethod>('PIX');

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Dar baixa na fatura"
      description="Registra o pagamento manualmente. Auditado, sem integração com gateway na Fase 1."
      formId="pay-invoice-form"
      submitLabel="Confirmar baixa"
      loading={loading}
    >
      <form
        id="pay-invoice-form"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(method);
        }}
      >
        <Field label="Forma de pagamento" required>
          <Select value={method} onChange={(e) => setMethod(e.target.value as InvoiceMethod)}>
            {(Object.keys(INVOICE_METHOD_LABEL) as InvoiceMethod[]).map((m) => (
              <option key={m} value={m}>
                {INVOICE_METHOD_LABEL[m]}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </FormDialog>
  );
}

// ─── Anular (POST .../void) ──────────────────────────────────────────────────
export function VoidInvoiceDialog({
  open,
  onOpenChange,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  loading: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const tooShort = reason.trim().length < 5;

  return (
    <FormDialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setReason('');
          setTouched(false);
        }
        onOpenChange(v);
      }}
      title="Anular fatura"
      description="Anular é para erro de emissão/negociação. A fatura some da cobrança. O motivo fica registrado na auditoria."
      formId="void-invoice-form"
      submitLabel="Anular fatura"
      loading={loading}
    >
      <form
        id="void-invoice-form"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (tooShort) return;
          onConfirm(reason.trim());
        }}
      >
        <Field
          label="Motivo"
          required
          error={touched && tooShort ? 'Informe pelo menos 5 caracteres.' : undefined}
        >
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Explique o motivo da anulação (obrigatório, mínimo 5 caracteres)"
            error={touched && tooShort}
          />
        </Field>
      </form>
    </FormDialog>
  );
}
