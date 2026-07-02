'use client';

import { useState } from 'react';
import { Plus, Pencil, Power, Package } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuthStore } from '@/stores/auth-store';
import { useList, useCreate, useUpdate } from '@/hooks/use-resource';
import type { Product } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatBRL, formatNCM } from '@/lib/format';
import { PRODUCT_TYPE_LABELS } from '@/lib/enums';
import { ProductForm, type ProductFormValues } from './product-form';

const RESOURCE = '/products';

export default function ProductsPage() {
  const companyId = useAuthStore((s) => s.user?.companyId ?? '');
  const toast = useToast();
  const confirm = useConfirm();

  const { data: products = [], isLoading } = useList<Product>(RESOURCE);
  const create = useCreate<Product, ProductFormValues & { companyId: string }>(RESOURCE);
  const update = useUpdate<Product, Partial<Product> | ProductFormValues>(RESOURCE);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(p: Product) {
    setEditing(p);
    setDialogOpen(true);
  }

  function handleSubmit(values: ProductFormValues) {
    if (editing) {
      update.mutate(
        { id: editing.id, data: values },
        {
          onSuccess: () => {
            toast.success('Produto atualizado');
            setDialogOpen(false);
          },
          onError: () => toast.error('Erro ao atualizar produto'),
        },
      );
    } else {
      create.mutate(
        { ...values, companyId },
        {
          onSuccess: () => {
            toast.success('Produto criado');
            setDialogOpen(false);
          },
          onError: () => toast.error('Erro ao criar produto'),
        },
      );
    }
  }

  async function toggleActive(p: Product) {
    const turningOff = p.isActive;
    const ok = await confirm({
      title: turningOff ? 'Desativar produto?' : 'Reativar produto?',
      description: turningOff
        ? `"${p.name}" deixará de aparecer nas operações.`
        : `"${p.name}" voltará a ficar disponível.`,
      confirmLabel: turningOff ? 'Desativar' : 'Reativar',
      variant: turningOff ? 'danger' : 'primary',
    });
    if (!ok) return;
    update.mutate(
      { id: p.id, data: { isActive: !p.isActive } },
      {
        onSuccess: () => toast.success(turningOff ? 'Produto desativado' : 'Produto reativado'),
        onError: () => toast.error('Erro ao alterar status'),
      },
    );
  }

  const columns: Column<Product>[] = [
    {
      key: 'sku',
      header: 'SKU',
      sortable: true,
      cell: (p) => <span className="font-mono text-xs text-content-secondary">{p.sku}</span>,
    },
    { key: 'name', header: 'Nome', sortable: true },
    {
      key: 'type',
      header: 'Tipo',
      sortable: true,
      cell: (p) => <Badge variant="neutral">{PRODUCT_TYPE_LABELS[p.type]}</Badge>,
    },
    { key: 'unit', header: 'Un.', align: 'center' },
    {
      key: 'ncm',
      header: 'NCM',
      cell: (p) => (p.ncm ? <span className="font-mono text-xs">{formatNCM(p.ncm)}</span> : '—'),
    },
    {
      key: 'costPrice',
      header: 'Custo',
      align: 'right',
      sortable: true,
      accessor: (p) => Number(p.costPrice ?? 0),
      cell: (p) => (p.costPrice != null ? formatBRL(p.costPrice) : '—'),
    },
    {
      key: 'salePrice',
      header: 'Venda',
      align: 'right',
      sortable: true,
      accessor: (p) => Number(p.salePrice ?? 0),
      cell: (p) => (p.salePrice != null ? formatBRL(p.salePrice) : '—'),
    },
    {
      key: 'isActive',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (p) => (p.isActive ? 1 : 0),
      cell: (p) => (
        <Badge variant={p.isActive ? 'success' : 'neutral'}>
          {p.isActive ? 'Ativo' : 'Inativo'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (p) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              openEdit(p);
            }}
            title="Editar"
            className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleActive(p);
            }}
            title={p.isActive ? 'Desativar' : 'Reativar'}
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
        title="Produtos"
        description="Catálogo de produtos, componentes e serviços."
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} />
            Novo produto
          </Button>
        }
      />

      <DataTable
        data={products}
        columns={columns}
        loading={isLoading}
        onRowClick={openEdit}
        searchPlaceholder="Buscar por SKU ou nome..."
        empty={
          <EmptyState
            icon={Package}
            title="Nenhum produto cadastrado"
            description="Comece adicionando seu primeiro produto ao catálogo."
            action={{ label: 'Novo produto', icon: <Plus size={16} />, onClick: openCreate }}
          />
        }
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? 'Editar produto' : 'Novo produto'}
        description={editing ? `Editando "${editing.name}"` : 'Preencha os dados do produto.'}
        formId="product-form"
        loading={create.isPending || update.isPending}
      >
        <ProductForm
          key={editing?.id ?? 'new'}
          formId="product-form"
          defaultValues={
            editing
              ? {
                  sku: editing.sku,
                  name: editing.name,
                  description: editing.description ?? undefined,
                  type: editing.type,
                  unit: editing.unit,
                  ncm: editing.ncm ?? undefined,
                  costPrice: editing.costPrice ? Number(editing.costPrice) : undefined,
                  salePrice: editing.salePrice ? Number(editing.salePrice) : undefined,
                }
              : undefined
          }
          onSubmit={handleSubmit}
        />
      </FormDialog>
    </div>
  );
}
