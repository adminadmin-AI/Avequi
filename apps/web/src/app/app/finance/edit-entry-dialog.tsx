'use client';

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type { FinancialCategory, CostCenter, FinancialEntry, Supplier } from '@/types/api';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';

const schema = z.object({
  description: z.string().min(1, 'Informe a descrição'),
  amount: z.coerce.number().min(0.01, 'Valor deve ser maior que zero'),
  dueDate: z.string().min(1, 'Informe o vencimento'),
  expectedPaymentDate: z.string().optional(),
  supplierId: z.string().optional(),
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

const toDateInput = (v?: string | null) => (v ? v.slice(0, 10) : '');

/**
 * Edição de um título financeiro EM ABERTO. Dialog controlado pela página
 * (aberto quando `entry` != null). Envia só os campos alterados via
 * PATCH /finance/entries/:id. Centro de custo em branco = mantém o rateio
 * atual (não temos os splits na listagem para pré-preencher).
 */
export function EditEntryDialog({
  entry,
  onOpenChange,
}: {
  entry: FinancialEntry | null;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();

  const { data: catRoots = [] } = useList<FinancialCategory>('/finance/categories');
  const { data: ccRoots = [] } = useList<CostCenter>('/finance/cost-centers');
  const { data: suppliers = [] } = useList<Supplier>('/suppliers');
  const categories = useMemo(() => flattenOptions(catRoots), [catRoots]);
  const costCenters = useMemo(() => flattenOptions(ccRoots), [ccRoots]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  // Pré-preenche o formulário sempre que o título alvo muda.
  useEffect(() => {
    if (!entry) return;
    reset({
      description: entry.description ?? '',
      amount: Number(entry.amount),
      dueDate: toDateInput(entry.dueDate),
      expectedPaymentDate: toDateInput(entry.expectedPaymentDate),
      supplierId: entry.supplierId ?? '',
      categoryId: entry.categoryId ?? '',
      costCenterId: '',
    });
  }, [entry, reset]);

  const update = useMutation({
    mutationFn: (data: FormValues) => {
      const payload: Record<string, unknown> = {
        description: data.description,
        amount: data.amount,
        dueDate: data.dueDate,
        expectedPaymentDate: data.expectedPaymentDate || undefined,
        supplierId: data.supplierId || null,
        categoryId: data.categoryId || null,
      };
      // Centro de custo: só envia quando escolhido — em branco preserva o rateio.
      if (data.costCenterId) payload.costCenterId = data.costCenterId;
      return apiClient.patch(`/finance/entries/${entry!.id}`, payload);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/finance'] }),
  });

  function onSubmit(values: FormValues) {
    update.mutate(values, {
      onSuccess: () => {
        toast.success('Lançamento atualizado');
        onOpenChange(false);
      },
      onError: () => toast.error('Erro ao atualizar lançamento'),
    });
  }

  return (
    <FormDialog
      open={!!entry}
      onOpenChange={onOpenChange}
      title="Editar lançamento"
      description={entry?.description ?? 'Alterar título em aberto'}
      formId="edit-entry-form"
      submitLabel="Salvar alterações"
      loading={update.isPending}
    >
      <form id="edit-entry-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
        <Field label="Descrição" required error={errors.description?.message}>
          <Input {...register('description')} error={!!errors.description} />
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
          <Field label="Previsão de pagamento" error={errors.expectedPaymentDate?.message}>
            <Input type="date" {...register('expectedPaymentDate')} />
          </Field>
          <Field label="Fornecedor" error={errors.supplierId?.message}>
            <Select {...register('supplierId')}>
              <option value="">— Nenhum —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
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
              <option value="">— Manter atual —</option>
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
  );
}
