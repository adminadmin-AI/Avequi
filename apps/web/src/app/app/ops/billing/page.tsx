'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, PlayCircle } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { ehNegativaDeAcesso, mensagemDoErro } from '@/lib/api-error';
import { formatBRL, formatDate } from '@/lib/format';
import type {
  BillingOverview,
  InvoiceMethod,
  OpsOpenInvoice,
  RunBillingResult,
} from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { AtivarMfaLink } from '../ativar-mfa-link';
import { Skeleton } from '@/components/ui/skeleton';
import { Can } from '@/components/can';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_VARIANT,
  PayInvoiceDialog,
  VoidInvoiceDialog,
  formatPeriod,
} from './billing-shared';

const RESOURCE = '/ops/billing';

/** Tile de KPI simples (mesmo padrão do drill-down de tenant). */
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

/**
 * Operadora — Billing (OPS WP5 #912): MRR, aging e faturas em aberto da
 * carteira inteira. F1 = contrato + régua — a fatura nasce sozinha via cron
 * diário; "Rodar cobrança agora" é a recuperação manual do mesmo job.
 */
export default function OpsBillingPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery<BillingOverview>({
    queryKey: [RESOURCE],
    queryFn: async () => (await apiClient.get<BillingOverview>(RESOURCE)).data,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: [RESOURCE] });
    qc.invalidateQueries({ queryKey: ['/ops/tenants'] });
  };

  const runBilling = useMutation({
    mutationFn: () => apiClient.post<RunBillingResult>(`${RESOURCE}/run`),
    onSuccess: (res) => {
      const { invoicesCreated, emailsSent, overdueMarked } = res.data;
      toast.success(
        'Cobrança processada',
        `${invoicesCreated} fatura(s) criada(s) · ${overdueMarked} marcada(s) como vencida(s) · ${emailsSent} e-mail(s) de aviso enviado(s)`,
      );
      invalidateAll();
    },
    onError: (err) => toast.error(mensagemDoErro(err) ?? 'Não foi possível rodar a cobrança'),
  });

  async function handleRunBilling() {
    const ok = await confirm({
      title: 'Rodar cobrança agora?',
      description:
        'Gera as faturas da competência corrente para as assinaturas ativas e roda a régua de inadimplência (idempotente — seguro rodar mais de uma vez).',
      confirmLabel: 'Rodar cobrança',
    });
    if (ok) runBilling.mutate();
  }

  const [payTarget, setPayTarget] = useState<OpsOpenInvoice | null>(null);
  const [voidTarget, setVoidTarget] = useState<OpsOpenInvoice | null>(null);

  const payInvoice = useMutation({
    mutationFn: ({ id, method }: { id: string; method: InvoiceMethod }) =>
      apiClient.post(`${RESOURCE}/invoices/${id}/pay`, { method }),
    onSuccess: () => {
      toast.success('Baixa registrada');
      invalidateAll();
      setPayTarget(null);
    },
    onError: (err) => toast.error(mensagemDoErro(err) ?? 'Não foi possível dar baixa na fatura'),
  });

  const voidInvoice = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.post(`${RESOURCE}/invoices/${id}/void`, { reason }),
    onSuccess: () => {
      toast.success('Fatura anulada');
      invalidateAll();
      setVoidTarget(null);
    },
    onError: (err) => toast.error(mensagemDoErro(err) ?? 'Não foi possível anular a fatura'),
  });

  if (isError) {
    const negado = ehNegativaDeAcesso(error);
    return (
      <div>
        <PageHeader title="Cobrança" description="MRR, aging e faturas da carteira Avecchi." />
        <ErrorState
          fullPage={false}
          title={negado ? 'Acesso negado' : 'Não foi possível carregar o billing'}
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

  const mrrByPlan = Object.entries(data?.mrrByPlan ?? {}).sort(([, a], [, b]) => b - a);

  const columns: Column<OpsOpenInvoice>[] = [
    {
      key: 'tenantName',
      header: 'Conta',
      sortable: true,
      cell: (inv) => (
        <Link
          href={`/app/ops/${inv.tenantId}`}
          className="font-medium text-content hover:text-brand-600 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {inv.tenantName}
        </Link>
      ),
    },
    {
      key: 'period',
      header: 'Competência',
      sortable: true,
      cell: (inv) => formatPeriod(inv.period),
    },
    {
      key: 'dueDate',
      header: 'Vencimento',
      sortable: true,
      cell: (inv) => formatDate(inv.dueDate),
    },
    {
      key: 'daysPastDue',
      header: 'Dias em atraso',
      align: 'center',
      sortable: true,
      cell: (inv) =>
        inv.daysPastDue > 0 ? (
          <Badge variant="danger">{inv.daysPastDue}d</Badge>
        ) : (
          <span className="text-content-muted">—</span>
        ),
    },
    {
      key: 'amountCents',
      header: 'Valor',
      align: 'right',
      sortable: true,
      cell: (inv) => <span className="tabular-nums">{formatBRL(inv.amountCents / 100)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      cell: (inv) => (
        <Badge variant={INVOICE_STATUS_VARIANT[inv.status]}>{INVOICE_STATUS_LABEL[inv.status]}</Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (inv) => (
        <Can permission="ops.billing.manage">
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" onClick={() => setPayTarget(inv)}>
              Dar baixa
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setVoidTarget(inv)}>
              Anular
            </Button>
          </div>
        </Can>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Cobrança"
        description="MRR, aging e faturas em aberto da carteira Avecchi."
        actions={
          <Can permission="ops.billing.manage">
            <Button variant="secondary" onClick={handleRunBilling} loading={runBilling.isPending}>
              <PlayCircle size={16} />
              Rodar cobrança agora
            </Button>
          </Can>
        }
      />

      {isLoading || !data ? (
        <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[76px] w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            <Kpi label="MRR" value={formatBRL(data.mrrCents / 100)} />
            <Kpi label="Assinaturas ativas" value={String(data.activeSubscriptions)} />
            <Kpi label="A vencer" value={formatBRL(data.aging.current / 100)} />
            <Kpi label="1–15 dias" value={formatBRL(data.aging.d1_15 / 100)} />
            <Kpi label="16–30 dias" value={formatBRL(data.aging.d16_30 / 100)} />
            <Kpi label="31+ dias" value={formatBRL(data.aging.d31_plus / 100)} tone="danger" />
          </div>

          <Card className="mb-5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">MRR por plano</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {mrrByPlan.length === 0 ? (
                <p className="text-sm text-content-muted">Nenhuma assinatura ativa.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {mrrByPlan.map(([code, cents]) => (
                    <Badge key={code} variant={code === 'LEGADO' ? 'neutral' : 'brand'}>
                      {code}: {formatBRL(cents / 100)}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <DataTable
        data={data?.openInvoices ?? []}
        columns={columns}
        loading={isLoading}
        searchPlaceholder="Buscar por conta..."
        empty={
          <EmptyState
            icon={CreditCard}
            title="Nenhuma fatura em aberto"
            description="Todas as faturas da carteira estão pagas ou anuladas."
          />
        }
      />

      <PayInvoiceDialog
        open={!!payTarget}
        onOpenChange={(v) => !v && setPayTarget(null)}
        loading={payInvoice.isPending}
        onConfirm={(method) => payTarget && payInvoice.mutate({ id: payTarget.id, method })}
      />
      <VoidInvoiceDialog
        open={!!voidTarget}
        onOpenChange={(v) => !v && setVoidTarget(null)}
        loading={voidInvoice.isPending}
        onConfirm={(reason) => voidTarget && voidInvoice.mutate({ id: voidTarget.id, reason })}
      />
    </div>
  );
}
