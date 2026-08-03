'use client';

import { useRouter } from 'next/navigation';
import { Building2, Plus } from 'lucide-react';
import { useList } from '@/hooks/use-resource';
import { ehNegativaDeAcesso, mensagemDoErro } from '@/lib/api-error';
import type { Tenant, TenantStatus } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { formatCNPJ, formatDate } from '@/lib/format';

const RESOURCE = '/ops/tenants';

const STATUS_LABEL: Record<TenantStatus, string> = {
  TRIAL: 'Trial',
  ACTIVE: 'Ativa',
  SUSPENDED: 'Suspensa',
  CHURNED: 'Encerrada',
  SANDBOX: 'Sandbox',
};

const STATUS_VARIANT: Record<TenantStatus, BadgeVariant> = {
  TRIAL: 'info',
  ACTIVE: 'success',
  SUSPENDED: 'danger',
  CHURNED: 'neutral',
  SANDBOX: 'warning',
};

/**
 * Operadora — lista de contas de cliente (tenants). Control plane cross-tenant
 * (OPS WP1 #908 / WP2 #909) — só quem tem `ops.tenants.view` chega aqui
 * (gate no nav-config + backend com MFA obrigatório, ver OpsMfaGuard).
 */
export default function OpsTenantsPage() {
  const router = useRouter();
  const { data: tenants = [], isLoading, isError, error, refetch } = useList<Tenant>(RESOURCE);

  if (isError) {
    const negado = ehNegativaDeAcesso(error);
    return (
      <div>
        <PageHeader title="Contas de cliente" description="Contas da operadora Avecchi." />
        <ErrorState
          fullPage={false}
          title={negado ? 'Acesso negado' : 'Não foi possível carregar as contas'}
          description={
            negado
              ? (mensagemDoErro(error) ?? 'Você não tem permissão para acessar esta área.')
              : (mensagemDoErro(error) ?? 'Tente novamente em instantes.')
          }
          onRetry={negado ? undefined : () => refetch()}
        />
      </div>
    );
  }

  const columns: Column<Tenant>[] = [
    {
      key: 'name',
      header: 'Nome',
      sortable: true,
      accessor: (t) => `${t.name} ${t.razaoSocial}`,
      cell: (t) => (
        <div>
          <p className="font-medium text-content">{t.name}</p>
          <p className="text-xs text-content-muted">{t.razaoSocial}</p>
        </div>
      ),
    },
    {
      key: 'cnpj',
      header: 'CNPJ',
      cell: (t) => <span className="font-mono text-xs">{formatCNPJ(t.cnpj)}</span>,
    },
    {
      key: 'tenantStatus',
      header: 'Status',
      align: 'center',
      sortable: true,
      cell: (t) => <Badge variant={STATUS_VARIANT[t.tenantStatus]}>{STATUS_LABEL[t.tenantStatus]}</Badge>,
    },
    {
      key: 'users',
      header: 'Usuários',
      align: 'right',
      accessor: (t) => t._count.users,
      cell: (t) => <span className="tabular-nums">{t._count.users}</span>,
    },
    {
      key: 'branches',
      header: 'Filiais',
      align: 'right',
      accessor: (t) => t._count.branches,
      cell: (t) => <span className="tabular-nums">{t._count.branches}</span>,
    },
    {
      key: 'onboardedAt',
      header: 'Onboarding',
      sortable: true,
      cell: (t) => (t.onboardedAt ? formatDate(t.onboardedAt) : '—'),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Contas de cliente"
        description="Contas da operadora Avecchi — onboarding, ciclo de vida e suporte."
        actions={
          <Button onClick={() => router.push('/app/ops/new')}>
            <Plus size={16} />
            Nova conta
          </Button>
        }
      />

      <DataTable
        data={tenants}
        columns={columns}
        loading={isLoading}
        onRowClick={(t) => router.push(`/app/ops/${t.id}`)}
        searchPlaceholder="Buscar por nome, razão social ou CNPJ..."
        empty={
          <EmptyState
            icon={Building2}
            title="Nenhuma conta cadastrada"
            description="Comece o onboarding de uma nova conta de cliente."
            action={{ label: 'Nova conta', icon: <Plus size={16} />, onClick: () => router.push('/app/ops/new') }}
          />
        }
      />
    </div>
  );
}
