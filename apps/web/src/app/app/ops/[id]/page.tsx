'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Ban,
  Eye,
  History,
  LineChart,
  PlayCircle,
  ShieldAlert,
  TestTube2,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useDetail } from '@/hooks/use-resource';
import { ehNegativaDeAcesso, mensagemDoErro } from '@/lib/api-error';
import * as impersonation from '@/lib/impersonation';
import type {
  ImpersonateResult,
  StartImpersonationInput,
  TenantDetail,
  TenantHealth,
  TenantHealthUser,
  TenantProvisioning,
  TenantStatus,
  TenantTimelineEntry,
  TenantUsageSeries,
  UpdateTenantStatusInput,
} from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Can } from '@/components/can';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { ErrorState } from '@/components/ui/error-state';
import { FormDialog } from '@/components/ui/form-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { formatCNPJ, formatDate, formatDateTime, formatNumber, formatRelativeTime } from '@/lib/format';
import { USER_ROLE_LABELS } from '@/lib/enums';
import { FISCAL_TYPE_LABEL } from '../../fiscal/fiscal-status';
import { EntitlementsTab } from './entitlements-tab';
import { FinanceiroTab } from './financeiro-tab';

const RESOURCE = '/ops/tenants';
const USAGE_DAYS = 90;

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

const SUPPORT_STATUS_LABEL: Record<string, string> = {
  NEW: 'Novo',
  TRIAGING: 'Em triagem',
  TRIAGED: 'Triado',
  IN_PROGRESS: 'Em andamento',
  RESOLVED: 'Resolvido',
  CLOSED: 'Fechado',
};

const SUPPORT_STATUS_VARIANT: Record<string, BadgeVariant> = {
  NEW: 'info',
  TRIAGING: 'info',
  TRIAGED: 'info',
  IN_PROGRESS: 'warning',
  RESOLVED: 'success',
  CLOSED: 'neutral',
};

/** AuditAction (schema v2) → rótulo pt-BR; ações fora do mapa mostram o code cru. */
const AUDIT_ACTION_LABEL: Record<string, string> = {
  CREATE: 'Criação',
  UPDATE: 'Atualização',
  DELETE: 'Exclusão',
  APPROVE: 'Aprovação',
  REJECT: 'Rejeição',
  CANCEL: 'Cancelamento',
  FINALIZE: 'Finalização',
  REOPEN: 'Reabertura',
  EXPORT: 'Exportação',
  IMPORT: 'Importação',
};
function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? action;
}

/** Recharts fora do chunk inicial da rota — mesmo padrão dos widgets do workspace. */
const UsageSparkline = dynamic(() => import('./usage-charts').then((m) => m.UsageSparkline), {
  ssr: false,
  loading: () => <Skeleton className="h-[72px] w-full" />,
});

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Resumo curto de mudança (ex.: "tenantStatus: TRIAL → ACTIVE") a partir do
 * par oldValue/newValue do AuditLogV2 — só campos escalares que realmente
 * mudaram; `null` quando não há como resumir com segurança (não são objetos
 * comparáveis, ou nada escalar mudou).
 */
function summarizeChange(oldValue: unknown, newValue: unknown): string | null {
  if (!isPlainObject(oldValue) || !isPlainObject(newValue)) return null;
  const keys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);
  const diffs: string[] = [];
  for (const key of keys) {
    const ov = oldValue[key];
    const nv = newValue[key];
    if (ov === nv) continue;
    if (typeof ov === 'object' || typeof nv === 'object') continue;
    diffs.push(`${key}: ${ov ?? '—'} → ${nv ?? '—'}`);
  }
  return diffs.length > 0 ? diffs.join(' · ') : null;
}

/** Motivo obrigatório (Suspender/Encerrar) — mesmo mínimo do backend (#908). */
function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  loading: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const tooShort = reason.trim().length < 5;

  return (
    <FormDialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setReason('');
          setTouched(false);
        }
        onOpenChange(v);
      }}
      title={title}
      description={description}
      formId="tenant-status-reason"
      submitLabel={title}
      loading={loading}
    >
      <form
        id="tenant-status-reason"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (tooShort) return;
          onConfirm(reason.trim());
        }}
      >
        <Label htmlFor="reason" required>
          Motivo
        </Label>
        <Textarea
          id="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Explique o motivo — obrigatório, mínimo 5 caracteres"
          rows={3}
          error={touched && tooShort}
        />
        {touched && tooShort && (
          <p className="mt-1 text-xs text-danger">Informe pelo menos 5 caracteres.</p>
        )}
      </form>
    </FormDialog>
  );
}

/**
 * "Ver como" (impersonation, OPS WP6 #913) — mesmo mínimo de motivo (≥5) do
 * ReasonDialog. Ao confirmar, dispara o POST e — no sucesso — entrega o
 * resultado para `impersonation.start()`, que troca a sessão e navega para
 * `/app` (o dialog não chega a fechar "normalmente": a página já mudou).
 */
function ImpersonateDialog({
  open,
  onOpenChange,
  user,
  tenantId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: TenantHealthUser | null;
  tenantId: string;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const tooShort = reason.trim().length < 5;

  const startImpersonation = useMutation({
    mutationFn: (input: StartImpersonationInput) =>
      apiClient.post<ImpersonateResult>(`${RESOURCE}/${tenantId}/impersonate`, input),
    onSuccess: (res) => {
      impersonation.start(res.data, tenantId);
    },
    onError: (err) =>
      toast.error(mensagemDoErro(err) ?? 'Não foi possível iniciar a sessão de suporte'),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setReason('');
          setTouched(false);
        }
        onOpenChange(v);
      }}
      title="Ver como"
      description={user ? `Iniciar sessão de suporte visualizando a conta como "${user.name}".` : undefined}
      formId="impersonate-reason"
      submitLabel="Iniciar sessão"
      loading={startImpersonation.isPending}
    >
      <form
        id="impersonate-reason"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (tooShort || !user) return;
          startImpersonation.mutate({ userId: user.id, reason: reason.trim() });
        }}
      >
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" />
          Sessão somente-leitura de 30 min, registrada e visível ao cliente.
        </p>
        <Label htmlFor="impersonate-reason-input" required>
          Motivo
        </Label>
        <Textarea
          id="impersonate-reason-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Explique o motivo — obrigatório, mínimo 5 caracteres"
          rows={3}
          error={touched && tooShort}
        />
        {touched && tooShort && (
          <p className="mt-1 text-xs text-danger">Informe pelo menos 5 caracteres.</p>
        )}
      </form>
    </FormDialog>
  );
}

/** Tile de KPI simples (mesmo padrão do dashboard fiscal). */
function Kpi({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'danger' }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-content-muted">{label}</p>
        <p
          className={cn(
            'mt-1 text-2xl font-semibold tracking-tight',
            tone === 'danger' ? 'text-danger' : 'text-content',
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function SparkCard({
  title,
  sub,
  data,
  color,
}: {
  title: string;
  sub?: string;
  data: { date: string; value: number }[];
  color: string;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-content-muted">{title}</p>
          {sub && <span className="whitespace-nowrap text-helper text-content-muted">{sub}</span>}
        </div>
        <div className="mt-1">
          <UsageSparkline data={data} color={color} label={title} formatter={formatNumber} />
        </div>
      </CardContent>
    </Card>
  );
}

/** Aviso discreto reutilizado nos 3 sub-fetches do painel — erro não derruba a aba. */
function InlineError({ message }: { message: string }) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-content-muted">
      <AlertTriangle size={14} />
      {message}
    </p>
  );
}

// ─── Aba "Visão geral" ──────────────────────────────────────────────────────
function OverviewTab({ tenant }: { tenant: TenantDetail }) {
  const usageQuery = useQuery<TenantUsageSeries>({
    queryKey: [RESOURCE, tenant.id, 'usage', USAGE_DAYS],
    queryFn: async () =>
      (
        await apiClient.get<TenantUsageSeries>(`${RESOURCE}/${tenant.id}/usage`, {
          params: { days: USAGE_DAYS },
        })
      ).data,
  });

  const hasData = (usageQuery.data?.series.length ?? 0) > 0;

  return (
    <div className="space-y-5">
      {usageQuery.isError ? (
        <InlineError message="Não foi possível carregar os dados de uso." />
      ) : usageQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[76px] w-full" />
          ))}
        </div>
      ) : !hasData ? (
        <EmptyState
          compact
          icon={LineChart}
          title="Sem dados de uso ainda — rode o metering"
          description="Assim que o metering diário processar esta conta, KPIs e tendências aparecem aqui."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="NF-e emitidas" value={formatNumber(usageQuery.data!.totals.nfeIssued)} />
            <Kpi
              label="NF-e rejeitadas"
              value={formatNumber(usageQuery.data!.totals.nfeRejected)}
              tone={usageQuery.data!.totals.nfeRejected > 0 ? 'danger' : 'neutral'}
            />
            <Kpi label="Leads CRM" value={formatNumber(usageQuery.data!.totals.crmLeads)} />
            <Kpi
              label="Erros 5xx"
              value={formatNumber(usageQuery.data!.totals.errors5xx)}
              tone={usageQuery.data!.totals.errors5xx > 0 ? 'danger' : 'neutral'}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <SparkCard
              title="Usuários ativos"
              sub={`pico ${USAGE_DAYS}d: ${formatNumber(usageQuery.data!.totals.peakActiveUsers)}`}
              data={usageQuery.data!.series.map((p) => ({ date: p.date, value: p.activeUsers }))}
              color="#22C55E"
            />
            <SparkCard
              title="NF-e emitidas"
              data={usageQuery.data!.series.map((p) => ({ date: p.date, value: p.nfeIssued }))}
              color="var(--chart-1)"
            />
            <SparkCard
              title="Erros 5xx"
              data={usageQuery.data!.series.map((p) => ({ date: p.date, value: p.errors5xx }))}
              color="#EF4444"
            />
          </div>
        </>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Dados da conta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="CNPJ" value={formatCNPJ(tenant.cnpj)} />
            <Row label="Usuários" value={String(tenant._count.users)} />
            <Row label="Filiais" value={String(tenant._count.branches)} />
            <Row label="Onboarding concluído em" value={tenant.onboardedAt ? formatDate(tenant.onboardedAt) : '—'} />
            <Row label="Fim do trial" value={tenant.trialEndsAt ? formatDate(tenant.trialEndsAt) : '—'} />
            {tenant.suspendedAt && (
              <Row label="Suspensa em" value={formatDate(tenant.suspendedAt)} />
            )}
            {tenant.suspendReason && <Row label="Motivo" value={tenant.suspendReason} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Filiais ({tenant.branches.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {tenant.branches.length === 0 ? (
              <p className="text-sm text-content-muted">Nenhuma filial cadastrada.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {tenant.branches.map((b) => (
                  <li key={b.id} className="flex items-center justify-between py-2">
                    <span className="text-content">{b.name}</span>
                    <span className="font-mono text-xs text-content-muted">{formatCNPJ(b.cnpj)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Aba "Saúde" ────────────────────────────────────────────────────────────
function useTenantHealth(tenantId: string) {
  return useQuery<TenantHealth>({
    queryKey: [RESOURCE, tenantId, 'health'],
    queryFn: async () => (await apiClient.get<TenantHealth>(`${RESOURCE}/${tenantId}/health`)).data,
  });
}

function HealthTab({ tenantId }: { tenantId: string }) {
  const healthQuery = useTenantHealth(tenantId);

  if (healthQuery.isError) {
    return <InlineError message="Não foi possível carregar a saúde da conta." />;
  }
  if (healthQuery.isLoading || !healthQuery.data) {
    return (
      <div className="grid gap-5 md:grid-cols-2">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  const { recentRejections, recentErrors } = healthQuery.data;

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rejeições SEFAZ recentes</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {recentRejections.length === 0 ? (
            <p className="text-sm text-content-muted">Nenhuma rejeição/erro nos últimos 7 dias ✓</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {recentRejections.map((r) => (
                <li key={r.id} className="py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-content">{FISCAL_TYPE_LABEL[r.type]}</span>
                    <span className="shrink-0 text-xs text-content-muted" title={formatDateTime(r.createdAt)}>
                      {formatRelativeTime(r.createdAt)}
                    </span>
                  </div>
                  {r.rejectionReason && (
                    <p className="mt-0.5 text-content-secondary">{r.rejectionReason}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Erros 5xx recentes</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {recentErrors.length === 0 ? (
            <p className="text-sm text-content-muted">Nenhuma rejeição/erro nos últimos 7 dias ✓</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {recentErrors.map((e) => (
                <li key={e.id} className="py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium text-content">{e.title}</span>
                    <Badge variant={SUPPORT_STATUS_VARIANT[e.status] ?? 'neutral'}>
                      {SUPPORT_STATUS_LABEL[e.status] ?? e.status}
                    </Badge>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-content-muted">
                    <span className="font-mono">{e.protocol}</span>
                    <span title={formatDateTime(e.createdAt)}>{formatRelativeTime(e.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Aba "Pessoas" ──────────────────────────────────────────────────────────
function PeopleTab({ tenantId }: { tenantId: string }) {
  const healthQuery = useTenantHealth(tenantId);
  const [impersonateUser, setImpersonateUser] = useState<TenantHealthUser | null>(null);

  if (healthQuery.isError) {
    return <InlineError message="Não foi possível carregar as pessoas da conta." />;
  }

  const columns: Column<TenantHealthUser>[] = [
    {
      key: 'name',
      header: 'Nome',
      sortable: true,
      cell: (u) => <span className="font-medium text-content">{u.name}</span>,
    },
    { key: 'email', header: 'E-mail' },
    {
      key: 'role',
      header: 'Papel',
      cell: (u) => USER_ROLE_LABELS[u.role] ?? u.role,
    },
    {
      key: 'isActive',
      header: 'Ativo',
      align: 'center',
      cell: (u) => <Badge variant={u.isActive ? 'success' : 'neutral'}>{u.isActive ? 'Sim' : 'Não'}</Badge>,
    },
    {
      key: 'lastLoginAt',
      header: 'Último acesso',
      sortable: true,
      accessor: (u) => u.lastLoginAt,
      cell: (u) =>
        u.lastLoginAt ? (
          <span title={formatDateTime(u.lastLoginAt)}>{formatRelativeTime(u.lastLoginAt)}</span>
        ) : (
          <span title="nunca">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (u) =>
        u.isActive ? (
          <Can permission="ops.impersonation.execute">
            <Button variant="ghost" size="sm" onClick={() => setImpersonateUser(u)}>
              <Eye size={14} />
              Ver como
            </Button>
          </Can>
        ) : null,
    },
  ];

  return (
    <>
      <DataTable
        data={healthQuery.data?.users ?? []}
        columns={columns}
        loading={healthQuery.isLoading}
        searchPlaceholder="Buscar por nome ou e-mail..."
        empty={<EmptyState compact title="Nenhuma pessoa cadastrada" />}
      />
      <ImpersonateDialog
        open={!!impersonateUser}
        onOpenChange={(v) => {
          if (!v) setImpersonateUser(null);
        }}
        user={impersonateUser}
        tenantId={tenantId}
      />
    </>
  );
}

// ─── Aba "Linha do tempo" ───────────────────────────────────────────────────
function TimelineTab({ tenantId }: { tenantId: string }) {
  const timelineQuery = useQuery<TenantTimelineEntry[]>({
    queryKey: [RESOURCE, tenantId, 'timeline'],
    queryFn: async () =>
      (await apiClient.get<TenantTimelineEntry[]>(`${RESOURCE}/${tenantId}/timeline`, { params: { take: 50 } }))
        .data,
  });

  if (timelineQuery.isError) {
    return <InlineError message="Não foi possível carregar a linha do tempo." />;
  }
  if (timelineQuery.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }
  if (!timelineQuery.data || timelineQuery.data.length === 0) {
    return (
      <EmptyState
        compact
        icon={History}
        title="Nenhum evento registrado"
        description="Ações da operadora sobre esta conta (criação, suspensão, ativação, convites) aparecem aqui."
      />
    );
  }

  return (
    <ul className="space-y-0">
      {timelineQuery.data.map((entry) => {
        const diff = summarizeChange(entry.oldValue, entry.newValue);
        return (
          <li key={entry.id} className="relative border-l border-line py-3 pl-5 last:pb-0">
            <span className="absolute -left-[5px] top-4 h-2.5 w-2.5 rounded-full bg-brand-500" />
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <p className="text-sm font-medium text-content">{auditActionLabel(entry.action)}</p>
                {diff && <p className="mt-0.5 text-xs text-content-secondary">{diff}</p>}
              </div>
              <div className="shrink-0 text-right text-xs text-content-muted">
                <p>{entry.user?.name ?? 'Sistema'}</p>
                <p title={formatDateTime(entry.createdAt)}>{formatRelativeTime(entry.createdAt)}</p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const { data: tenant, isLoading, isError, error, refetch } = useDetail<TenantDetail>(RESOURCE, id);

  // Provisionamento pode não existir (tenant anterior ao WP2) — 404 é estado
  // normal aqui, não um erro a exibir.
  const provisioningQuery = useQuery<TenantProvisioning>({
    queryKey: [RESOURCE, id, 'provisioning'],
    queryFn: async () => (await apiClient.get(`${RESOURCE}/${id}/provisioning`)).data,
    enabled: !!id,
    retry: false,
  });
  const openProvisioning =
    provisioningQuery.data && !provisioningQuery.data.checklist.activation.done
      ? provisioningQuery.data
      : null;

  const [suspendOpen, setSuspendOpen] = useState(false);
  const [churnOpen, setChurnOpen] = useState(false);

  const updateStatus = useMutation({
    mutationFn: (input: UpdateTenantStatusInput) =>
      apiClient.patch(`${RESOURCE}/${id}/status`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [RESOURCE] });
      setSuspendOpen(false);
      setChurnOpen(false);
      toast.success('Status atualizado');
    },
    onError: (err) => toast.error(mensagemDoErro(err) ?? 'Não foi possível mudar o status'),
  });

  async function handleReactivate() {
    const ok = await confirm({
      title: 'Reativar conta?',
      description: `A conta "${tenant?.name}" volta a operar normalmente.`,
      confirmLabel: 'Reativar',
    });
    if (ok) updateStatus.mutate({ status: 'ACTIVE' });
  }

  async function handleSandbox() {
    const ok = await confirm({
      title: 'Marcar como sandbox?',
      description: `A conta "${tenant?.name}" passa a ser tratada como ambiente de testes.`,
      confirmLabel: 'Marcar como sandbox',
    });
    if (ok) updateStatus.mutate({ status: 'SANDBOX' });
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (isError || !tenant) {
    const negado = ehNegativaDeAcesso(error);
    return (
      <ErrorState
        title={negado ? 'Acesso negado' : 'Não foi possível carregar a conta'}
        description={
          negado
            ? (mensagemDoErro(error) ?? 'Você não tem permissão para acessar esta conta.')
            : (mensagemDoErro(error) ?? 'Tente novamente em instantes.')
        }
        onRetry={negado ? undefined : () => refetch()}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={tenant.name}
        description={tenant.razaoSocial}
        backHref="/app/ops"
        meta={<Badge variant={STATUS_VARIANT[tenant.tenantStatus]}>{STATUS_LABEL[tenant.tenantStatus]}</Badge>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {tenant.tenantStatus !== 'ACTIVE' && (
              <Button variant="secondary" onClick={handleReactivate} disabled={updateStatus.isPending}>
                <PlayCircle size={16} />
                Reativar
              </Button>
            )}
            {tenant.tenantStatus !== 'SANDBOX' && (
              <Button variant="secondary" onClick={handleSandbox} disabled={updateStatus.isPending}>
                <TestTube2 size={16} />
                Marcar como sandbox
              </Button>
            )}
            {tenant.tenantStatus !== 'SUSPENDED' && (
              <Button
                variant="secondary"
                onClick={() => setSuspendOpen(true)}
                disabled={updateStatus.isPending}
              >
                <ShieldAlert size={16} />
                Suspender
              </Button>
            )}
            {tenant.tenantStatus !== 'CHURNED' && (
              <Button variant="danger" onClick={() => setChurnOpen(true)} disabled={updateStatus.isPending}>
                <Ban size={16} />
                Encerrar
              </Button>
            )}
          </div>
        }
      />

      {openProvisioning && (
        <Link
          href={`/app/ops/new?tenantId=${tenant.id}`}
          className="mb-5 flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-700 transition-colors hover:bg-brand-100 dark:border-brand-600/40 dark:bg-brand-600/10 dark:text-brand-300 dark:hover:bg-brand-600/20"
        >
          <span className="flex items-center gap-2">
            <AlertCircle size={16} />
            Onboarding em aberto — continue o provisionamento desta conta.
          </span>
          <ArrowRight size={16} />
        </Link>
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          <TabsTrigger value="health">Saúde</TabsTrigger>
          <TabsTrigger value="people">Pessoas</TabsTrigger>
          <TabsTrigger value="plan">Plano & Módulos</TabsTrigger>
          <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
          <TabsTrigger value="timeline">Linha do tempo</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab tenant={tenant} />
        </TabsContent>
        <TabsContent value="health">
          <HealthTab tenantId={tenant.id} />
        </TabsContent>
        <TabsContent value="people">
          <PeopleTab tenantId={tenant.id} />
        </TabsContent>
        <TabsContent value="plan">
          <EntitlementsTab tenantId={tenant.id} />
        </TabsContent>
        <TabsContent value="financeiro">
          <FinanceiroTab tenantId={tenant.id} />
        </TabsContent>
        <TabsContent value="timeline">
          <TimelineTab tenantId={tenant.id} />
        </TabsContent>
      </Tabs>

      <ReasonDialog
        open={suspendOpen}
        onOpenChange={setSuspendOpen}
        title="Suspender conta"
        description={`Suspender "${tenant.name}" revoga imediatamente todas as sessões ativas dos usuários do tenant. A conta para de operar até ser reativada.`}
        loading={updateStatus.isPending}
        onConfirm={(reason) => updateStatus.mutate({ status: 'SUSPENDED', reason })}
      />
      <ReasonDialog
        open={churnOpen}
        onOpenChange={setChurnOpen}
        title="Encerrar conta"
        description={`Encerrar "${tenant.name}" revoga todas as sessões ativas dos usuários do tenant.`}
        loading={updateStatus.isPending}
        onConfirm={(reason) => updateStatus.mutate({ status: 'CHURNED', reason })}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-content-muted">{label}</span>
      <span className="text-right font-medium text-content">{value}</span>
    </div>
  );
}
