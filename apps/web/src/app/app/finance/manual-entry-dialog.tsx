'use client';

import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type { FinancialCategory, CostCenter, FinancialEntryType } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';

const schema = z.object({
  type: z.enum(['RECEIVABLE', 'PAYABLE']),
  description: z.string().min(1, 'Informe a descrição'),
  amount: z.coerce.number().min(0.01, 'Valor deve ser maior que zero'),
  dueDate: z.string().min(1, 'Informe o vencimento'),
  categoryId: z.string().optional(),
  costCenterId: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

/** Achata a árvore (raiz + filhos) em opções de select. */
function flattenOptions<T extends { id: string; name: string; children?: T[] }>(
  roots: T[],
): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const walk = (nodes: T[], depth: number) => {
    for (const n of nodes) {
      out.push({ id: n.id, label: `${'— '.repeat(depth)}${n.name}` });
      if (n.children?.length) walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

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

/**
 * Botão "Novo lançamento" + FormDialog para criar um lançamento financeiro
 * manual (despesa avulsa / receita não operacional). Reutilizado nas telas
 * de Recebíveis e Pagáveis. `defaultType` define o tipo inicial pelo contexto.
 */
export function ManualEntryDialog({ defaultType }: { defaultType: FinancialEntryType }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: catRoots = [] } = useList<FinancialCategory>('/finance/categories');
  const { data: ccRoots = [] } = useList<CostCenter>('/finance/cost-centers');
  const categories = useMemo(() => flattenOptions(catRoots), [catRoots]);
  const costCenters = useMemo(() => flattenOptions(ccRoots), [ccRoots]);

  const create = useMutation({
    mutationFn: (data: FormValues) => apiClient.post('/finance/entries/manual', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/finance'] }),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { type: defaultType, dueDate: new Date().toISOString().slice(0, 10) },
  });

  function onSubmit(values: FormValues) {
    const payload = {
      ...values,
      categoryId: values.categoryId || undefined,
      costCenterId: values.costCenterId || undefined,
    };
    create.mutate(payload, {
      onSuccess: () => {
        toast.success('Lançamento criado');
        setOpen(false);
        reset({ type: defaultType, dueDate: new Date().toISOString().slice(0, 10) });
      },
      onError: () => toast.error('Erro ao criar lançamento'),
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus size={16} />
        Novo lançamento
      </Button>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Novo lançamento manual"
        description="Despesa avulsa ou receita não operacional."
        formId="manual-entry-form"
        loading={create.isPending}
      >
        <form
          id="manual-entry-form"
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4 py-1"
        >
          <Field label="Tipo" required error={errors.type?.message}>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="radio" value="RECEIVABLE" {...register('type')} /> Recebível
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="radio" value="PAYABLE" {...register('type')} /> Pagável
              </label>
            </div>
          </Field>

          <Field label="Descrição" required error={errors.description?.message}>
            <Input {...register('description')} error={!!errors.description} placeholder="Ex.: Aluguel galpão" />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Valor" required error={errors.amount?.message}>
              <Input type="number" step="0.01" min="0.01" {...register('amount')} error={!!errors.amount} />
            </Field>
            <Field label="Vencimento" required error={errors.dueDate?.message}>
              <Input type="date" {...register('dueDate')} error={!!errors.dueDate} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Categoria" error={errors.categoryId?.message}>
              <Select {...register('categoryId')}>
                <option value="">— Nenhuma —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Centro de custo" error={errors.costCenterId?.message}>
              <Select {...register('costCenterId')}>
                <option value="">— Nenhum —</option>
                {costCenters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </form>
      </FormDialog>
    </>
  );
}
