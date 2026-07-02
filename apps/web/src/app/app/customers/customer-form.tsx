'use client';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { MaskedInput } from '@/components/ui/masked-input';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { CUSTOMER_TYPE_LABELS, enumOptions } from '@/lib/enums';
import { unmask } from '@/lib/format';
import { isValidCPF, isValidCNPJ } from '@/lib/validators';

const UF = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR',
  'PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
];

const schema = z
  .object({
    type: z.enum(['INDIVIDUAL', 'COMPANY']),
    name: z.string().min(1, 'Informe o nome'),
    document: z.string().optional(),
    email: z.string().email('E-mail inválido').optional().or(z.literal('')),
    phone: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const doc = unmask(data.document ?? '');
    if (!doc) return; // documento é opcional
    const valid = data.type === 'INDIVIDUAL' ? isValidCPF(doc) : isValidCNPJ(doc);
    if (!valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['document'],
        message: data.type === 'INDIVIDUAL' ? 'CPF inválido' : 'CNPJ inválido',
      });
    }
  });

export type CustomerFormValues = z.infer<typeof schema>;

const typeOptions = enumOptions(CUSTOMER_TYPE_LABELS);

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

export function CustomerForm({
  formId,
  defaultValues,
  onSubmit,
}: {
  formId: string;
  defaultValues?: Partial<CustomerFormValues>;
  onSubmit: (values: CustomerFormValues) => void;
}) {
  const {
    register,
    control,
    watch,
    handleSubmit,
    formState: { errors },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'COMPANY', ...defaultValues },
  });

  const type = watch('type');
  const isPF = type === 'INDIVIDUAL';

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Tipo" required error={errors.type?.message}>
          <Select {...register('type')} error={!!errors.type}>
            {typeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={isPF ? 'CPF' : 'CNPJ'} error={errors.document?.message}>
          <Controller
            name="document"
            control={control}
            render={({ field }) => (
              <MaskedInput
                mask={isPF ? 'cpf' : 'cnpj'}
                value={field.value ?? ''}
                onChange={(e) => field.onChange(e.target.value)}
                error={!!errors.document}
                clearable
                placeholder={isPF ? '000.000.000-00' : '00.000.000/0000-00'}
              />
            )}
          />
        </Field>
      </div>

      <Field label={isPF ? 'Nome completo' : 'Razão social'} required error={errors.name?.message}>
        <Input {...register('name')} error={!!errors.name} placeholder="Nome do cliente" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="E-mail" error={errors.email?.message}>
          <Input {...register('email')} type="email" error={!!errors.email} placeholder="cliente@email.com" />
        </Field>
        <Field label="Telefone" error={errors.phone?.message}>
          <Controller
            name="phone"
            control={control}
            render={({ field }) => (
              <MaskedInput
                mask="phone"
                value={field.value ?? ''}
                onChange={(e) => field.onChange(e.target.value)}
                placeholder="(00) 00000-0000"
              />
            )}
          />
        </Field>
      </div>

      <Field label="Endereço" error={errors.address?.message}>
        <Input {...register('address')} placeholder="Rua, número, bairro" />
      </Field>

      <div className="grid grid-cols-[1fr,120px] gap-4">
        <Field label="Cidade" error={errors.city?.message}>
          <Input {...register('city')} placeholder="Cidade" />
        </Field>
        <Field label="UF" error={errors.state?.message}>
          <Select {...register('state')}>
            <option value="">—</option>
            {UF.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </form>
  );
}
