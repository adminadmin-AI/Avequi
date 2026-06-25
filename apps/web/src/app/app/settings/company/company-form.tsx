'use client';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { CompanyType } from '@/types/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatCNPJ, unmask } from '@/lib/format';
import { isValidCNPJ } from '@/lib/validators';

const TYPES: [CompanyType, ...CompanyType[]] = ['MATRIZ', 'FILIAL'];

const schema = z.object({
  name: z.string().min(1, 'Informe o nome'),
  cnpj: z.string().refine((v) => isValidCNPJ(unmask(v)), { message: 'CNPJ inválido' }),
  type: z.enum(TYPES),
});

export type CompanyFormValues = z.infer<typeof schema>;

const TYPE_LABEL: Record<CompanyType, string> = { MATRIZ: 'Matriz', FILIAL: 'Filial' };

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

export function CompanyForm({
  formId,
  defaultValues,
  onSubmit,
}: {
  formId: string;
  defaultValues?: Partial<CompanyFormValues>;
  onSubmit: (values: CompanyFormValues) => void;
}) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<CompanyFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'MATRIZ', ...defaultValues },
  });

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      <Field label="Nome" required error={errors.name?.message}>
        <Input {...register('name')} error={!!errors.name} placeholder="Nome da empresa" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="CNPJ" required error={errors.cnpj?.message}>
          <Controller
            name="cnpj"
            control={control}
            render={({ field }) => (
              <Input
                value={field.value ?? ''}
                onChange={(e) => field.onChange(formatCNPJ(e.target.value))}
                error={!!errors.cnpj}
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
              />
            )}
          />
        </Field>
        <Field label="Tipo" required error={errors.type?.message}>
          <Select {...register('type')} error={!!errors.type}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </form>
  );
}
