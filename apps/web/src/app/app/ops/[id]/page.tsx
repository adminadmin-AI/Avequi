'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowRight, Ban, PlayCircle, ShieldAlert, TestTube2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useDetail } from '@/hooks/use-resource';
import { ehNegativaDeAcesso, mensagemDoErro } from '@/lib/api-error';
import type { TenantDetail, TenantProvisioning, TenantStatus, UpdateTenantStatusInput } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { ErrorState } from '@/components/ui/error-state';
import { FormDialog } from '@/components/ui/form-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
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
