'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Crown, Plus } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { ehNegativaDeAcesso, mensagemDoErro } from '@/lib/api-error';
import { formatBRL } from '@/lib/format';
import type {
  CreatePlanInput,
  EntitlementDef,
  Plan,
  PlansCatalog,
  UpdatePlanInput,
} from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { AtivarMfaLink } from '../ativar-mfa-link';
import { FormDialog } from '@/components/ui/form-dialog';
import { Can } from '@/components/can';
import { useToast } from '@/components/ui/toast';
import { PlanForm, type PlanFormValues } from './plan-form';

const RESOURCE = '/ops/plans';

/** Resumo em chips: módulos ligados + limites (ex.: "Limite de usuários: 25"). */
function entitlementChips(plan: Plan, catalog: EntitlementDef[]): string[] {
  const chips: string[] = [];
  for (const def of catalog) {
    const value = plan.entitlements[def.key];
    if (def.type === 'bool') {
      if (value === true) chips.push(def.name);
    } else {
      chips.push(`${def.name}: ${value === null || value === undefined ? 'ilimitado' : value}`);
    }
  }
  return chips;
}

/**
 * Operadora — catálogo de planos e entitlements do SaaS (OPS WP4 #911).
 * Control plane cross-tenant, mesma família de /app/ops — gate de nav por
 * `ops.plans.view`; criar/editar exige `ops.plans.manage`.
 */
export default function OpsPlansPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery<PlansCatalog>({
    queryKey: [RESOURCE],
    queryFn: async () => (await apiClient.get<PlansCatalog>(RESOURCE)).data,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);

  const createPlan = useMutation({
    mutationFn: (input: CreatePlanInput) => apiClient.post<Plan>(RESOURCE, input),
    onSuccess: () => {
      toast.success('Plano criado');
      qc.invalidateQueries({ queryKey: [RESOURCE] });
      setDialogOpen(false);
    },
    onError: (err) => toast.error(mensagemDoErro(err) ?? 'Não foi possível criar o plano'),
  });

  const updatePlan = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePlanInput }) =>
      apiClient.patch<Plan>(`${RESOURCE}/${id}`, input),
    onSuccess: () => {
      toast.success('Plano atualizado');
      qc.invalidateQueries({ queryKey: [RESOURCE] });
      setDialogOpen(false);
    },
    onError: (err) => toast.error(mensagemDoErro(err) ?? 'Não foi possível atualizar o plano'),
  });

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(plan: Plan) {
    setEditing(plan);
    setDialogOpen(true);
  }

  function handleSubmit(values: PlanFormValues) {
    if (editing) {
      updatePlan.mutate({
        id: editing.id,
        input: {
          name: values.name,
          description: values.description,
          priceCents: values.priceCents,
          active: values.active,
          entitlements: values.entitlements,
        },
      });
    } else {
      createPlan.mutate({
        code: values.code,
        name: values.name,
        description: values.description,
        priceCents: values.priceCents,
        entitlements: values.entitlements,
      });
    }
  }

  if (isError) {
    const negado = ehNegativaDeAcesso(error);
    return (
      <div>
        <PageHeader title="Planos" description="Catálogo de planos e entitlements do SaaS Avecchi." />
        <ErrorState
          fullPage={false}
          title={negado ? 'Acesso negado' : 'Não foi possível carregar os planos'}
          description={
            negado
              ? (mensagemDoErro(error) ?? 'Você não tem permissão para acessar esta área.')
              : (mensagemDoErro(error) ?? 'Tente novamente em instantes.')
          }
          onRetry={negado ? undefined : () => refetch()}
          // #936 — o 403 do OpsMfaGuard tem saída: link direto pra ativar o MFA.
          action={<AtivarMfaLink message={mensagemDoErro(error)} />}
        />
      </div>
    );
  }

  const catalog = data?.catalog ?? [];

  const columns: Column<Plan>[] = [
    {
      key: 'code',
      header: 'Código',
      sortable: true,
      cell: (p) => <span className="font-mono text-xs font-medium text-content">{p.code}</span>,
    },
    {
      key: 'name',
      header: 'Nome',
      sortable: true,
      cell: (p) => (
        <div>
          <p className="font-medium text-content">{p.name}</p>
          {p.description && <p className="text-xs text-content-muted">{p.description}</p>}
        </div>
      ),
    },
    {
      key: 'entitlements',
      header: 'Entitlements',
      cell: (p) => (
        <div className="flex flex-wrap gap-1">
          {entitlementChips(p, catalog).length === 0 ? (
            <span className="text-xs text-content-muted">Nenhum módulo ligado</span>
          ) : (
            entitlementChips(p, catalog).map((chip) => (
              <Badge key={chip} variant="neutral">
                {chip}
              </Badge>
            ))
          )}
        </div>
      ),
    },
    {
      key: 'priceCents',
      header: 'Preço',
      align: 'right',
      sortable: true,
      accessor: (p) => p.priceCents ?? -1,
      cell: (p) => (
        <span className="tabular-nums">{p.priceCents != null ? formatBRL(p.priceCents / 100) : '—'}</span>
      ),
    },
    {
      key: 'companies',
      header: 'Contas',
      align: 'right',
      sortable: true,
      accessor: (p) => p._count.companies,
      cell: (p) => <span className="tabular-nums">{p._count.companies}</span>,
    },
    {
      key: 'active',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (p) => (p.active ? 1 : 0),
      cell: (p) => <Badge variant={p.active ? 'success' : 'neutral'}>{p.active ? 'Ativo' : 'Inativo'}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (p) => (
        <Can permission="ops.plans.manage">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              openEdit(p);
            }}
          >
            Editar
          </Button>
        </Can>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Planos"
        description="Catálogo de planos e entitlements do SaaS Avecchi: o que cada plano libera para as contas."
        actions={
          <Can permission="ops.plans.manage">
            <Button onClick={openCreate}>
              <Plus size={16} />
              Novo plano
            </Button>
          </Can>
        }
      />

      <DataTable
        data={data?.plans ?? []}
        columns={columns}
        loading={isLoading}
        onRowClick={(p) => openEdit(p)}
        searchPlaceholder="Buscar por código ou nome..."
        empty={
          <EmptyState
            icon={Crown}
            title="Nenhum plano cadastrado"
            description="Crie o primeiro plano para começar a atribuir contas."
            action={{ label: 'Novo plano', icon: <Plus size={16} />, onClick: openCreate }}
          />
        }
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? `Editar "${editing.name}"` : 'Novo plano'}
        description={
          editing
            ? undefined
            : 'O código não pode ser alterado depois de criado.'
        }
        formId="plan-form"
        loading={createPlan.isPending || updatePlan.isPending}
        size="lg"
      >
        <PlanForm
          key={editing?.id ?? 'new'}
          formId="plan-form"
          isEdit={!!editing}
          catalog={catalog}
          plan={editing ?? undefined}
          onSubmit={handleSubmit}
        />
      </FormDialog>
    </div>
  );
}
