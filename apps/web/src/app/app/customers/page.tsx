'use client';

import { useState } from 'react';
import { Plus, Pencil, Power } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useList, useCreate, useUpdate } from '@/hooks/use-resource';
import type { Customer } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatCpfCnpj, unmask } from '@/lib/format';
import { CUSTOMER_TYPE_LABELS } from '@/lib/enums';
import { CustomerForm, type CustomerFormValues } from './customer-form';

const RESOURCE = '/customers';

export default function CustomersPage() {
  const companyId = useAuthStore((s) => s.user?.companyId ?? '');
  const toast = useToast();
  const confirm = useConfirm();

  const { data: customers = [], isLoading } = useList<Customer>(RESOURCE);
  const create = useCreate<Customer, CustomerFormValues & { companyId: string }>(RESOURCE);
  const update = useUpdate<Customer>(RESOURCE);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(c: Customer) {
    setEditing(c);
    setDialogOpen(true);
  }

  function handleSubmit(values: CustomerFormValues) {
    const payload = {
      ...values,
      document: values.document ? unmask(values.document) : undefined,
      email: values.email || undefined,
    };
    if (editing) {
      update.mutate(
        { id: editing.id, data: payload },
        {
          onSuccess: () => {
            toast.success('Cliente atualizado');
            setDialogOpen(false);
          },
          onError: () => toast.error('Erro ao atualizar cliente'),
        },
      );
    } else {
      create.mutate(
        { ...payload, companyId },
        {
          onSuccess: () => {
            toast.success('Cliente criado');
            setDialogOpen(false);
          },
          onError: () => toast.error('Erro ao criar cliente'),
        },
      );
    }
  }

  async function toggleActive(c: Customer) {
    const turningOff = c.isActive;
    const ok = await confirm({
      title: turningOff ? 'Desativar cliente?' : 'Reativar cliente?',
      description: turningOff
        ? `"${c.name}" deixará de aparecer nas operações.`
        : `"${c.name}" voltará a ficar disponível.`,
      confirmLabel: turningOff ? 'Desativar' : 'Reativar',
      variant: turningOff ? 'danger' : 'primary',
    });
    if (!ok) return;
    update.mutate(
      { id: c.id, data: { isActive: !c.isActive } },
      {
        onSuccess: () => toast.success(turningOff ? 'Cliente desativado' : 'Cliente reativado'),
        onError: () => toast.error('Erro ao alterar status'),
      },
    );
  }

  const columns: Column<Customer>[] = [
    {
      key: 'type',
      header: 'Tipo',
      align: 'center',
      sortable: true,
      cell: (c) => (
        <Badge variant={c.type === 'COMPANY' ? 'brand' : 'neutral'}>
          {c.type === 'COMPANY' ? 'PJ' : 'PF'}
        </Badge>
      ),
      accessor: (c) => CUSTOMER_TYPE_LABELS[c.type],
    },
    { key: 'name', header: 'Nome / Razão social', sortable: true },
    {
      key: 'document',
      header: 'CPF / CNPJ',
      cell: (c) => (c.document ? <span className="font-mono text-xs">{formatCpfCnpj(c.document)}</span> : '—'),
    },
    {
      key: 'city',
      header: 'Cidade/UF',
      cell: (c) => (c.city ? `${c.city}${c.state ? '/' + c.state : ''}` : '—'),
    },
    { key: 'email', header: 'E-mail', cell: (c) => c.email || '—' },
    {
      key: 'isActive',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (c) => (c.isActive ? 1 : 0),
      cell: (c) => (
        <Badge variant={c.isActive ? 'success' : 'neutral'}>
          {c.isActive ? 'Ativo' : 'Inativo'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (c) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              openEdit(c);
            }}
            title="Editar"
            className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleActive(c);
            }}
            title={c.isActive ? 'Desativar' : 'Reativar'}
            className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-danger"
          >
            <Power size={15} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Clientes"
        description="Cadastro de clientes pessoa física e jurídica."
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} />
            Novo cliente
          </Button>
        }
      />

      <DataTable
        data={customers}
        columns={columns}
        loading={isLoading}
        onRowClick={openEdit}
        searchPlaceholder="Buscar por nome ou documento..."
        emptyMessage="Nenhum cliente cadastrado."
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? 'Editar cliente' : 'Novo cliente'}
        description={editing ? `Editando "${editing.name}"` : 'Preencha os dados do cliente.'}
        formId="customer-form"
        loading={create.isPending || update.isPending}
      >
        <CustomerForm
          key={editing?.id ?? 'new'}
          formId="customer-form"
          defaultValues={
            editing
              ? {
                  type: editing.type,
                  name: editing.name,
                  document: editing.document ? formatCpfCnpj(editing.document) : '',
                  email: editing.email ?? '',
                  phone: editing.phone ?? '',
                  address: editing.address ?? '',
                  city: editing.city ?? '',
                  state: editing.state ?? '',
                }
              : undefined
          }
          onSubmit={handleSubmit}
        />
      </FormDialog>
    </div>
  );
}
