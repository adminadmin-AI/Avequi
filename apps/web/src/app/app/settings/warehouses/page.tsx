'use client';

import { useMemo, useState } from 'react';
import { Plus, Pencil, Power } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useList, useCreate, useUpdate } from '@/hooks/use-resource';
import type { Warehouse, Company } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { WarehouseForm, type WarehouseFormValues } from './warehouse-form';

const RESOURCE = '/warehouses';

export default function WarehousesPage() {
  const companyId = useAuthStore((s) => s.user?.companyId ?? '');
  const toast = useToast();
  const confirm = useConfirm();

  const { data: warehouses = [], isLoading } = useList<Warehouse>(RESOURCE);
  const { data: companies = [] } = useList<Company>('/companies');
  const create = useCreate<Warehouse, WarehouseFormValues & { companyId: string }>(RESOURCE);
  const update = useUpdate<Warehouse>(RESOURCE);

  const companyName = useMemo(() => {
    const map = new Map(companies.map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? '—';
  }, [companies]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(w: Warehouse) {
    setEditing(w);
    setDialogOpen(true);
  }

  function handleSubmit(values: WarehouseFormValues) {
    const payload = {
      ...values,
      code: values.code.trim().toUpperCase(),
      description: values.description || undefined,
    };
    if (editing) {
      update.mutate(
        { id: editing.id, data: payload },
        {
          onSuccess: () => {
            toast.success('Depósito atualizado');
            setDialogOpen(false);
          },
          onError: () => toast.error('Erro ao atualizar depósito'),
        },
      );
    } else {
      create.mutate(
        { ...payload, companyId },
        {
          onSuccess: () => {
            toast.success('Depósito criado');
            setDialogOpen(false);
          },
          onError: () => toast.error('Erro ao criar depósito'),
        },
      );
    }
  }

  async function toggleActive(w: Warehouse) {
    const turningOff = w.isActive;
    const ok = await confirm({
      title: turningOff ? 'Desativar depósito?' : 'Reativar depósito?',
      description: turningOff
        ? `"${w.name}" deixará de aparecer nas operações de estoque.`
        : `"${w.name}" voltará a ficar disponível.`,
      confirmLabel: turningOff ? 'Desativar' : 'Reativar',
      variant: turningOff ? 'danger' : 'primary',
    });
    if (!ok) return;
    update.mutate(
      { id: w.id, data: { isActive: !w.isActive } },
      {
        onSuccess: () => toast.success(turningOff ? 'Depósito desativado' : 'Depósito reativado'),
        onError: () => toast.error('Erro ao alterar status'),
      },
    );
  }

  const columns: Column<Warehouse>[] = [
    {
      key: 'code',
      header: 'Código',
      sortable: true,
      cell: (w) => <span className="font-mono text-xs font-medium">{w.code}</span>,
    },
    { key: 'name', header: 'Nome', sortable: true },
    { key: 'company', header: 'Empresa', cell: (w) => companyName(w.companyId) },
    {
      key: 'isActive',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (w) => (w.isActive ? 1 : 0),
      cell: (w) => (
        <Badge variant={w.isActive ? 'success' : 'neutral'}>
          {w.isActive ? 'Ativo' : 'Inativo'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (w) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              openEdit(w);
            }}
            title="Editar"
            className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleActive(w);
            }}
            title={w.isActive ? 'Desativar' : 'Reativar'}
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
        title="Depósitos"
        description="Locais de armazenamento de estoque por empresa."
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} />
            Novo depósito
          </Button>
        }
      />

      <DataTable
        data={warehouses}
        columns={columns}
        loading={isLoading}
        onRowClick={openEdit}
        searchPlaceholder="Buscar por código ou nome..."
        emptyMessage="Nenhum depósito cadastrado."
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? 'Editar depósito' : 'Novo depósito'}
        description={editing ? `Editando "${editing.name}"` : 'Preencha os dados do depósito.'}
        formId="warehouse-form"
        loading={create.isPending || update.isPending}
      >
        <WarehouseForm
          key={editing?.id ?? 'new'}
          formId="warehouse-form"
          defaultValues={
            editing
              ? {
                  code: editing.code,
                  name: editing.name,
                  description: editing.description ?? '',
                }
              : undefined
          }
          onSubmit={handleSubmit}
        />
      </FormDialog>
    </div>
  );
}
