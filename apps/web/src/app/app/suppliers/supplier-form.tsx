'use client';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatCNPJ, unmask } from '@/lib/format';
import { isValidCNPJ } from '@/lib/validators';

const schema = z.object({
  name: z.string().min(1, 'Informe o nome'),
  cnpj: z
    .string()
    .optional()
    .refine((v) => !v || !unmask(v) || isValidCNPJ(unmask(v)), { message: 'CNPJ inválido' }),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
  phone: z.string().optional(),
  leadTimeDays: z.coerce.number().int().min(0).optional(),
});

export type SupplierFormValues = z.infer<typeof schema>;

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

export function SupplierForm({
  formId,
  defaultValues,
  onSubmit,
}: {
  formId: string;
  defaultValues?: Partial<SupplierFormValues>;
  onSubmit: (values: SupplierFormValues) => void;
}) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<SupplierFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { leadTimeDays: 0, ...defaultValues },
  });

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      <Field label="Razão social" required error={errors.name?.message}>
        <Input {...register('name')} error={!!errors.name} placeholder="Nome do fornecedor" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="CNPJ" error={errors.cnpj?.message}>
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
        <Field label="Lead time (dias)" error={errors.leadTimeDays?.message}>
          <Input type="number" min="0" {...register('leadTimeDays')} placeholder="0" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="E-mail" error={errors.email?.message}>
          <Input {...register('email')} type="email" error={!!errors.email} placeholder="fornecedor@email.com" />
        </Field>
        <Field label="Telefone" error={errors.phone?.message}>
          <Input {...register('phone')} placeholder="(00) 00000-0000" />
        </Field>
      </div>
    </form>
  );
}
