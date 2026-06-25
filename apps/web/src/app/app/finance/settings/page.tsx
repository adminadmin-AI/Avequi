'use client';

import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useList, useCreate, useUpdate, useDelete } from '@/hooks/use-resource';
import { useAuthStore } from '@/stores/auth-store';
import type { FinancialCategory, CostCenter } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { CategoryForm, type CategoryFormValues, CATEGORY_TYPES } from './category-form';
import { CostCenterForm, type CostCenterFormValues } from './cost-center-form';

const CATEGORIES = '/finance/categories';
const COST_CENTERS = '/finance/cost-centers';

const TYPE_LABEL = Object.fromEntries(CATEGORY_TYPES.map((t) => [t.value, t.label]));
const TYPE_VARIANT: Record<string, any> = {
  REVENUE: 'success',
  EXPENSE: 'danger',
  TRANSFER: 'info',
  GROUP: 'neutral',
};

/** Achata a árvore (raiz + filhos) em linhas com marca de profundidade. */
function flatten<T extends { id: string; children?: T[] }>(roots: T[]): (T & { depth: number })[] {
  const out: (T & { depth: number })[] = [];
  const walk = (nodes: T[], depth: number) => {
    for (const n of nodes) {
      out.push({ ...n, depth });
      if (n.children?.length) walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

function Tabs({ tab, setTab }: { tab: string; setTab: (t: 'categories' | 'cost-centers') => void }) {
  const items = [
    { id: 'categories', label: 'Categorias' },
    { id: 'cost-centers', label: 'Centros de Custo' },
  ] as const;
  return (
    <div className="mb-5 flex gap-1 border-b border-slate-200">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => setTab(it.id)}
          className={cn(
            'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
            tab === it.id
              ? 'border-brand-600 text-brand-700'
              : 'border-transparent text-slate-500 hover:text-slate-700',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export default function FinanceSettingsPage() {
  const companyId = useAuthStore((s) => s.user?.companyId ?? '');
  const toast = useToast();
  const confirm = useConfirm();

  const [tab, setTab] = useState<'categories' | 'cost-centers'>('categories');

  // ── Categorias ──
  const { data: catRoots = [], isLoading: catLoading } = useList<FinancialCategory>(CATEGORIES);
  const catCreate = useCreate<FinancialCategory, CategoryFormValues & { companyId: string }>(CATEGORIES);
  const catUpdate = useUpdate<FinancialCategory>(CATEGORIES);
  const catDelete = useDelete(CATEGORIES);
  const categories = useMemo(() => flatten(catRoots), [catRoots]);

  const [catDialog, setCatDialog] = useState(false);
  const [catEditing, setCatEditing] = useState<FinancialCategory | null>(null);

  function submitCategory(values: CategoryFormValues) {
    const payload = { ...values, code: values.code || undefined, dreCode: values.dreCode || undefined };
    const opts = {
      onSuccess: () => {
        toast.success(catEditing ? 'Categoria atualizada' : 'Categoria criada');
        setCatDialog(false);
      },
      onError: () => toast.error('Erro ao salvar categoria'),
    };
    if (catEditing) catUpdate.mutate({ id: catEditing.id, data: payload }, opts);
    else catCreate.mutate({ ...payload, companyId }, opts);
  }

  async function deactivateCategory(c: FinancialCategory) {
    const ok = await confirm({
      title: 'Desativar categoria?',
      description: `"${c.name}" deixará de aparecer nas seleções financeiras.`,
      confirmLabel: 'Desativar',
      variant: 'danger',
    });
    if (!ok) return;
    catDelete.mutate(c.id, {
      onSuccess: () => toast.success('Categoria desativada'),
      onError: () => toast.error('Erro ao desativar'),
    });
  }

  const catColumns: Column<FinancialCategory & { depth: number }>[] = [
    {
      key: 'name',
      header: 'Nome',
      cell: (c) => (
        <span style={{ paddingLeft: c.depth * 16 }} className={c.depth ? 'text-slate-600' : 'font-medium'}>
          {c.depth > 0 && <span className="mr-1 text-slate-300">└</span>}
          {c.name}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Tipo',
      cell: (c) => <Badge variant={TYPE_VARIANT[c.type]}>{TYPE_LABEL[c.type] ?? c.type}</Badge>,
    },
    { key: 'code', header: 'Código', cell: (c) => (c.code ? <span className="font-mono text-xs">{c.code}</span> : '—') },
    {
      key: 'isActive',
      header: 'Status',
      align: 'center',
      cell: (c) => <Badge variant={c.isActive ? 'success' : 'neutral'}>{c.isActive ? 'Ativo' : 'Inativo'}</Badge>,
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
              setCatEditing(c);
              setCatDialog(true);
            }}
            title="Editar"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              deactivateCategory(c);
            }}
            title="Desativar"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-danger"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  // ── Centros de Custo ──
  const { data: ccRoots = [], isLoading: ccLoading } = useList<CostCenter>(COST_CENTERS);
  const ccCreate = useCreate<CostCenter, CostCenterFormValues & { companyId: string }>(COST_CENTERS);
  const ccUpdate = useUpdate<CostCenter>(COST_CENTERS);
  const ccDelete = useDelete(COST_CENTERS);
  const costCenters = useMemo(() => flatten(ccRoots), [ccRoots]);

  const [ccDialog, setCcDialog] = useState(false);
  const [ccEditing, setCcEditing] = useState<CostCenter | null>(null);

  function submitCostCenter(values: CostCenterFormValues) {
    const payload = { ...values, code: values.code || undefined };
    const opts = {
      onSuccess: () => {
        toast.success(ccEditing ? 'Centro de custo atualizado' : 'Centro de custo criado');
        setCcDialog(false);
      },
      onError: () => toast.error('Erro ao salvar centro de custo'),
    };
    if (ccEditing) ccUpdate.mutate({ id: ccEditing.id, data: payload }, opts);
    else ccCreate.mutate({ ...payload, companyId }, opts);
  }

  async function deactivateCostCenter(c: CostCenter) {
    const ok = await confirm({
      title: 'Desativar centro de custo?',
      description: `"${c.name}" deixará de aparecer nas seleções financeiras.`,
      confirmLabel: 'Desativar',
      variant: 'danger',
    });
    if (!ok) return;
    ccDelete.mutate(c.id, {
      onSuccess: () => toast.success('Centro de custo desativado'),
      onError: () => toast.error('Erro ao desativar'),
    });
  }

  const ccColumns: Column<CostCenter & { depth: number }>[] = [
    { key: 'code', header: 'Código', cell: (c) => (c.code ? <span className="font-mono text-xs">{c.code}</span> : '—') },
    {
      key: 'name',
      header: 'Nome',
      cell: (c) => (
        <span style={{ paddingLeft: c.depth * 16 }} className={c.depth ? 'text-slate-600' : 'font-medium'}>
          {c.depth > 0 && <span className="mr-1 text-slate-300">└</span>}
          {c.name}
        </span>
      ),
    },
    {
      key: 'isActive',
      header: 'Status',
      align: 'center',
      cell: (c) => <Badge variant={c.isActive ? 'success' : 'neutral'}>{c.isActive ? 'Ativo' : 'Inativo'}</Badge>,
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
              setCcEditing(c);
              setCcDialog(true);
            }}
            title="Editar"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              deactivateCostCenter(c);
            }}
            title="Desativar"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-danger"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Configurações financeiras"
        description="Categorias e centros de custo para classificar lançamentos."
        actions={
          tab === 'categories' ? (
            <Button
              onClick={() => {
                setCatEditing(null);
                setCatDialog(true);
              }}
            >
              <Plus size={16} />
              Nova categoria
            </Button>
          ) : (
            <Button
              onClick={() => {
                setCcEditing(null);
                setCcDialog(true);
              }}
            >
              <Plus size={16} />
              Novo centro de custo
            </Button>
          )
        }
      />

      <Tabs tab={tab} setTab={setTab} />

      {tab === 'categories' ? (
        <DataTable
          data={categories}
          columns={catColumns}
          loading={catLoading}
          searchPlaceholder="Buscar categoria..."
          emptyMessage="Nenhuma categoria cadastrada."
        />
      ) : (
        <DataTable
          data={costCenters}
          columns={ccColumns}
          loading={ccLoading}
          searchPlaceholder="Buscar centro de custo..."
          emptyMessage="Nenhum centro de custo cadastrado."
        />
      )}

      <FormDialog
        open={catDialog}
        onOpenChange={setCatDialog}
        title={catEditing ? 'Editar categoria' : 'Nova categoria'}
        formId="category-form"
        loading={catCreate.isPending || catUpdate.isPending}
      >
        <CategoryForm
          key={catEditing?.id ?? 'new'}
          formId="category-form"
          defaultValues={
            catEditing
              ? {
                  name: catEditing.name,
                  type: catEditing.type,
                  code: catEditing.code ?? '',
                  dreCode: catEditing.dreCode ?? '',
                }
              : undefined
          }
          onSubmit={submitCategory}
        />
      </FormDialog>

      <FormDialog
        open={ccDialog}
        onOpenChange={setCcDialog}
        title={ccEditing ? 'Editar centro de custo' : 'Novo centro de custo'}
        formId="cost-center-form"
        loading={ccCreate.isPending || ccUpdate.isPending}
      >
        <CostCenterForm
          key={ccEditing?.id ?? 'new'}
          formId="cost-center-form"
          defaultValues={ccEditing ? { name: ccEditing.name, code: ccEditing.code ?? '' } : undefined}
          onSubmit={submitCostCenter}
        />
      </FormDialog>
    </div>
  );
}
