'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { FinancialEntry, BankAccount } from '@/types/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatBRL } from '@/lib/format';

const schema = z.object({
  financialEntryId: z.string().min(1, 'Selecione o pagável'),
  bankAccountId: z.string().min(1, 'Selecione a conta'),
  scheduledDate: z.string().min(1, 'Informe a data'),
});

export type ScheduleFormValues = z.infer<typeof schema>;

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

/**
 * Formulário de novo agendamento. Os seletores usam dados REAIS (pagáveis em
 * aberto e contas bancárias). O envio é tratado pela página, que hoje apenas
 * simula (backend #241 pendente).
 */
export function ScheduleForm({
  formId,
  payables,
  accounts,
  onSubmit,
}: {
  formId: string;
  payables: FinancialEntry[];
  accounts: BankAccount[];
  onSubmit: (values: ScheduleFormValues) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ScheduleFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { scheduledDate: new Date().toISOString().slice(0, 10) },
  });

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      <Field label="Pagável (em aberto)" required error={errors.financialEntryId?.message}>
        <Select {...register('financialEntryId')} error={!!errors.financialEntryId}>
          <option value="">— Selecione —</option>
          {payables.map((p) => {
            const supplier = p.purchaseOrder?.supplier?.name;
            const label = `${p.description ?? 'Lançamento'}${supplier ? ` — ${supplier}` : ''} (${formatBRL(Number(p.amount))})`;
            return (
              <option key={p.id} value={p.id}>
                {label}
              </option>
            );
          })}
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Conta a debitar" required error={errors.bankAccountId?.message}>
          <Select {...register('bankAccountId')} error={!!errors.bankAccountId}>
            <option value="">— Selecione —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Data do débito" required error={errors.scheduledDate?.message}>
          <Input type="date" {...register('scheduledDate')} error={!!errors.scheduledDate} />
        </Field>
      </div>
    </form>
  );
}
