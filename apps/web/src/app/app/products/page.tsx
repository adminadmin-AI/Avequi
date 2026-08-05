'use client';

import { useState } from 'react';
import { Plus, Pencil, Power, Package } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { useList, useCreate, useUpdate } from '@/hooks/use-resource';
import type { Product } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { erroDeAcao } from '@/lib/feedback';
import { formatBRL, formatNCM } from '@/lib/format';
import { PRODUCT_TYPE_LABELS } from '@/lib/enums';
import { ProductForm, type ProductFormValues } from './product-form';

const RESOURCE = '/products';

export default function ProductsPage() {
  const toast = useToast();
  const confirm = useConfirm();

  const { data: products = [], isLoading } = useList<Product>(RESOURCE);
  const create = useCreate<Product, ProductFormValues>(RESOURCE);
  const update = useUpdate<Product, Partial<Product> | ProductFormValues>(RESOURCE);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [formDirty, setFormDirty] = useState(false);

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
          onError: (err) => toast.error(erroDeAcao('atualizar o produto', err)),
        },
      );
    } else {
      create.mutate(
        values,
        {
          onSuccess: () => {
            toast.success('Produto criado');
            setDialogOpen(false);
          },
          onError: (err) => toast.error(erroDeAcao('criar o produto', err)),
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
        onSuccess: () =>
          toast.success(
            turningOff ? 'Produto desativado' : 'Produto reativado',
            `"${p.name}"`,
            // undo: reverte para o status anterior direto do toast
            {
              label: 'Desfazer',
              onClick: () =>
                update.mutate(
                  { id: p.id, data: { isActive: p.isActive } },
                  {
                    onSuccess: () => toast.info('Ação desfeita'),
                    onError: (err) => toast.error(erroDeAcao('desfazer a alteração', err)),
                  },
                ),
            },
          ),
        onError: (err) => toast.error(erroDeAcao('alterar o status do produto', err)),
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
    // botões inline (preferência do Rafael 02/07: com 1-2 ações, inline é
    // melhor que menu ⋮; o rowActions do DataTable fica p/ telas com 3+ ações)
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

  // ações em massa da barra de seleção (F2.4 #310)
  async function bulkDeactivate(rows: Product[], clear: () => void) {
    const active = rows.filter((p) => p.isActive);
    if (active.length === 0) {
      toast.info('Nenhum produto ativo na seleção');
      return;
    }
    const ok = await confirm({
      title: `Desativar ${active.length} produto${active.length === 1 ? '' : 's'}?`,
      description: 'Eles deixarão de aparecer nas operações.',
      confirmLabel: 'Desativar',
      variant: 'danger',
    });
    if (!ok) return;
    const results = await Promise.allSettled(
      active.map((p) => update.mutateAsync({ id: p.id, data: { isActive: false } })),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) toast.error(`${failed} produto(s) falharam ao desativar`);
    else toast.success(`${active.length} produto(s) desativado(s)`);
    clear();
  }

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
        selectable
        viewOptions
        exportCsv="produtos.csv"
        bulkActions={(rows, clear) => (
          <Button variant="danger" size="sm" onClick={() => bulkDeactivate(rows, clear)}>
            <Power size={14} />
            Desativar selecionados
          </Button>
        )}
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
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setFormDirty(false);
        }}
        title={editing ? 'Editar produto' : 'Novo produto'}
        description={editing ? `Editando "${editing.name}"` : 'Preencha os dados do produto.'}
        formId="product-form"
        loading={create.isPending || update.isPending}
        dirty={formDirty}
      >
        <ProductForm
          key={editing?.id ?? 'new'}
          formId="product-form"
          onDirtyChange={setFormDirty}
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
                  origem: (editing.origem as any) ?? '0',
                  ean: editing.ean ?? undefined,
                  cest: editing.cest ?? undefined,
                  pesoLiquido: editing.pesoLiquido ? Number(editing.pesoLiquido) : undefined,
                  pesoBruto: editing.pesoBruto ? Number(editing.pesoBruto) : undefined,
                  unidadeTributavel: editing.unidadeTributavel ?? undefined,
                  fatorConversaoTributavel: editing.fatorConversaoTributavel ? Number(editing.fatorConversaoTributavel) : undefined,
                }
              : undefined
          }
          onSubmit={handleSubmit}
        />
      </FormDialog>
    </div>
  );
}
