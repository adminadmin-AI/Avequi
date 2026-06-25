'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { BankAccount } from '@/types/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

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

// ─── Boleto ─────────────────────────────────────────────────────────────────
const boletoSchema = z.object({
  bankAccountId: z.string().min(1, 'Selecione a conta'),
  nossoNumero: z.string().min(1, 'Informe o nosso número'),
  amount: z.coerce.number().min(0.01, 'Valor inválido'),
  dueDate: z.string().min(1, 'Informe o vencimento'),
  payerName: z.string().min(1, 'Informe o pagador'),
  payerDocument: z.string().min(1, 'Informe o CPF/CNPJ'),
});
export type BoletoFormValues = z.infer<typeof boletoSchema>;

export function BoletoForm({
  formId,
  accounts,
  onSubmit,
}: {
  formId: string;
  accounts: BankAccount[];
  onSubmit: (v: BoletoFormValues) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BoletoFormValues>({
    resolver: zodResolver(boletoSchema),
    defaultValues: { dueDate: new Date().toISOString().slice(0, 10) },
  });
  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      <Field label="Conta bancária" required error={errors.bankAccountId?.message}>
        <Select {...register('bankAccountId')} error={!!errors.bankAccountId}>
          <option value="">— Selecione —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Nosso número" required error={errors.nossoNumero?.message}>
          <Input {...register('nossoNumero')} error={!!errors.nossoNumero} className="font-mono" />
        </Field>
        <Field label="Vencimento" required error={errors.dueDate?.message}>
          <Input type="date" {...register('dueDate')} error={!!errors.dueDate} />
        </Field>
      </div>
      <Field label="Valor" required error={errors.amount?.message}>
        <Input type="number" step="0.01" min="0.01" {...register('amount')} error={!!errors.amount} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Pagador" required error={errors.payerName?.message}>
          <Input {...register('payerName')} error={!!errors.payerName} placeholder="Nome do cliente" />
        </Field>
        <Field label="CPF/CNPJ do pagador" required error={errors.payerDocument?.message}>
          <Input {...register('payerDocument')} error={!!errors.payerDocument} className="font-mono" />
        </Field>
      </div>
    </form>
  );
}

// ─── PIX ────────────────────────────────────────────────────────────────────
const pixSchema = z.object({
  bankAccountId: z.string().min(1, 'Selecione a conta'),
  pixKey: z.string().min(1, 'Informe a chave PIX'),
  amount: z.coerce.number().min(0.01, 'Valor inválido'),
  description: z.string().optional(),
});
export type PixFormValues = z.infer<typeof pixSchema>;

export function PixForm({
  formId,
  accounts,
  onSubmit,
}: {
  formId: string;
  accounts: BankAccount[];
  onSubmit: (v: PixFormValues) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PixFormValues>({ resolver: zodResolver(pixSchema) });
  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      <Field label="Conta bancária" required error={errors.bankAccountId?.message}>
        <Select {...register('bankAccountId')} error={!!errors.bankAccountId}>
          <option value="">— Selecione —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Chave PIX (recebedor)" required error={errors.pixKey?.message}>
        <Input {...register('pixKey')} error={!!errors.pixKey} placeholder="CNPJ, e-mail, telefone ou aleatória" />
      </Field>
      <Field label="Valor" required error={errors.amount?.message}>
        <Input type="number" step="0.01" min="0.01" {...register('amount')} error={!!errors.amount} />
      </Field>
      <Field label="Descrição" error={errors.description?.message}>
        <Input {...register('description')} placeholder="Opcional" />
      </Field>
    </form>
  );
}
