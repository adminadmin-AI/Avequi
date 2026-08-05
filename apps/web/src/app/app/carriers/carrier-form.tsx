'use client';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { MaskedInput } from '@/components/ui/masked-input';
import { Select } from '@/components/ui/select';
import { unmask } from '@/lib/format';
import { isValidCPF, isValidCNPJ } from '@/lib/validators';

const UF = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR',
  'PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
];

const schema = z
  .object({
    name: z.string().min(1, 'Informe o nome'),
    razaoSocial: z.string().optional(),
    document: z.string().optional(),
    ie: z.string().optional(),
    address: z.string().max(60).optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    vehiclePlate: z.string().max(8).optional(),
    vehiclePlateState: z.string().optional(),
    rntc: z.string().max(20).optional(),
  })
  .superRefine((data, ctx) => {
    const doc = unmask(data.document ?? '');
    if (!doc) return;
    if (!isValidCPF(doc) && !isValidCNPJ(doc)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['document'], message: 'CPF/CNPJ inválido' });
    }
  });

export type CarrierFormValues = z.infer<typeof schema>;

/** Transportadora — grupo transp da NF-e (#481) */
export function CarrierForm({
  formId,
  defaultValues,
  onSubmit,
}: {
  formId: string;
  defaultValues?: Partial<CarrierFormValues>;
  onSubmit: (values: CarrierFormValues) => void;
}) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<CarrierFormValues>({ resolver: zodResolver(schema), defaultValues });

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Nome fantasia" required error={errors.name?.message}>
          <Input {...register('name')} error={!!errors.name} placeholder="Nome da transportadora" />
        </Field>
        <Field label="CPF/CNPJ" error={errors.document?.message}>
          <Controller
            name="document"
            control={control}
            render={({ field }) => (
              <MaskedInput
                mask="cpf-cnpj"
                value={field.value ?? ''}
                onChange={(e) => field.onChange(e.target.value)}
                error={!!errors.document}
                placeholder="00.000.000/0000-00"
              />
            )}
          />
        </Field>
      </div>

      <Field label="Razão social" error={errors.razaoSocial?.message}>
        <Input {...register('razaoSocial')} placeholder="Razão social (sai na NF-e)" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Inscrição Estadual" error={errors.ie?.message}>
          <Input {...register('ie')} placeholder="Somente números" />
        </Field>
        <Field label="Endereço" error={errors.address?.message}>
          <Input {...register('address')} placeholder="Logradouro e número" maxLength={60} />
        </Field>
      </div>

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

      <div className="grid grid-cols-[1fr,120px,1fr] gap-4">
        <Field label="Placa do veículo" error={errors.vehiclePlate?.message}>
          <Input {...register('vehiclePlate')} placeholder="ABC1D23" maxLength={8} />
        </Field>
        <Field label="UF da placa" error={errors.vehiclePlateState?.message}>
          <Select {...register('vehiclePlateState')}>
            <option value="">—</option>
            {UF.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="RNTC (ANTT)" error={errors.rntc?.message}>
          <Input {...register('rntc')} placeholder="Opcional" maxLength={20} />
        </Field>
      </div>
    </form>
  );
}
