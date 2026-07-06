'use client';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { MaskedInput } from '@/components/ui/masked-input';
import { Select } from '@/components/ui/select';
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
    // Fiscal (#474)
    razaoSocial: z.string().optional(),
    ie: z.string().optional(),
    indIeDest: z.enum(['CONTRIBUINTE', 'ISENTO', 'NAO_CONTRIBUINTE']).optional().or(z.literal('')),
    isRuralProducer: z.boolean().optional(),
    isSimplesNacional: z.boolean().optional(),
    fiscalEmail: z.string().email('E-mail inválido').optional().or(z.literal('')),
    contactName: z.string().optional(),
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
  })
  .superRefine((data, ctx) => {
    const ieNumerica = /^\d+$/.test((data.ie ?? '').replace(/[.\-\/ ]/g, '')) && (data.ie ?? '').length > 0;
    if (data.isRuralProducer && !ieNumerica) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ie'], message: 'Produtor rural exige IE de produtor' });
    }
    if (data.indIeDest === 'CONTRIBUINTE' && !ieNumerica) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ie'], message: 'Contribuinte exige IE válida' });
    }
  });

export type CustomerFormValues = z.infer<typeof schema>;

const typeOptions = enumOptions(CUSTOMER_TYPE_LABELS);

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

      {/* ─── Dados fiscais (#474) ─── */}
      <div className="border-t border-border pt-4 space-y-4">
        <p className="text-sm font-medium text-content-secondary">Dados fiscais (NF-e)</p>
        {!isPF && (
          <Field label="Razão social" error={errors.razaoSocial?.message}>
            <Input {...register('razaoSocial')} placeholder="Razão social completa (DANFE)" />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Contribuinte de ICMS" error={errors.indIeDest?.message}>
            <Select {...register('indIeDest')}>
              <option value="">Automático (inferir por IE/CPF)</option>
              <option value="CONTRIBUINTE">Contribuinte (exige IE)</option>
              <option value="ISENTO">Contribuinte isento de IE</option>
              <option value="NAO_CONTRIBUINTE">Não contribuinte / consumidor final</option>
            </Select>
          </Field>
          <Field label="Inscrição Estadual" error={errors.ie?.message}>
            <Input {...register('ie')} placeholder="Somente números" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register('isRuralProducer')} className="accent-brand-600" />
            Produtor rural (IE de produtor)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register('isSimplesNacional')} className="accent-brand-600" />
            Optante do Simples Nacional
          </label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="E-mail p/ NF-e e boleto" error={errors.fiscalEmail?.message}>
            <Input {...register('fiscalEmail')} type="email" placeholder="Vazio = usa o e-mail principal" />
          </Field>
          <Field label="Nome do contato" error={errors.contactName?.message}>
            <Input {...register('contactName')} placeholder="Quem responde por este cliente" />
          </Field>
        </div>
      </div>
    </form>
  );
}
