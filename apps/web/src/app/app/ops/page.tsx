'use client';

import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Building2, LogIn, Plus, RefreshCw } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import { ehNegativaDeAcesso, mensagemDoErro } from '@/lib/api-error';
import type { OpsAlert, RunMeteringResult, Tenant, TenantStatus } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Can } from '@/components/can';
import { usePermission } from '@/hooks/use-permission';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { formatCNPJ, formatDate, formatDateTime, formatNumber, formatRelativeTime } from '@/lib/format';

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

const ALERT_SEVERITY_LABEL: Record<OpsAlert['severity'], string> = {
  CRITICAL: 'Crítico',
  WARNING: 'Aviso',
};

/** Painel de alertas da carteira — GET /ops/alerts (CRITICAL primeiro). */
function AlertsPanel({ onSelect }: { onSelect: (tenantId: string) => void }) {
  const { data, isLoading, isError } = useQuery<OpsAlert[]>({
    queryKey: ['/ops/alerts'],
    queryFn: async () => (await apiClient.get<OpsAlert[]>('/ops/alerts')).data,
  });

  // Erro no painel de alertas não pode derrubar a lista de contas — mostra
  // um aviso discreto e segue a vida.
  if (isError) {
    return (
      <p className="mb-5 flex items-center gap-1.5 text-sm text-content-muted">
        <AlertTriangle size={14} />
        Não foi possível carregar os alertas da carteira.
      </p>
    );
  }

  return (
    <Card className="mb-5">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Alertas da carteira</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-content-muted">Nenhum alerta na carteira ✓</p>
        ) : (
          <ul className="space-y-2">
            {data.map((a, i) => (
              <li key={`${a.type}-${a.tenantId}-${i}`}>
                <button
                  type="button"
                  onClick={() => onSelect(a.tenantId)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg border px-4 py-2.5 text-left text-sm transition-colors',
                    a.severity === 'CRITICAL'
                      ? 'border-danger-200 bg-danger-50 hover:bg-danger-100 dark:border-danger-900 dark:bg-danger-900/20 dark:hover:bg-danger-900/30'
                      : 'border-warning-200 bg-warning-50 hover:bg-warning-100 dark:border-warning-900 dark:bg-warning-900/20 dark:hover:bg-warning-900/30',
                  )}
                >
                  <Badge variant={a.severity === 'CRITICAL' ? 'danger' : 'warning'} className="mt-0.5 shrink-0">
                    {ALERT_SEVERITY_LABEL[a.severity]}
                  </Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-content">{a.tenantName}</span>
                    <span className="block text-content-secondary">{a.message}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Operadora — lista de contas de cliente (tenants). Control plane cross-tenant
 * (OPS WP1 #908 / WP2 #909) — só quem tem `ops.tenants.view` chega aqui
 * (gate no nav-config + backend com MFA obrigatório, ver OpsMfaGuard).
 *
 * OPS WP3 (#910): alertas da carteira no topo + uso embutido em cada linha
 * (ativos 30d, NF-e do mês, erros 7d, último login) + reprocessamento manual
 * do metering para quem tem `ops.tenants.manage`.
 */
export default function OpsTenantsPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  // OPS F2: mesmo gate do <Can> do cabeçalho — o CTA do estado vazio é uma
  // prop (não dá pra envolver em <Can>), então decide pela permissão aqui.
  const { can } = usePermission();
  const { data: tenants = [], isLoading, isError, error, refetch } = useList<Tenant>(RESOURCE);

  const runMetering = useMutation({
    mutationFn: () => apiClient.post<RunMeteringResult>('/ops/metering/run', { days: 7 }),
    onSuccess: (res) => {
      toast.success(`Métricas reprocessadas — ${res.data.processedDays} dia(s) recalculados`);
      qc.invalidateQueries({ queryKey: [RESOURCE] });
      qc.invalidateQueries({ queryKey: ['/ops/alerts'] });
    },
    onError: (err) => toast.error(mensagemDoErro(err) ?? 'Não foi possível reprocessar as métricas'),
  });

  async function handleReprocessMetering() {
    const ok = await confirm({
      title: 'Reprocessar métricas dos últimos 7 dias?',
      description:
        'Reagrega o metering diário da carteira inteira — use após um incidente do cron ou para conferir os números na hora.',
      confirmLabel: 'Reprocessar',
    });
    if (ok) runMetering.mutate();
  }

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
      key: 'activeUsers30d',
      header: 'Ativos 30d',
      align: 'right',
      accessor: (t) => t.usage?.activeUsers30d ?? null,
      cell: (t) => (
        <span className="tabular-nums">{t.usage ? formatNumber(t.usage.activeUsers30d) : '—'}</span>
      ),
    },
    {
      key: 'nfeMonth',
      header: 'NF-e (mês)',
      align: 'right',
      accessor: (t) => t.usage?.nfeMonth ?? null,
      cell: (t) => <span className="tabular-nums">{t.usage ? formatNumber(t.usage.nfeMonth) : '—'}</span>,
    },
    {
      key: 'errors7d',
      header: 'Erros 7d',
      align: 'right',
      accessor: (t) => t.usage?.errors7d ?? null,
      cell: (t) => (
        <span
          className={cn(
            'tabular-nums',
            t.usage && t.usage.errors7d > 0 && 'font-medium text-danger',
          )}
        >
          {t.usage ? formatNumber(t.usage.errors7d) : '—'}
        </span>
      ),
    },
    {
      key: 'lastLoginAt',
      header: 'Último login',
      sortable: true,
      accessor: (t) => t.usage?.lastLoginAt ?? null,
      cell: (t) =>
        t.usage?.lastLoginAt ? (
          <span title={formatDateTime(t.usage.lastLoginAt)}>{formatRelativeTime(t.usage.lastLoginAt)}</span>
        ) : (
          <span title="nunca">—</span>
        ),
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
    {
      // OPS F2 (pedido do Claudio): "entrar no ERP do cliente" a 1 clique da
      // lista — atalho para a aba Pessoas, onde vivem os botões "Ver como"
      // (impersonation WP6: escolhe O USUÁRIO, dá o motivo, sessão
      // somente-leitura de 30 min visível ao cliente).
      key: 'entrar',
      header: '',
      align: 'right',
      cell: (t) => (
        <Can permission="ops.impersonation.execute">
          <button
            onClick={(e) => {
              e.stopPropagation(); // o clique na LINHA abre a visão geral
              router.push(`/app/ops/${t.id}?tab=people`);
            }}
            title={`Entrar na conta ${t.name} (ver como o cliente)`}
            aria-label={`Entrar na conta ${t.name} (ver como o cliente)`}
            className="rounded-lg p-1.5 text-content-muted transition-colors duration-fast hover:bg-neutral-100 hover:text-brand-600 dark:hover:bg-neutral-800 dark:hover:text-brand-400"
          >
            <LogIn size={16} />
          </button>
        </Can>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Contas de cliente"
        description="Contas da operadora Avecchi — onboarding, ciclo de vida e suporte."
        actions={
          <div className="flex items-center gap-2">
            <Can permission="ops.tenants.manage">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReprocessMetering}
                loading={runMetering.isPending}
              >
                <RefreshCw size={15} />
                Reprocessar métricas
              </Button>
            </Can>
            {/* OPS F2: /app/ops/new entrou no mapa de rotas (nav-config) com o
                gate do backend (ops.tenants.provision) — o atalho some para
                quem não provisiona, em vez de levar a um "Acesso negado". */}
            <Can permission="ops.tenants.provision">
              <Button onClick={() => router.push('/app/ops/new')}>
                <Plus size={16} />
                Nova conta
              </Button>
            </Can>
          </div>
        }
      />

      <AlertsPanel onSelect={(tenantId) => router.push(`/app/ops/${tenantId}`)} />

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
            action={
              can('ops.tenants.provision')
                ? { label: 'Nova conta', icon: <Plus size={16} />, onClick: () => router.push('/app/ops/new') }
                : undefined
            }
          />
        }
      />
    </div>
  );
}
