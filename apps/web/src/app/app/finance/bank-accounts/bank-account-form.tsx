'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';

const schema = z.object({
  name: z.string().min(2, 'Informe o nome'),
  bank: z.string().optional(),
  agency: z.string().optional(),
  account: z.string().optional(),
});

export type BankAccountFormValues = z.infer<typeof schema>;

export function BankAccountForm({
  formId,
  defaultValues,
  onSubmit,
}: {
  formId: string;
  defaultValues?: Partial<BankAccountFormValues>;
  onSubmit: (values: BankAccountFormValues) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BankAccountFormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      <Field label="Nome" required error={errors.name?.message}>
        <Input {...register('name')} error={!!errors.name} placeholder="Ex.: Bradesco Corrente" />
      </Field>
      <div className="grid grid-cols-3 gap-4">
        <Field label="Banco" error={errors.bank?.message}>
          <Input {...register('bank')} placeholder="Bradesco" />
        </Field>
        <Field label="Agência" error={errors.agency?.message}>
          <Input {...register('agency')} placeholder="1234-5" className="font-mono" />
        </Field>
        <Field label="Conta" error={errors.account?.message}>
          <Input {...register('account')} placeholder="00001-2" className="font-mono" />
        </Field>
      </div>
    </form>
  );
}
