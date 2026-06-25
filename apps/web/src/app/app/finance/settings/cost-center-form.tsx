'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const schema = z.object({
  name: z.string().min(1, 'Informe o nome'),
  code: z.string().optional(),
});

export type CostCenterFormValues = z.infer<typeof schema>;

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

export function CostCenterForm({
  formId,
  defaultValues,
  onSubmit,
}: {
  formId: string;
  defaultValues?: Partial<CostCenterFormValues>;
  onSubmit: (values: CostCenterFormValues) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CostCenterFormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      <div className="grid grid-cols-[1fr_2fr] gap-4">
        <Field label="Código" error={errors.code?.message}>
          <Input {...register('code')} placeholder="CC-01" className="font-mono uppercase" />
        </Field>
        <Field label="Nome" required error={errors.name?.message}>
          <Input {...register('name')} error={!!errors.name} placeholder="Nome do centro de custo" />
        </Field>
      </div>
    </form>
  );
}
