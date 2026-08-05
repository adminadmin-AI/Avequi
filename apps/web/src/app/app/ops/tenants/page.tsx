'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, LogIn, Plus, RefreshCw } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import { ehNegativaDeAcesso, mensagemDoErro } from '@/lib/api-error';
import type { RunMeteringResult, Tenant } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { EntrarNaContaDialog } from '../entrar-na-conta-dialog';
import { STATUS_LABEL, STATUS_VARIANT } from '../tenant-status';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { AtivarMfaLink } from '../ativar-mfa-link';
import { Can } from '@/components/can';
import { usePermission } from '@/hooks/use-permission';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { formatCNPJ, formatDate, formatDateTime, formatNumber, formatRelativeTime } from '@/lib/format';

const RESOURCE = '/ops/tenants';

/**
 * Operadora — lista de contas de cliente (tenants). Control plane cross-tenant
 * (OPS WP1 #908 / WP2 #909) — só quem tem `ops.tenants.view` chega aqui
 * (gate no nav-config + backend com MFA obrigatório, ver OpsMfaGuard).
 *
 * OPS WP3 (#910): uso embutido em cada linha (ativos 30d, NF-e do mês, erros
 * 7d, último login) + reprocessamento manual do metering para quem tem
 * `ops.tenants.manage`.
 *
 * Painel da Operadora (#957): a lista saiu de `/app/ops` (que virou o painel
 * de negócio, a home do console) e passou a morar aqui, em
 * `/app/ops/tenants`. Os alertas da carteira foram JUNTO PARA O PAINEL — é lá
 * que mora o que precisa de ação. As URLs de DETALHE não mudaram
 * (`/app/ops/<id>`): em Next, as rotas estáticas irmãs (tenants/new/plans/
 * billing) têm precedência sobre `[id]`.
 */
export default function OpsTenantsPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  // OPS F2: mesmo gate do <Can> do cabeçalho — o CTA do estado vazio é uma
  // prop (não dá pra envolver em <Can>), então decide pela permissão aqui.
  const { can } = usePermission();
  // OPS F2: conta selecionada no botão "Entrar no ERP" da linha — abre o
  // diálogo de entrada (usuário + motivo) sem sair da lista.
  const [entrarTenant, setEntrarTenant] = useState<{ id: string; name: string } | null>(null);
  const { data: tenants = [], isLoading, isError, error, refetch } = useList<Tenant>(RESOURCE);

  const runMetering = useMutation({
    mutationFn: () => apiClient.post<RunMeteringResult>('/ops/metering/run', { days: 7 }),
    onSuccess: (res) => {
      toast.success(`Métricas reprocessadas (${res.data.processedDays} dia(s) recalculados)`);
      qc.invalidateQueries({ queryKey: [RESOURCE] });
      qc.invalidateQueries({ queryKey: ['/ops/alerts'] });
    },
    onError: (err) => toast.error(mensagemDoErro(err) ?? 'Não foi possível reprocessar as métricas'),
  });

  async function handleReprocessMetering() {
    const ok = await confirm({
      title: 'Reprocessar métricas dos últimos 7 dias?',
      description:
        'Recalcula o uso diário de toda a carteira. Use depois de uma falha na rotina automática ou para conferir os números na hora.',
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
          // #936 — o 403 do OpsMfaGuard tem saída: link direto pra ativar o MFA.
          action={<AtivarMfaLink message={mensagemDoErro(error)} />}
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
          {/* Botão COM RÓTULO de propósito (feedback do Claudio: ícone mudo
              no canto da linha não se explica) — é a ação principal da
              operadora sobre uma conta. Abre o diálogo de entrada AQUI
              mesmo (usuário + motivo) e cai dentro do ERP do cliente. */}
          <button
            onClick={(e) => {
              e.stopPropagation(); // o clique na LINHA abre a visão geral
              setEntrarTenant({ id: t.id, name: t.name });
            }}
            title={`Entrar no ERP de ${t.name} (ver como o cliente)`}
            aria-label={`Entrar no ERP de ${t.name} (ver como o cliente)`}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-content-secondary transition-colors duration-fast hover:border-brand-400/50 hover:bg-brand-600/10 hover:text-brand-600 dark:hover:text-brand-400"
          >
            <LogIn size={14} />
            Entrar no ERP
          </button>
        </Can>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Contas de cliente"
        description="Contas da operadora Avecchi: onboarding, ciclo de vida e suporte."
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

      <EntrarNaContaDialog tenant={entrarTenant} onClose={() => setEntrarTenant(null)} />
    </div>
  );
}
