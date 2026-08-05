'use client';

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Search, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { MaskedInput } from '@/components/ui/masked-input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { erroDeAcao } from '@/lib/feedback';
import { unmask } from '@/lib/format';
import { isValidCNPJ } from '@/lib/validators';
import { lookupCep, lookupCnpj } from '@/lib/address-lookup';

const UF = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR',
  'PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
];

const schema = z.object({
  name: z.string().min(1, 'Informe o nome'),
  razaoSocial: z.string().optional(),
  cnpj: z
    .string()
    .optional()
    .refine((v) => !v || isValidCNPJ(unmask(v)), 'CNPJ inválido'),
  ie: z.string().optional(),
  taxRegime: z.enum(['SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL']).optional().or(z.literal('')),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
  fiscalEmail: z.string().email('E-mail inválido').optional().or(z.literal('')),
  phone: z.string().optional(),
  contactName: z.string().optional(),
  zipCode: z.string().optional(),
  address: z.string().optional(),
  number: z.string().optional(),
  complement: z.string().optional(),
  neighborhood: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  ibgeCode: z.string().optional(),
  defaultPaymentTerms: z.string().optional(),
  bankName: z.string().optional(),
  bankAgency: z.string().optional(),
  bankAccount: z.string().optional(),
  pixKey: z.string().optional(),
  leadTimeDays: z.coerce.number().int().min(0).optional(),
});

export type SupplierFormValues = z.infer<typeof schema>;

/** Cadastro fiscal completo do fornecedor (#478) — regime tributário = crédito IBS/CBS 2027 */
export function SupplierForm({
  formId,
  defaultValues,
  onSubmit,
}: {
  formId: string;
  defaultValues?: Partial<SupplierFormValues>;
  onSubmit: (values: SupplierFormValues) => void;
}) {
  const toast = useToast();
  const {
    register,
    control,
    setValue,
    getValues,
    handleSubmit,
    formState: { errors },
  } = useForm<SupplierFormValues>({ resolver: zodResolver(schema), defaultValues });

  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);

  // Auto-preenchimento pela Receita — mesmo fluxo do cadastro de cliente (#474)
  async function fillFromCnpj() {
    const doc = unmask(getValues('cnpj') ?? '');
    if (!isValidCNPJ(doc)) {
      toast.error('Informe um CNPJ válido para buscar');
      return;
    }
    setCnpjLoading(true);
    try {
      const data = await lookupCnpj(doc);
      if (!data) {
        toast.error('CNPJ não encontrado na Receita');
        return;
      }
      setValue('razaoSocial', data.razaoSocial);
      if (!getValues('name')) setValue('name', data.nomeFantasia || data.razaoSocial);
      if (data.email && !getValues('email')) setValue('email', data.email.toLowerCase());
      if (data.phone && !getValues('phone')) setValue('phone', unmask(data.phone));
      setValue('zipCode', data.zipCode);
      setValue('address', data.address);
      setValue('number', data.number);
      setValue('complement', data.complement);
      setValue('neighborhood', data.neighborhood);
      setValue('city', data.city);
      setValue('state', data.state);
      setValue('ibgeCode', data.ibgeCode);
      if (data.isSimplesNacional !== null && !getValues('taxRegime')) {
        setValue('taxRegime', data.isSimplesNacional ? 'SIMPLES_NACIONAL' : 'LUCRO_PRESUMIDO');
      }
      toast.success('Dados preenchidos pela Receita. Confira o regime tributário');
    } catch (e) {
      toast.error(erroDeAcao('consultar o CNPJ', e));
    } finally {
      setCnpjLoading(false);
    }
  }

  async function fillFromCep(cep: string) {
    if (unmask(cep).length !== 8) return;
    setCepLoading(true);
    try {
      const data = await lookupCep(cep);
      if (!data) return;
      if (data.address) setValue('address', data.address);
      if (data.neighborhood) setValue('neighborhood', data.neighborhood);
      setValue('city', data.city);
      setValue('state', data.state);
      setValue('ibgeCode', data.ibgeCode);
    } catch {
      // lookup é conveniência — cadastro manual segue possível
    } finally {
      setCepLoading(false);
    }
  }

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      <div className="grid grid-cols-2 gap-4">
        <Field label="CNPJ" error={errors.cnpj?.message}>
          <div className="flex gap-2">
            <Controller
              name="cnpj"
              control={control}
              render={({ field }) => (
                <MaskedInput
                  mask="cnpj"
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(e.target.value)}
                  error={!!errors.cnpj}
                  clearable
                  placeholder="00.000.000/0000-00"
                />
              )}
            />
            <button
              type="button"
              onClick={fillFromCnpj}
              disabled={cnpjLoading}
              title="Buscar dados na Receita (preenche razão social, endereço e regime)"
              className="flex shrink-0 items-center justify-center rounded-md border border-line px-2.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400 disabled:opacity-50"
            >
              {cnpjLoading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            </button>
          </div>
        </Field>
        <Field label="Nome fantasia" required error={errors.name?.message}>
          <Input {...register('name')} error={!!errors.name} placeholder="Nome do fornecedor" />
        </Field>
      </div>

      <Field label="Razão social" error={errors.razaoSocial?.message}>
        <Input {...register('razaoSocial')} placeholder="Razão social completa" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Regime tributário" error={errors.taxRegime?.message}>
          <Select {...register('taxRegime')}>
            <option value="">Não informado</option>
            <option value="SIMPLES_NACIONAL">Simples Nacional</option>
            <option value="LUCRO_PRESUMIDO">Lucro Presumido</option>
            <option value="LUCRO_REAL">Lucro Real</option>
          </Select>
        </Field>
        <Field label="Inscrição Estadual" error={errors.ie?.message}>
          <Input {...register('ie')} placeholder="Somente números" />
        </Field>
      </div>
      <p className="text-xs text-content-muted">
        A partir de 2027 o crédito de IBS/CBS nas compras depende do regime tributário do fornecedor.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <Field label="E-mail" error={errors.email?.message}>
          <Input {...register('email')} type="email" placeholder="contato@fornecedor.com" />
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

      <div className="grid grid-cols-2 gap-4">
        <Field label="Nome do contato" error={errors.contactName?.message}>
          <Input {...register('contactName')} placeholder="Quem atende na compra" />
        </Field>
        <Field label="E-mail p/ NF-e e boleto" error={errors.fiscalEmail?.message}>
          <Input {...register('fiscalEmail')} type="email" placeholder="Vazio = usa o principal" />
        </Field>
      </div>

      {/* ─── Endereço ─── */}
      <div className="grid grid-cols-[140px,1fr] gap-4">
        <Field label={cepLoading ? 'CEP (buscando…)' : 'CEP'} error={errors.zipCode?.message}>
          <Controller
            name="zipCode"
            control={control}
            render={({ field }) => (
              <MaskedInput
                mask="cep"
                value={field.value ?? ''}
                onChange={(e) => {
                  field.onChange(e.target.value);
                  fillFromCep(e.target.value);
                }}
                placeholder="00000-000"
              />
            )}
          />
        </Field>
        <Field label="Endereço" error={errors.address?.message}>
          <Input {...register('address')} placeholder="Rua, avenida..." />
        </Field>
      </div>

      <div className="grid grid-cols-[100px,1fr,1fr] gap-4">
        <Field label="Número" error={errors.number?.message}>
          <Input {...register('number')} placeholder="Nº" />
        </Field>
        <Field label="Complemento" error={errors.complement?.message}>
          <Input {...register('complement')} placeholder="Sala, bloco..." />
        </Field>
        <Field label="Bairro" error={errors.neighborhood?.message}>
          <Input {...register('neighborhood')} placeholder="Bairro" />
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

      {/* ─── Comercial e pagamento ─── */}
      <div className="border-t border-line pt-4 space-y-4">
        <p className="text-sm font-medium text-content-secondary">Comercial e pagamento</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Condição de pagamento padrão" error={errors.defaultPaymentTerms?.message}>
            <Input {...register('defaultPaymentTerms')} placeholder='Ex.: "28 dias" ou "30/60/90"' />
          </Field>
          <Field label="Prazo de entrega (dias)" error={errors.leadTimeDays?.message}>
            <Input type="number" min="0" step="1" {...register('leadTimeDays')} placeholder="0" />
          </Field>
        </div>
        <div className="grid grid-cols-[1fr,100px,1fr] gap-4">
          <Field label="Banco" error={errors.bankName?.message}>
            <Input {...register('bankName')} placeholder="Banco" />
          </Field>
          <Field label="Agência" error={errors.bankAgency?.message}>
            <Input {...register('bankAgency')} placeholder="0000" />
          </Field>
          <Field label="Conta" error={errors.bankAccount?.message}>
            <Input {...register('bankAccount')} placeholder="00000-0" />
          </Field>
        </div>
        <Field label="Chave PIX" error={errors.pixKey?.message}>
          <Input {...register('pixKey')} placeholder="CNPJ, e-mail, telefone ou chave aleatória" />
        </Field>
      </div>
    </form>
  );
}
