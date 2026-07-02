'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { PaymentMethod } from '@/types/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatBRL } from '@/lib/format';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'PIX', label: 'PIX' },
  { value: 'BOLETO', label: 'Boleto' },
  { value: 'TED', label: 'TED' },
  { value: 'DINHEIRO', label: 'Dinheiro' },
  { value: 'CARTAO', label: 'Cartão' },
  { value: 'CHEQUE', label: 'Cheque' },
];
const METHOD_VALUES = METHODS.map((m) => m.value) as [PaymentMethod, ...PaymentMethod[]];

export interface PayFormValues {
  paidAt: string;
  paidAmount: number;
  method: PaymentMethod;
  paymentNote?: string;
}

function makeSchema(remaining: number) {
  return z.object({
    paidAt: z.string().min(1, 'Informe a data'),
    paidAmount: z.coerce
      .number()
      .min(0.01, 'Valor deve ser maior que zero')
      .max(remaining + 0.01, `Não pode exceder o saldo (${formatBRL(remaining)})`),
    method: z.enum(METHOD_VALUES),
    paymentNote: z.string().optional(),
  });
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label required={required}>{label}</Label>
      {children}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function PayablePayForm({
  formId,
  remaining,
  onSubmit,
}: {
  formId: string;
  remaining: number;
  onSubmit: (values: PayFormValues) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PayFormValues>({
    resolver: zodResolver(makeSchema(remaining)),
    defaultValues: { paidAt: today, paidAmount: remaining, method: 'PIX' },
  });

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      <div className="rounded-lg bg-surface-secondary px-3 py-2 text-sm text-content-secondary">
        Saldo em aberto: <span className="font-semibold text-content">{formatBRL(remaining)}</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Data do pagamento" required error={errors.paidAt?.message}>
          <Input type="date" {...register('paidAt')} error={!!errors.paidAt} />
        </Field>
        <Field label="Valor pago" required error={errors.paidAmount?.message}>
          <Input
            type="number"
            step="0.01"
            min="0.01"
            {...register('paidAmount')}
            error={!!errors.paidAmount}
          />
        </Field>
      </div>

      <Field label="Forma de pagamento" required error={errors.method?.message}>
        <Select {...register('method')} error={!!errors.method}>
          {METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Observação" error={errors.paymentNote?.message}>
        <Input {...register('paymentNote')} placeholder="Opcional" />
      </Field>
    </form>
  );
}
