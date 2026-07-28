'use client';

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type { FinancialCategory, CostCenter, FinancialEntry, Supplier } from '@/types/api';
import { PAYMENT_METHOD_LABELS } from './payables/detail';
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
  // Fase 2 — pagamento/documento
  issueDate: z.string().optional(),
  documentNumber: z.string().max(60, 'Máx. 60 caracteres').optional(),
  paymentMethod: z.string().optional(),
  boletoBarcode: z
    .string()
    .optional()
    .refine((v) => !v || /^\d{44}$|^\d{47}$|^\d{48}$/.test(v.replace(/\D/g, '')), {
      message: 'Código de barras deve ter 44, 47 ou 48 dígitos',
    }),
  pixCopiaECola: z.string().max(512, 'Máx. 512 caracteres').optional(),
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

// Centro de custo — semântica de 3 vias (nunca reusar '' para dois sentidos):
const CC_KEEP = '__keep__'; // não envia costCenterId → mantém o rateio atual
const CC_NONE = '__none__'; // envia null → remove todo o rateio

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
      costCenterId: CC_KEEP, // começa em "manter rateio atual"
      issueDate: toDateInput(entry.issueDate),
      documentNumber: entry.documentNumber ?? '',
      paymentMethod: entry.paymentMethod ?? '',
      boletoBarcode: entry.boletoBarcode ?? '',
      pixCopiaECola: entry.pixCopiaECola ?? '',
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
        // Fase 2 — '' limpa o campo no backend; barcode vai só com dígitos
        issueDate: data.issueDate || null,
        documentNumber: data.documentNumber || null,
        paymentMethod: data.paymentMethod || null,
        boletoBarcode: data.boletoBarcode ? data.boletoBarcode.replace(/\D/g, '') : null,
        pixCopiaECola: data.pixCopiaECola?.trim() || null,
      };
      // Centro de custo (3 vias): manter → não envia; sem centro → null; id → id.
      if (data.costCenterId === CC_NONE) payload.costCenterId = null;
      else if (data.costCenterId && data.costCenterId !== CC_KEEP) {
        payload.costCenterId = data.costCenterId;
      }
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
              <option value={CC_KEEP}>Manter rateio atual</option>
              <option value={CC_NONE}>Sem centro de custo (remover rateio)</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Fase 2 — pagamento/documento */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Emissão" error={errors.issueDate?.message}>
            <Input type="date" {...register('issueDate')} />
          </Field>
          <Field label="Nº do documento" error={errors.documentNumber?.message}>
            <Input {...register('documentNumber')} placeholder="NF / fatura / duplicata" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Forma de pagamento" error={errors.paymentMethod?.message}>
            <Select {...register('paymentMethod')}>
              <option value="">— Não informada —</option>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Boleto (código de barras)" error={errors.boletoBarcode?.message}>
            <Input
              {...register('boletoBarcode')}
              placeholder="Cole a linha digitável"
              inputMode="numeric"
            />
          </Field>
        </div>

        <Field label="PIX Copia e Cola desta conta" error={errors.pixCopiaECola?.message}>
          <Input {...register('pixCopiaECola')} placeholder="Cole o código PIX da cobrança" />
        </Field>
      </form>
    </FormDialog>
  );
}
