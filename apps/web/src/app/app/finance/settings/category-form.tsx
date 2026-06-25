'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { FinancialCategoryType } from '@/types/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

export const CATEGORY_TYPES: { value: FinancialCategoryType; label: string }[] = [
  { value: 'REVENUE', label: 'Receita' },
  { value: 'EXPENSE', label: 'Despesa' },
  { value: 'TRANSFER', label: 'Transferência' },
  { value: 'GROUP', label: 'Grupo' },
];
const TYPE_VALUES = CATEGORY_TYPES.map((t) => t.value) as [
  FinancialCategoryType,
  ...FinancialCategoryType[],
];

const schema = z.object({
  name: z.string().min(1, 'Informe o nome'),
  type: z.enum(TYPE_VALUES),
  code: z.string().optional(),
  dreCode: z.string().optional(),
});

export type CategoryFormValues = z.infer<typeof schema>;

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

export function CategoryForm({
  formId,
  defaultValues,
  onSubmit,
}: {
  formId: string;
  defaultValues?: Partial<CategoryFormValues>;
  onSubmit: (values: CategoryFormValues) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'EXPENSE', ...defaultValues },
  });

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      <Field label="Nome" required error={errors.name?.message}>
        <Input {...register('name')} error={!!errors.name} placeholder="Nome da categoria" />
      </Field>
      <Field label="Tipo" required error={errors.type?.message}>
        <Select {...register('type')} error={!!errors.type}>
          {CATEGORY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Código" error={errors.code?.message}>
          <Input {...register('code')} placeholder="Opcional" className="font-mono" />
        </Field>
        <Field label="Código DRE" error={errors.dreCode?.message}>
          <Input {...register('dreCode')} placeholder="Opcional" className="font-mono" />
        </Field>
      </div>
    </form>
  );
}
