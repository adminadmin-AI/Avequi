'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { ehNegativaDeAcesso, mensagemDoErro } from '@/lib/api-error';
import { formatBRL, formatDate } from '@/lib/format';
import type {
  Invoice,
  InvoiceMethod,
  Plan,
  PlansCatalog,
  Subscription,
  TenantBilling,
  UpsertSubscriptionInput,
} from '@/types/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { FormDialog } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { MaskedInput } from '@/components/ui/masked-input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Can } from '@/components/can';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { usePermission } from '@/hooks/use-permission';
import { useToast } from '@/components/ui/toast';
import {
  INVOICE_METHOD_LABEL,
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_VARIANT,
  PayInvoiceDialog,
  VoidInvoiceDialog,
  formatPeriod,
} from '../billing/billing-shared';

const RESOURCE = '/ops/tenants';

function InlineError({ message }: { message: string }) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-content-muted">
      <AlertTriangle size={14} />
      {message}
    </p>
  );
}

// ─── Form de assinatura (criar/editar) ──────────────────────────────────────
function SubscriptionDialog({
  open,
  onOpenChange,
  subscription,
  plans,
  canPickPlan,
  loading,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  subscription: Subscription | null;
  /** Planos ativos disponíveis — só quando `canPickPlan`. */
  plans: Plan[];
  /** Usuário tem ops.plans.view — sem isso, o vínculo de plano não é editável aqui. */
  canPickPlan: boolean;
  loading: boolean;
  onSubmit: (input: UpsertSubscriptionInput) => void;
}) {
  const [priceCents, setPriceCents] = useState<number | undefined>(subscription?.priceCents);
  const [billingDay, setBillingDay] = useState<number>(subscription?.billingDay ?? 10);
  const [startedAt, setStartedAt] = useState(
    subscription?.startedAt ? subscription.startedAt.slice(0, 10) : '',
  );
  // Preserva o vínculo de plano atual mesmo quando o campo não é exibido
  // (sem ops.plans.view) — omitir do payload zeraria o planId no backend.
  const [planId, setPlanId] = useState<string | null>(subscription?.planId ?? null);
  const [touched, setTouched] = useState(false);

  const priceInvalid = priceCents == null || priceCents < 0;
  const dayInvalid = !Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (priceInvalid || dayInvalid) return;
    onSubmit({
      planId,
      priceCents: priceCents as number,
      billingDay,
      startedAt: startedAt ? new Date(startedAt).toISOString() : undefined,
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={subscription ? 'Editar assinatura' : 'Criar assinatura'}
      description={
        subscription?.canceledAt
          ? 'Esta assinatura está cancelada — salvar reativa a cobrança.'
          : undefined
      }
      formId="subscription-form"
      loading={loading}
    >
      <form id="subscription-form" onSubmit={handleSubmit} className="space-y-4 py-1">
        <Field
          label="Valor mensal negociado"
          required
          error={touched && priceInvalid ? 'Informe um valor válido.' : undefined}
        >
          <MaskedInput
            mask="currency"
            defaultValue={priceCents != null ? String(priceCents) : ''}
            placeholder="R$ 0,00"
            error={touched && priceInvalid}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '');
              setPriceCents(digits ? Number(digits) : undefined);
            }}
          />
        </Field>

        <Field
          label="Dia do vencimento"
          required
          error={touched && dayInvalid ? 'Informe um dia entre 1 e 28.' : undefined}
        >
          <Input
            type="number"
            min={1}
            max={28}
            step={1}
            value={billingDay}
            error={touched && dayInvalid}
            onChange={(e) => setBillingDay(Math.trunc(Number(e.target.value) || 0))}
          />
        </Field>

        <Field label="Início da vigência">
          <Input type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
        </Field>

        {canPickPlan && (
          <Field label="Plano de referência comercial">
            <Select value={planId ?? ''} onChange={(e) => setPlanId(e.target.value || null)}>
              <option value="">— Sem plano —</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </Select>
          </Field>
        )}
      </form>
    </FormDialog>
  );
}

// ─── Card da assinatura ──────────────────────────────────────────────────────
function SubscriptionCard({
  tenantId,
  subscription,
}: {
  tenantId: string;
  subscription: Subscription | null;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { can } = usePermission();
  const canPickPlan = can('ops.plans.view');
  const [dialogOpen, setDialogOpen] = useState(false);
  // Incrementa a cada abertura — vira `key` do dialog para forçar remount e
  // reler os valores atuais da assinatura (o form usa `defaultValue`
  // não-controlado no campo de moeda, igual ao PlanForm; sem isso, "editar →
  // cancelar sem salvar → reabrir" deixaria a edição anterior pendurada).
  const [dialogNonce, setDialogNonce] = useState(0);

  function openDialog() {
    setDialogNonce((n) => n + 1);
    setDialogOpen(true);
  }

  // GET /ops/plans só é chamado se o usuário tiver a permissão — sem ela, o
  // vínculo de plano não fica editável neste form (spec do WP5): o input
  // livre é OMITIDO, não substituído, para não confundir com o code do plano.
  const plansQuery = useQuery<PlansCatalog>({
    queryKey: ['/ops/plans'],
    queryFn: async () => (await apiClient.get<PlansCatalog>('/ops/plans')).data,
    enabled: dialogOpen && canPickPlan,
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: [RESOURCE, tenantId, 'billing'] });

  const upsert = useMutation({
    mutationFn: (input: UpsertSubscriptionInput) =>
      apiClient.put(`${RESOURCE}/${tenantId}/subscription`, input),
    onSuccess: () => {
      toast.success('Assinatura salva');
      invalidate();
      setDialogOpen(false);
    },
    onError: (err) => toast.error(mensagemDoErro(err) ?? 'Não foi possível salvar a assinatura'),
  });

  const cancel = useMutation({
    mutationFn: () => apiClient.post(`${RESOURCE}/${tenantId}/subscription/cancel`),
    onSuccess: () => {
      toast.success('Assinatura cancelada');
      invalidate();
    },
    onError: (err) => toast.error(mensagemDoErro(err) ?? 'Não foi possível cancelar a assinatura'),
  });

  async function handleCancel() {
    const ok = await confirm({
      title: 'Cancelar assinatura?',
      description:
        'Para a geração de novas faturas a partir da próxima competência. Faturas já criadas continuam cobráveis normalmente.',
      confirmLabel: 'Cancelar assinatura',
      variant: 'danger',
    });
    if (ok) cancel.mutate();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Assinatura</CardTitle>
        {subscription?.canceledAt && <Badge variant="neutral">Cancelada</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        {!subscription ? (
          <>
            <EmptyState
              compact
              title="Sem assinatura cadastrada"
              description="Esta conta ainda não tem uma assinatura de cobrança."
            />
            <Can permission="ops.billing.manage">
              <div className="flex justify-center">
                <Button size="sm" onClick={openDialog}>
                  <Plus size={15} />
                  Criar assinatura
                </Button>
              </div>
            </Can>
          </>
        ) : (
          <>
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <Row label="Valor mensal" value={formatBRL(subscription.priceCents / 100)} />
              <Row label="Dia do vencimento" value={String(subscription.billingDay)} />
              <Row
                label="Vigência"
                value={
                  subscription.canceledAt
                    ? `${formatDate(subscription.startedAt)} até ${formatDate(subscription.canceledAt)}`
                    : `desde ${formatDate(subscription.startedAt)}`
                }
              />
            </div>

            <Can permission="ops.billing.manage">
              <div className="flex gap-2 pt-1">
                <Button variant="secondary" size="sm" onClick={openDialog}>
                  Editar
                </Button>
                {!subscription.canceledAt && (
                  <Button variant="danger" size="sm" onClick={handleCancel} loading={cancel.isPending}>
                    Cancelar
                  </Button>
                )}
              </div>
            </Can>
          </>
        )}
      </CardContent>

      <Can permission="ops.billing.manage">
        <SubscriptionDialog
          key={dialogNonce}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          subscription={subscription}
          plans={(plansQuery.data?.plans ?? []).filter((p) => p.active)}
          canPickPlan={canPickPlan}
          loading={upsert.isPending}
          onSubmit={(input) => upsert.mutate(input)}
        />
      </Can>
    </Card>
  );
}

// ─── Tabela de faturas do tenant ─────────────────────────────────────────────
function InvoicesCard({ tenantId, invoices }: { tenantId: string; invoices: Invoice[] }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [payTarget, setPayTarget] = useState<Invoice | null>(null);
  const [voidTarget, setVoidTarget] = useState<Invoice | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [RESOURCE, tenantId, 'billing'] });
    qc.invalidateQueries({ queryKey: ['/ops/billing'] });
  };

  const payInvoice = useMutation({
    mutationFn: ({ id, method }: { id: string; method: InvoiceMethod }) =>
      apiClient.post(`/ops/billing/invoices/${id}/pay`, { method }),
    onSuccess: () => {
      toast.success('Baixa registrada');
      invalidate();
      setPayTarget(null);
    },
    onError: (err) => toast.error(mensagemDoErro(err) ?? 'Não foi possível dar baixa na fatura'),
  });

  const voidInvoice = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.post(`/ops/billing/invoices/${id}/void`, { reason }),
    onSuccess: () => {
      toast.success('Fatura anulada');
      invalidate();
      setVoidTarget(null);
    },
    onError: (err) => toast.error(mensagemDoErro(err) ?? 'Não foi possível anular a fatura'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Faturas</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {invoices.length === 0 ? (
          <EmptyState compact title="Nenhuma fatura ainda" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-content-muted">
                  <th className="py-2 pr-4 font-medium">Competência</th>
                  <th className="py-2 pr-4 font-medium">Valor</th>
                  <th className="py-2 pr-4 font-medium">Vencimento</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Pago em / método</th>
                  <th className="py-2 pr-4 font-medium">Motivo da anulação</th>
                  <th className="py-2 pr-4 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="py-2.5 pr-4">{formatPeriod(inv.period)}</td>
                    <td className="py-2.5 pr-4 tabular-nums">{formatBRL(inv.amountCents / 100)}</td>
                    <td className="py-2.5 pr-4">{formatDate(inv.dueDate)}</td>
                    <td className="py-2.5 pr-4">
                      <Badge variant={INVOICE_STATUS_VARIANT[inv.status]}>
                        {INVOICE_STATUS_LABEL[inv.status]}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-content-secondary">
                      {inv.paidAt ? `${formatDate(inv.paidAt)} · ${INVOICE_METHOD_LABEL[inv.method ?? 'OUTRO']}` : '—'}
                    </td>
                    <td className="py-2.5 pr-4 text-content-secondary">{inv.voidReason ?? '—'}</td>
                    <td className="py-2.5 pr-4 text-right">
                      {(inv.status === 'OPEN' || inv.status === 'OVERDUE') && (
                        <Can permission="ops.billing.manage">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="sm" onClick={() => setPayTarget(inv)}>
                              Dar baixa
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setVoidTarget(inv)}>
                              Anular
                            </Button>
                          </div>
                        </Can>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

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
    </Card>
  );
}

// ─── Aba "Financeiro" ────────────────────────────────────────────────────────
export function FinanceiroTab({ tenantId }: { tenantId: string }) {
  const billingQuery = useQuery<TenantBilling>({
    queryKey: [RESOURCE, tenantId, 'billing'],
    queryFn: async () => (await apiClient.get<TenantBilling>(`${RESOURCE}/${tenantId}/billing`)).data,
  });

  if (billingQuery.isError) {
    const negado = ehNegativaDeAcesso(billingQuery.error);
    return (
      <InlineError
        message={
          negado
            ? (mensagemDoErro(billingQuery.error) ?? 'Você não tem permissão para ver o billing desta conta.')
            : 'Não foi possível carregar o billing desta conta.'
        }
      />
    );
  }

  if (billingQuery.isLoading || !billingQuery.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  const { subscription, invoices } = billingQuery.data;

  return (
    <div className="space-y-5">
      <SubscriptionCard tenantId={tenantId} subscription={subscription} />
      <InvoicesCard tenantId={tenantId} invoices={invoices} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-content-muted">{label}</p>
      <p className="font-medium text-content">{value}</p>
    </div>
  );
}
