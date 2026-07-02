'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { PRODUCT_TYPE_LABELS, UNIT_LABELS, enumOptions } from '@/lib/enums';

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
  ncm: z.string().optional(),
  costPrice: z.coerce.number().min(0).optional(),
  salePrice: z.coerce.number().min(0).optional(),
});

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

export function ProductForm({ formId, defaultValues, onSubmit, onDirtyChange }: ProductFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { unit: 'UN', type: 'FINISHED_GOOD', ...defaultValues },
  });

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      <div className="grid grid-cols-2 gap-4">
        <Field label="SKU" required error={errors.sku?.message}>
          <Input {...register('sku')} error={!!errors.sku} placeholder="Ex.: REB-0092" />
        </Field>
        <Field label="NCM" error={errors.ncm?.message}>
          <Input {...register('ncm')} placeholder="Ex.: 8716.39.00" />
        </Field>
      </div>

      <Field label="Nome" required error={errors.name?.message}>
        <Input {...register('name')} error={!!errors.name} placeholder="Nome do produto" />
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
    </form>
  );
}
