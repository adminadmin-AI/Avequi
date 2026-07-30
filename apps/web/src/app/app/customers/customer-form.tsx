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
import { CUSTOMER_TYPE_LABELS, enumOptions } from '@/lib/enums';
import { unmask } from '@/lib/format';
import { isValidCPF, isValidCNPJ } from '@/lib/validators';
import { lookupCep, lookupCnpj } from '@/lib/address-lookup';
import { useList } from '@/hooks/use-resource';

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
    zipCode: z.string().optional(),
    address: z.string().optional(),
    number: z.string().optional(),
    complement: z.string().optional(),
    neighborhood: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    ibgeCode: z.string().optional(),
    // Fiscal (#474)
    razaoSocial: z.string().optional(),
    ie: z.string().optional(),
    indIeDest: z.enum(['CONTRIBUINTE', 'ISENTO', 'NAO_CONTRIBUINTE']).optional().or(z.literal('')),
    isRuralProducer: z.boolean().optional(),
    isSimplesNacional: z.boolean().optional(),
    fiscalEmail: z.string().email('E-mail inválido').optional().or(z.literal('')),
    contactName: z.string().optional(),
    birthDate: z.string().optional(), // PF — pós-venda/CRM (#476)
    // Crédito e cobrança (#475)
    creditLimit: z.string().optional(),
    billingBlocked: z.boolean().optional(),
    billingBlockReason: z.string().optional(),
    defaultSellerId: z.string().optional(),
    defaultPaymentTerms: z.string().optional(),
    defaultCarrierId: z.string().optional(),
    internalNotes: z.string().optional(),
    creditScore: z.string().optional(),
    creditNotes: z.string().optional(),
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
  const toast = useToast();
  const {
    register,
    control,
    watch,
    setValue,
    getValues,
    handleSubmit,
    formState: { errors },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'COMPANY', ...defaultValues },
  });

  const type = watch('type');
  const isPF = type === 'INDIVIDUAL';
  const billingBlocked = watch('billingBlocked');

  // #475: padrões comerciais — vendedor e transportadora
  const { data: sellers } = useList<{ id: string; name: string }>('/users');
  const { data: carriers } = useList<{ id: string; name: string }>('/carriers');

  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);

  // "Pesquisar SEFAZ" do Omie — preenche o cadastro a partir do CNPJ (#474)
  async function fillFromCnpj() {
    const doc = unmask(getValues('document') ?? '');
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
      if (data.isSimplesNacional !== null) setValue('isSimplesNacional', data.isSimplesNacional);
      toast.success('Dados preenchidos pela Receita — confira antes de salvar');
    } catch {
      toast.error('Falha ao consultar CNPJ — tente novamente');
    } finally {
      setCnpjLoading(false);
    }
  }

  // Auto-preenchimento por CEP (ViaCEP) quando os 8 dígitos são digitados
  async function fillFromCep(cep: string) {
    if (unmask(cep).length !== 8) return;
    setCepLoading(true);
    try {
      const data = await lookupCep(cep);
      if (!data) return; // CEP não encontrado — usuário preenche manualmente
      if (data.address) setValue('address', data.address);
      if (data.neighborhood) setValue('neighborhood', data.neighborhood);
      setValue('city', data.city);
      setValue('state', data.state);
      setValue('ibgeCode', data.ibgeCode);
    } catch {
      // silencioso: lookup é conveniência, não bloqueia o cadastro manual
    } finally {
      setCepLoading(false);
    }
  }

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
          <div className="flex gap-2">
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
            {!isPF && (
              <button
                type="button"
                onClick={fillFromCnpj}
                disabled={cnpjLoading}
                title="Buscar dados na Receita (preenche razão social e endereço)"
                className="flex shrink-0 items-center justify-center rounded-md border border-line px-2.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400 disabled:opacity-50"
              >
                {cnpjLoading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
              </button>
            )}
          </div>
        </Field>
      </div>

      <Field label={isPF ? 'Nome completo' : 'Nome fantasia'} required error={errors.name?.message}>
        <Input {...register('name')} error={!!errors.name} placeholder="Nome do cliente" />
      </Field>

      {isPF && (
        <Field label="Data de nascimento" error={(errors as any).birthDate?.message}>
          <Input {...register('birthDate')} type="date" />
        </Field>
      )}

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

      {/* ─── Endereço fiscal ─── */}
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

      {/* ─── Dados fiscais (#474) ─── */}
      <div className="mt-2 space-y-4">
        <p className="text-[13px] font-semibold text-content">Dados fiscais (NF-e)</p>
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

      {/* ─── Crédito e cobrança (#475) ─── */}
      <div className="mt-2 space-y-4">
        <p className="text-[13px] font-semibold text-content">Crédito e cobrança</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Limite de crédito (R$)" error={errors.creditLimit?.message}>
            <Input
              {...register('creditLimit')}
              type="number"
              step="0.01"
              min="0"
              placeholder="Vazio = sem limite"
            />
          </Field>
          <Field label="Condição de pagamento padrão" error={errors.defaultPaymentTerms?.message}>
            <Input {...register('defaultPaymentTerms')} placeholder="Ex.: 30/60/90, à vista" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Vendedor padrão">
            <Select {...register('defaultSellerId')}>
              <option value="">—</option>
              {(sellers ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Transportadora padrão">
            <Select {...register('defaultCarrierId')}>
              <option value="">—</option>
              {(carriers ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Score de crédito (análise interna)">
            <Select {...register('creditScore')}>
              <option value="">—</option>
              {['A', 'B', 'C', 'D', 'E'].map((sc) => (
                <option key={sc} value={sc}>
                  {sc}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Observações do analista de crédito">
            <Input {...register('creditNotes')} placeholder="Ex.: garantias, histórico" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register('billingBlocked')} className="accent-red-600" />
          <span className="font-medium text-red-600 dark:text-red-400">Bloquear faturamento</span>
          <span className="text-content-muted">— impede a confirmação de vendas (DIRECTOR pode sobrepor)</span>
        </label>
        {billingBlocked && (
          <Field label="Motivo do bloqueio" error={errors.billingBlockReason?.message}>
            <Input {...register('billingBlockReason')} placeholder="Ex.: inadimplência, análise de crédito" />
          </Field>
        )}
        <Field label="Observações internas" error={errors.internalNotes?.message}>
          <Input {...register('internalNotes')} placeholder="Nunca vão para documentos fiscais" />
        </Field>
      </div>
    </form>
  );
}
