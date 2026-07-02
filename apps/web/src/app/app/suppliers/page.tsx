'use client';

import { useState } from 'react';
import { Plus, Pencil, Power } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useList, useCreate, useUpdate } from '@/hooks/use-resource';
import type { Supplier } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatCNPJ, formatPhone, unmask } from '@/lib/format';
import { SupplierForm, type SupplierFormValues } from './supplier-form';

const RESOURCE = '/suppliers';

export default function SuppliersPage() {
  const companyId = useAuthStore((s) => s.user?.companyId ?? '');
  const toast = useToast();
  const confirm = useConfirm();

  const { data: suppliers = [], isLoading } = useList<Supplier>(RESOURCE);
  const create = useCreate<Supplier, SupplierFormValues & { companyId: string }>(RESOURCE);
  const update = useUpdate<Supplier>(RESOURCE);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(s: Supplier) {
    setEditing(s);
    setDialogOpen(true);
  }

  function handleSubmit(values: SupplierFormValues) {
    const payload = {
      ...values,
      cnpj: values.cnpj ? unmask(values.cnpj) : undefined,
      email: values.email || undefined,
    };
    if (editing) {
      update.mutate(
        { id: editing.id, data: payload },
        {
          onSuccess: () => {
            toast.success('Fornecedor atualizado');
            setDialogOpen(false);
          },
          onError: () => toast.error('Erro ao atualizar fornecedor'),
        },
      );
    } else {
      create.mutate(
        { ...payload, companyId },
        {
          onSuccess: () => {
            toast.success('Fornecedor criado');
            setDialogOpen(false);
          },
          onError: () => toast.error('Erro ao criar fornecedor'),
        },
      );
    }
  }

  async function toggleActive(s: Supplier) {
    const turningOff = s.isActive;
    const ok = await confirm({
      title: turningOff ? 'Desativar fornecedor?' : 'Reativar fornecedor?',
      description: turningOff
        ? `"${s.name}" deixará de aparecer nas operações de compra.`
        : `"${s.name}" voltará a ficar disponível.`,
      confirmLabel: turningOff ? 'Desativar' : 'Reativar',
      variant: turningOff ? 'danger' : 'primary',
    });
    if (!ok) return;
    update.mutate(
      { id: s.id, data: { isActive: !s.isActive } },
      {
        onSuccess: () => toast.success(turningOff ? 'Fornecedor desativado' : 'Fornecedor reativado'),
        onError: () => toast.error('Erro ao alterar status'),
      },
    );
  }

  const columns: Column<Supplier>[] = [
    { key: 'name', header: 'Razão social', sortable: true },
    {
      key: 'cnpj',
      header: 'CNPJ',
      cell: (s) => (s.cnpj ? <span className="font-mono text-xs">{formatCNPJ(s.cnpj)}</span> : '—'),
    },
    { key: 'email', header: 'E-mail', cell: (s) => s.email || '—' },
    { key: 'phone', header: 'Telefone', cell: (s) => (s.phone ? formatPhone(s.phone) : '—') },
    {
      key: 'leadTimeDays',
      header: 'Lead time',
      align: 'right',
      sortable: true,
      accessor: (s) => s.leadTimeDays,
      cell: (s) => `${s.leadTimeDays} d`,
    },
    {
      key: 'isActive',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (s) => (s.isActive ? 1 : 0),
      cell: (s) => (
        <Badge variant={s.isActive ? 'success' : 'neutral'}>
          {s.isActive ? 'Ativo' : 'Inativo'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (s) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              openEdit(s);
            }}
            title="Editar"
            className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleActive(s);
            }}
            title={s.isActive ? 'Desativar' : 'Reativar'}
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
        title="Fornecedores"
        description="Cadastro de fornecedores e prazos de entrega."
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} />
            Novo fornecedor
          </Button>
        }
      />

      <DataTable
        data={suppliers}
        columns={columns}
        loading={isLoading}
        onRowClick={openEdit}
        searchPlaceholder="Buscar por nome ou CNPJ..."
        emptyMessage="Nenhum fornecedor cadastrado."
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? 'Editar fornecedor' : 'Novo fornecedor'}
        description={editing ? `Editando "${editing.name}"` : 'Preencha os dados do fornecedor.'}
        formId="supplier-form"
        loading={create.isPending || update.isPending}
      >
        <SupplierForm
          key={editing?.id ?? 'new'}
          formId="supplier-form"
          defaultValues={
            editing
              ? {
                  name: editing.name,
                  cnpj: editing.cnpj ? formatCNPJ(editing.cnpj) : '',
                  email: editing.email ?? '',
                  phone: editing.phone ?? '',
                  leadTimeDays: editing.leadTimeDays,
                }
              : undefined
          }
          onSubmit={handleSubmit}
        />
      </FormDialog>
    </div>
  );
}
