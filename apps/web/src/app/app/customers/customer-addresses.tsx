'use client';

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus, Pencil, Trash2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useDetail } from '@/hooks/use-resource';
import type { Customer, CustomerAddress } from '@/types/api';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { MaskedInput } from '@/components/ui/masked-input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { unmask } from '@/lib/format';
import { lookupCep } from '@/lib/address-lookup';

const UF = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR',
  'PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
];

const addressSchema = z.object({
  label: z.string().min(1, 'Informe um rótulo (ex.: Obra Fazenda Santa Fé)'),
  zipCode: z.string().optional(),
  address: z.string().min(1, 'Informe o endereço'),
  number: z.string().optional(),
  complement: z.string().optional(),
  neighborhood: z.string().optional(),
  city: z.string().min(1, 'Informe a cidade'),
  state: z.string().min(2, 'Informe a UF'),
  ibgeCode: z.string().optional(),
  isDefault: z.boolean().optional(),
});

type AddressFormValues = z.infer<typeof addressSchema>;

function formatAddressLine(a: CustomerAddress): string {
  const parts = [
    [a.address, a.number].filter(Boolean).join(', '),
    a.neighborhood,
    `${a.city}/${a.state}`,
  ].filter(Boolean);
  return parts.join(' — ');
}

/**
 * Gestão de endereços de entrega do cliente (#474) — grupo <entrega> da NF-e.
 * CRUD imediato via /customers/:id/addresses (fora do submit do form principal).
 */
export function CustomerAddresses({ customerId }: { customerId: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const { data: customer, isLoading } = useDetail<Customer>('/customers', customerId);
  const addresses = customer?.addresses ?? [];

  const [editing, setEditing] = useState<CustomerAddress | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);

  const {
    register,
    control,
    setValue,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AddressFormValues>({ resolver: zodResolver(addressSchema) });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['/customers'] });

  const save = useMutation({
    mutationFn: async (values: AddressFormValues) => {
      const payload = { ...values, zipCode: values.zipCode ? unmask(values.zipCode) : undefined };
      if (editing) {
        await apiClient.patch(`/customers/${customerId}/addresses/${editing.id}`, payload);
      } else {
        await apiClient.post(`/customers/${customerId}/addresses`, payload);
      }
    },
    onSuccess: () => {
      invalidate();
      toast.success(editing ? 'Endereço atualizado' : 'Endereço adicionado');
      closeForm();
    },
    onError: () => toast.error('Erro ao salvar endereço'),
  });

  const remove = useMutation({
    mutationFn: (addressId: string) =>
      apiClient.delete(`/customers/${customerId}/addresses/${addressId}`),
    onSuccess: () => {
      invalidate();
      toast.success('Endereço removido');
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.message ?? 'Erro ao remover endereço'),
  });

  function openCreate() {
    setEditing(null);
    reset({ label: '', address: '', city: '', state: '', isDefault: addresses.length === 0 });
    setFormOpen(true);
  }

  function openEdit(a: CustomerAddress) {
    setEditing(a);
    reset({
      label: a.label,
      zipCode: a.zipCode ?? '',
      address: a.address,
      number: a.number ?? '',
      complement: a.complement ?? '',
      neighborhood: a.neighborhood ?? '',
      city: a.city,
      state: a.state,
      ibgeCode: a.ibgeCode ?? '',
      isDefault: a.isDefault,
    });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
  }

  async function handleRemove(a: CustomerAddress) {
    const ok = await confirm({
      title: 'Remover endereço de entrega?',
      description: `"${a.label}" será removido. Endereços usados em vendas não podem ser excluídos.`,
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (ok) remove.mutate(a.id);
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
      // lookup é conveniência — preenchimento manual continua possível
    } finally {
      setCepLoading(false);
    }
  }

  return (
    <div className="border-t border-border pt-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-content-secondary">
          Endereços de entrega (grupo entrega da NF-e)
        </p>
        {!formOpen && (
          <Button type="button" variant="secondary" size="sm" onClick={openCreate}>
            <Plus size={14} />
            Adicionar
          </Button>
        )}
      </div>

      {isLoading ? (
        <p className="py-2 text-sm text-content-muted">Carregando endereços…</p>
      ) : addresses.length === 0 && !formOpen ? (
        <p className="py-2 text-sm text-content-muted">
          Nenhum endereço de entrega. A NF-e usa o endereço fiscal do cliente.
        </p>
      ) : (
        <ul className="space-y-2">
          {addresses.map((a) => (
            <li
              key={a.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <MapPin size={16} className="mt-0.5 shrink-0 text-content-muted" />
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-content">
                    <span className="truncate">{a.label}</span>
                    {a.isDefault && <Badge variant="brand">Padrão</Badge>}
                  </p>
                  <p className="truncate text-xs text-content-muted">{formatAddressLine(a)}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => openEdit(a)}
                  title="Editar endereço"
                  className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400"
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(a)}
                  title="Remover endereço"
                  className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-danger"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {formOpen && (
        // <form> irmão do form principal do cliente (não aninhado) — submit próprio
        <form
          onSubmit={(e) => {
            e.stopPropagation();
            handleSubmit((values) => save.mutate(values))(e);
          }}
          className="space-y-3 rounded-lg border border-border bg-surface-secondary p-3"
        >
          <Field label="Rótulo" required error={errors.label?.message}>
            <Input {...register('label')} placeholder='Ex.: "Obra Fazenda Santa Fé"' autoFocus />
          </Field>
          <div className="grid grid-cols-[140px,1fr] gap-3">
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
            <Field label="Endereço" required error={errors.address?.message}>
              <Input {...register('address')} placeholder="Rua, avenida..." error={!!errors.address} />
            </Field>
          </div>
          <div className="grid grid-cols-[100px,1fr,1fr] gap-3">
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
          <div className="grid grid-cols-[1fr,120px] gap-3">
            <Field label="Cidade" required error={errors.city?.message}>
              <Input {...register('city')} placeholder="Cidade" error={!!errors.city} />
            </Field>
            <Field label="UF" required error={errors.state?.message}>
              <Select {...register('state')} error={!!errors.state}>
                <option value="">—</option>
                {UF.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...register('isDefault')} className="accent-brand-600" />
              Endereço padrão de entrega
            </label>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={closeForm}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" loading={save.isPending}>
                {editing ? 'Salvar endereço' : 'Adicionar endereço'}
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
