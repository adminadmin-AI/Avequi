'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { PRODUCT_TYPE_LABELS, UNIT_LABELS, enumOptions } from '@/lib/enums';

// número opcional: '' vira undefined (z.coerce transformaria '' em 0)
const optionalNumber = (min = 0) =>
  z.preprocess(
    (v) => (v === '' || v == null ? undefined : Number(v)),
    z.number().min(min).optional(),
  );

const schema = z.object({
  sku: z.string().min(1, 'Informe o SKU'),
  name: z.string().min(1, 'Informe o nome'),
  description: z.string().optional(),
  type: z.enum([
    'RAW_MATERIAL',
    'SEMI_FINISHED',
    'FINISHED_GOOD',
    'CONSUMABLE',
    'SERVICE',
    'COMPONENT',
  ]),
  unit: z.enum(['UN', 'KG', 'G', 'M', 'M2', 'M3', 'L', 'PC', 'CX', 'PR']),
  ncm: z
    .string()
    .optional()
    .refine((v) => !v || v.replace(/\D/g, '').length === 8, 'NCM deve ter 8 dígitos'),
  costPrice: z.coerce.number().min(0).optional(),
  salePrice: z.coerce.number().min(0).optional(),
  // Fiscal e logística (#480/#484)
  origem: z.enum(['0', '1', '2', '3', '4', '5', '6', '7', '8']).optional(),
  ean: z
    .string()
    .optional()
    .refine((v) => !v || /^(\d{8}|\d{12,14})$/.test(v.replace(/\D/g, '')), 'GTIN: 8, 12, 13 ou 14 dígitos'),
  cest: z
    .string()
    .optional()
    .refine((v) => !v || v.replace(/\D/g, '').length === 7, 'CEST deve ter 7 dígitos'),
  pesoLiquido: optionalNumber(),
  pesoBruto: optionalNumber(),
  unidadeTributavel: z.string().max(6).optional(),
  fatorConversaoTributavel: optionalNumber(0.000001),
});

/** Tabela A do ICMS — origem da mercadoria (orig) (#480) */
const ORIGEM_LABELS: Record<string, string> = {
  '0': '0 — Nacional',
  '1': '1 — Estrangeira, importação direta',
  '2': '2 — Estrangeira, adquirida no mercado interno',
  '3': '3 — Nacional, conteúdo de importação > 40%',
  '4': '4 — Nacional, processos produtivos básicos',
  '5': '5 — Nacional, conteúdo de importação ≤ 40%',
  '6': '6 — Estrangeira, importação direta sem similar nacional',
  '7': '7 — Estrangeira, mercado interno sem similar nacional',
  '8': '8 — Nacional, conteúdo de importação > 70%',
};

export type ProductFormValues = z.infer<typeof schema>;

interface ProductFormProps {
  formId: string;
  defaultValues?: Partial<ProductFormValues>;
  onSubmit: (values: ProductFormValues) => void;
  /** Notifica o pai quando o form tem alterações não salvas (FormDialog dirty). */
  onDirtyChange?: (dirty: boolean) => void;
}

const typeOptions = enumOptions(PRODUCT_TYPE_LABELS);
const unitOptions = enumOptions(UNIT_LABELS);

export function ProductForm({ formId, defaultValues, onSubmit, onDirtyChange }: ProductFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty, touchedFields },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(schema),
    // inline validation (F3.1 #316): valida ao sair do campo, sem esperar submit
    mode: 'onBlur',
    defaultValues: { unit: 'UN', type: 'FINISHED_GOOD', ...defaultValues },
  });

  // check verde quando o campo obrigatório foi tocado e está válido
  const okIcon = (field: 'sku' | 'name') =>
    touchedFields[field] && !errors[field] ? (
      <CheckCircle2 className="h-4 w-4 text-success" />
    ) : undefined;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      <div className="grid grid-cols-2 gap-4">
        <Field label="SKU" required error={errors.sku?.message}>
          <Input {...register('sku')} error={!!errors.sku} rightIcon={okIcon('sku')} placeholder="Ex.: REB-0092" />
        </Field>
        <Field label="NCM" error={errors.ncm?.message}>
          <Input {...register('ncm')} placeholder="Ex.: 8716.39.00" />
        </Field>
      </div>

      <Field label="Nome" required error={errors.name?.message}>
        <Input {...register('name')} error={!!errors.name} rightIcon={okIcon('name')} placeholder="Nome do produto" />
      </Field>

      <Field label="Descrição" error={errors.description?.message}>
        <Input {...register('description')} placeholder="Opcional" />
      </Field>

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
        <Field label="Unidade" required error={errors.unit?.message}>
          <Select {...register('unit')} error={!!errors.unit}>
            {unitOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Preço de custo (R$)" error={errors.costPrice?.message}>
          <Input
            type="number"
            step="0.01"
            min="0"
            {...register('costPrice')}
            placeholder="0,00"
          />
        </Field>
        <Field label="Preço de venda (R$)" error={errors.salePrice?.message}>
          <Input
            type="number"
            step="0.01"
            min="0"
            {...register('salePrice')}
            placeholder="0,00"
          />
        </Field>
      </div>

      {/* ─── Fiscal e logística (#480/#484) ─── */}
      <div className="border-t border-line pt-4 space-y-4">
        <p className="text-sm font-medium text-content-secondary">Fiscal e logística (NF-e)</p>
        <Field label="Origem da mercadoria" error={errors.origem?.message}>
          <Select {...register('origem')}>
            {Object.entries(ORIGEM_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="GTIN / EAN" error={errors.ean?.message}>
            <Input {...register('ean')} placeholder="Vazio = SEM GTIN" />
          </Field>
          <Field label="CEST" error={errors.cest?.message}>
            <Input {...register('cest')} placeholder="Somente com ST" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Peso líquido (kg)" error={errors.pesoLiquido?.message}>
            <Input type="number" step="0.001" min="0" {...register('pesoLiquido')} placeholder="0,000" />
          </Field>
          <Field label="Peso bruto (kg)" error={errors.pesoBruto?.message}>
            <Input type="number" step="0.001" min="0" {...register('pesoBruto')} placeholder="0,000" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Unidade tributável" error={errors.unidadeTributavel?.message}>
            <Input {...register('unidadeTributavel')} placeholder="Vazio = mesma comercial" maxLength={6} />
          </Field>
          <Field label="Fator de conversão" error={errors.fatorConversaoTributavel?.message}>
            <Input type="number" step="0.000001" min="0" {...register('fatorConversaoTributavel')} placeholder="qTrib = qtd × fator" />
          </Field>
        </div>
      </div>
    </form>
  );
}
