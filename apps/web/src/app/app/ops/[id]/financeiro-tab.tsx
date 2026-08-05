'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FileText, Plus } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { ehNegativaDeAcesso, mensagemDoErro } from '@/lib/api-error';
import { formatBRL, formatDate } from '@/lib/format';
import type {
  CreateProposalInput,
  Invoice,
  InvoiceMethod,
  Plan,
  PlansCatalog,
  Subscription,
  SubscriptionProposal,
  TenantBilling,
  UpsertSubscriptionInput,
} from '@/types/api';
import { Alert } from '@/components/ui/alert';
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
import { Textarea } from '@/components/ui/textarea';
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
import {
  PROPOSAL_STATUS_LABEL,
  PROPOSAL_STATUS_VARIANT,
  acoesDaProposta,
  ehNegociado,
  statusExibido,
  validadeParaISO,
} from './proposal-shared';

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

  // #992 — abre o contrato em PDF numa aba nova (gerado on-demand na API).
  const contractPdf = useMutation({
    mutationFn: async () => {
      const res = await apiClient.get(`${RESOURCE}/${tenantId}/contract`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      window.open(url, '_blank', 'noopener');
      // revoga depois que a aba nova já carregou o blob
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    onError: (err) => toast.error(mensagemDoErro(err) ?? 'Não foi possível gerar o contrato'),
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

            <div className="flex flex-wrap gap-2 pt-1">
              <Can permission="ops.billing.manage">
                <Button variant="secondary" size="sm" onClick={openDialog}>
                  Editar
                </Button>
                {!subscription.canceledAt && (
                  <Button variant="danger" size="sm" onClick={handleCancel} loading={cancel.isPending}>
                    Cancelar
                  </Button>
                )}
              </Can>
              {/* #992 — contrato em PDF dos dados vivos; só faz sentido com
                  assinatura ativa (o backend devolve 400 sem ela). */}
              {!subscription.canceledAt && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={contractPdf.isPending}
                  onClick={() => contractPdf.mutate()}
                >
                  <FileText size={15} />
                  Gerar contrato (PDF)
                </Button>
              )}
            </div>
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

// ─── Propostas comerciais (#963) ─────────────────────────────────────────────

/** Rótulo do plano no select — o preço de TABELA fica visível na escolha. */
function labelDoPlano(p: Plan) {
  const preco = p.priceCents != null ? formatBRL(p.priceCents / 100) : 'sem preço de tabela';
  return `${p.name} (${p.code}) · ${preco}`;
}

function NovaPropostaDialog({
  open,
  onOpenChange,
  plans,
  loading,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Planos ATIVOS do catálogo. */
  plans: Plan[];
  loading: boolean;
  onSubmit: (input: CreateProposalInput) => void;
}) {
  const [planId, setPlanId] = useState('');
  const [priceCents, setPriceCents] = useState<number | undefined>(undefined);
  const [billingDay, setBillingDay] = useState(5);
  const [conditions, setConditions] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [touched, setTouched] = useState(false);

  const tabela = plans.find((p) => p.id === planId)?.priceCents ?? null;

  /** Escolher o plano PUXA o preço de tabela — negociar é editar, não digitar do zero. */
  function pickPlan(id: string) {
    setPlanId(id);
    setPriceCents(plans.find((p) => p.id === id)?.priceCents ?? undefined);
  }

  const planInvalid = !planId;
  const priceInvalid = priceCents == null || priceCents <= 0;
  const dayInvalid = !Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (planInvalid || priceInvalid || dayInvalid) return;
    onSubmit({
      planId,
      // Contrato do endpoint: priceCents AUSENTE = preço de tabela do plano.
      // Só mandamos o valor quando ele é de fato o desvio — assim a trilha de
      // auditoria distingue "fechou na tabela" de "negociou".
      priceCents: priceCents === tabela ? undefined : priceCents,
      billingDay,
      conditions: conditions.trim() || undefined,
      validUntil: validadeParaISO(validUntil),
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nova proposta"
      description="O valor nasce do preço de tabela do plano — edite só o que for negociado."
      formId="proposal-form"
      submitLabel="Criar proposta"
      size="lg"
      loading={loading}
    >
      <form id="proposal-form" onSubmit={handleSubmit} className="space-y-4 py-1">
        <Field
          label="Plano"
          required
          error={touched && planInvalid ? 'Escolha o plano da proposta.' : undefined}
        >
          <Select
            value={planId}
            error={touched && planInvalid}
            onChange={(e) => pickPlan(e.target.value)}
          >
            <option value="">— Selecione —</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {labelDoPlano(p)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Valor mensal da proposta"
          required
          error={touched && priceInvalid ? 'Informe um valor válido.' : undefined}
        >
          {/* `key` pelo plano: o campo de moeda é não-controlado (defaultValue),
              então trocar de plano precisa remontá-lo para exibir a tabela. */}
          <MaskedInput
            key={planId || 'sem-plano'}
            mask="currency"
            defaultValue={priceCents != null ? String(priceCents) : ''}
            placeholder="R$ 0,00"
            error={touched && priceInvalid}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '');
              setPriceCents(digits ? Number(digits) : undefined);
            }}
          />
          {planId && (
            <p className="mt-1 text-xs text-content-muted">
              {tabela != null
                ? `Preço de tabela: ${formatBRL(tabela / 100)}`
                : 'Este plano não tem preço de tabela — informe o valor negociado.'}
            </p>
          )}
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

        <Field label="Condições comerciais">
          <Textarea
            value={conditions}
            maxLength={2000}
            rows={3}
            placeholder="Prazo de implantação, descontos, carência — o que foi combinado."
            onChange={(e) => setConditions(e.target.value)}
          />
        </Field>

        <Field label="Válida até">
          <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          <p className="mt-1 text-xs text-content-muted">
            Opcional. Depois desta data a proposta não pode mais ser aceita.
          </p>
        </Field>
      </form>
    </FormDialog>
  );
}

function AceitarPropostaDialog({
  proposal,
  onOpenChange,
  loading,
  onConfirm,
}: {
  proposal: SubscriptionProposal | null;
  onOpenChange: (v: boolean) => void;
  loading: boolean;
  onConfirm: (decidedNote?: string) => void;
}) {
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  // Nota é opcional, mas o backend exige mín. 5 caracteres quando enviada.
  const noteInvalid = note.trim().length > 0 && note.trim().length < 5;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (noteInvalid) return;
    onConfirm(note.trim() || undefined);
  }

  return (
    <FormDialog
      open={!!proposal}
      onOpenChange={onOpenChange}
      title="Aceitar proposta"
      formId="accept-proposal-form"
      submitLabel="Aceitar proposta"
      loading={loading}
    >
      <form id="accept-proposal-form" onSubmit={handleSubmit} className="space-y-4 py-1">
        <Alert
          variant="warning"
          title="O aceite cria/atualiza a assinatura e o plano da conta"
          description={
            proposal
              ? `Assinatura de ${formatBRL(proposal.priceCents / 100)}/mês com vencimento no dia ${proposal.billingDay}, e o plano ${proposal.plan?.name ?? 'da proposta'} passa a valer para a conta (efeito em até 60s). Proposta aceita é imutável.`
              : undefined
          }
        />
        <Field
          label="Observação da decisão"
          error={touched && noteInvalid ? 'Mínimo de 5 caracteres (ou deixe em branco).' : undefined}
        >
          <Textarea
            value={note}
            maxLength={500}
            rows={3}
            placeholder="Opcional — quem aprovou, referência do contrato."
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </form>
    </FormDialog>
  );
}

function RecusarPropostaDialog({
  proposal,
  onOpenChange,
  loading,
  onConfirm,
}: {
  proposal: SubscriptionProposal | null;
  onOpenChange: (v: boolean) => void;
  loading: boolean;
  onConfirm: (decidedNote: string) => void;
}) {
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const noteInvalid = note.trim().length < 5;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (noteInvalid) return;
    onConfirm(note.trim());
  }

  return (
    <FormDialog
      open={!!proposal}
      onOpenChange={onOpenChange}
      title="Recusar proposta"
      description="A recusa é definitiva — uma nova negociação exige uma proposta nova."
      formId="decline-proposal-form"
      submitLabel="Recusar proposta"
      loading={loading}
    >
      <form id="decline-proposal-form" onSubmit={handleSubmit} className="space-y-4 py-1">
        <Field
          label="Motivo da recusa"
          required
          error={touched && noteInvalid ? 'Informe o motivo (mín. 5 caracteres).' : undefined}
        >
          <Textarea
            value={note}
            maxLength={500}
            rows={3}
            placeholder="Ex.: cliente optou por concorrente / valor acima do orçamento."
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </form>
    </FormDialog>
  );
}

function ProposalsCard({ tenantId }: { tenantId: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = usePermission();
  // Criar proposta exige escolher um plano — sem ops.plans.view não há
  // catálogo para escolher, então o botão não é oferecido (igual ao vínculo
  // de plano da assinatura, que some sem a permissão).
  const canPickPlan = can('ops.plans.view');
  const canManage = can('ops.billing.manage');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogNonce, setDialogNonce] = useState(0);
  const [acceptTarget, setAcceptTarget] = useState<SubscriptionProposal | null>(null);
  const [declineTarget, setDeclineTarget] = useState<SubscriptionProposal | null>(null);

  const proposalsQuery = useQuery<SubscriptionProposal[]>({
    queryKey: [RESOURCE, tenantId, 'proposals'],
    queryFn: async () =>
      (await apiClient.get<SubscriptionProposal[]>(`${RESOURCE}/${tenantId}/proposals`)).data,
  });

  const plansQuery = useQuery<PlansCatalog>({
    queryKey: ['/ops/plans'],
    queryFn: async () => (await apiClient.get<PlansCatalog>('/ops/plans')).data,
    enabled: dialogOpen && canPickPlan,
    retry: false,
  });

  const invalidateProposals = () =>
    qc.invalidateQueries({ queryKey: [RESOURCE, tenantId, 'proposals'] });

  /**
   * Aceite mexe em assinatura E plano/entitlements do tenant — a chave de
   * prefixo derruba tudo o que é desta conta (billing, entitlements, saúde),
   * para o efeito aparecer na hora sem recarregar a página.
   */
  const invalidateConta = () => qc.invalidateQueries({ queryKey: [RESOURCE, tenantId] });

  function openDialog() {
    setDialogNonce((n) => n + 1);
    setDialogOpen(true);
  }

  const create = useMutation({
    mutationFn: (input: CreateProposalInput) =>
      apiClient.post(`${RESOURCE}/${tenantId}/proposals`, input),
    onSuccess: () => {
      toast.success('Proposta criada');
      invalidateProposals();
      setDialogOpen(false);
    },
    onError: (err) => toast.error(mensagemDoErro(err) ?? 'Não foi possível criar a proposta'),
  });

  const send = useMutation({
    mutationFn: (id: string) => apiClient.post(`/ops/proposals/${id}/send`),
    onSuccess: () => {
      toast.success('Proposta marcada como enviada');
      invalidateProposals();
    },
    onError: (err) => toast.error(mensagemDoErro(err) ?? 'Não foi possível enviar a proposta'),
  });

  const accept = useMutation({
    mutationFn: ({ id, decidedNote }: { id: string; decidedNote?: string }) =>
      apiClient.post(`/ops/proposals/${id}/accept`, { decidedNote }),
    onSuccess: () => {
      toast.success('Proposta aceita — assinatura e plano atualizados');
      invalidateConta();
      setAcceptTarget(null);
    },
    onError: (err) => toast.error(mensagemDoErro(err) ?? 'Não foi possível aceitar a proposta'),
  });

  const decline = useMutation({
    mutationFn: ({ id, decidedNote }: { id: string; decidedNote: string }) =>
      apiClient.post(`/ops/proposals/${id}/decline`, { decidedNote }),
    onSuccess: () => {
      toast.success('Proposta recusada');
      invalidateProposals();
      setDeclineTarget(null);
    },
    onError: (err) => toast.error(mensagemDoErro(err) ?? 'Não foi possível recusar a proposta'),
  });

  const proposals = proposalsQuery.data ?? [];
  const planosAtivos = (plansQuery.data?.plans ?? []).filter((p) => p.active);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Propostas</CardTitle>
        {canManage && canPickPlan && (
          <Button size="sm" onClick={openDialog}>
            <Plus size={15} />
            Nova proposta
          </Button>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {proposalsQuery.isError ? (
          <InlineError
            message={
              ehNegativaDeAcesso(proposalsQuery.error)
                ? (mensagemDoErro(proposalsQuery.error) ??
                  'Você não tem permissão para ver as propostas desta conta.')
                : 'Não foi possível carregar as propostas desta conta.'
            }
          />
        ) : proposalsQuery.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : proposals.length === 0 ? (
          <EmptyState
            compact
            title="Nenhuma proposta ainda"
            description="A proposta nasce do preço de tabela do plano; ao ser aceita vira a assinatura da conta."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-content-muted">
                  <th className="py-2 pr-4 font-medium">Plano</th>
                  <th className="py-2 pr-4 font-medium">Valor</th>
                  <th className="py-2 pr-4 font-medium">Vencimento</th>
                  <th className="py-2 pr-4 font-medium">Válida até</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Condições / decisão</th>
                  <th className="py-2 pr-4 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {proposals.map((p) => {
                  const status = statusExibido(p);
                  const { podeEnviar, podeDecidir } = acoesDaProposta(p);
                  return (
                    <tr key={p.id}>
                      <td className="py-2.5 pr-4">
                        <span className="font-medium text-content">{p.plan?.name ?? '—'}</span>
                        {p.plan?.code && (
                          <span className="ml-1.5 text-xs text-content-muted">{p.plan.code}</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className="tabular-nums">{formatBRL(p.priceCents / 100)}</span>
                        {ehNegociado(p) && (
                          <Badge variant="info" className="ml-1.5">
                            negociado
                          </Badge>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums">dia {p.billingDay}</td>
                      <td className="py-2.5 pr-4">
                        {p.validUntil ? formatDate(p.validUntil) : '—'}
                      </td>
                      <td className="py-2.5 pr-4">
                        <Badge variant={PROPOSAL_STATUS_VARIANT[status]}>
                          {PROPOSAL_STATUS_LABEL[status]}
                        </Badge>
                      </td>
                      <td className="max-w-xs py-2.5 pr-4 text-content-secondary">
                        {p.decidedNote ?? p.conditions ?? '—'}
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        {canManage && (podeEnviar || podeDecidir) && (
                          <div className="flex justify-end gap-1">
                            {podeEnviar && (
                              <Button
                                variant="ghost"
                                size="sm"
                                loading={send.isPending && send.variables === p.id}
                                onClick={() => send.mutate(p.id)}
                              >
                                Enviar
                              </Button>
                            )}
                            {podeDecidir && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setAcceptTarget(p)}
                                >
                                  Aceitar
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setDeclineTarget(p)}
                                >
                                  Recusar
                                </Button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {canManage && canPickPlan && (
        <NovaPropostaDialog
          key={dialogNonce}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          plans={planosAtivos}
          loading={create.isPending}
          onSubmit={(input) => create.mutate(input)}
        />
      )}
      {canManage && (
        <>
          <AceitarPropostaDialog
            key={`accept-${acceptTarget?.id ?? 'none'}`}
            proposal={acceptTarget}
            onOpenChange={(v) => !v && setAcceptTarget(null)}
            loading={accept.isPending}
            onConfirm={(decidedNote) =>
              acceptTarget && accept.mutate({ id: acceptTarget.id, decidedNote })
            }
          />
          <RecusarPropostaDialog
            key={`decline-${declineTarget?.id ?? 'none'}`}
            proposal={declineTarget}
            onOpenChange={(v) => !v && setDeclineTarget(null)}
            loading={decline.isPending}
            onConfirm={(decidedNote) =>
              declineTarget && decline.mutate({ id: declineTarget.id, decidedNote })
            }
          />
        </>
      )}
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
      <ProposalsCard tenantId={tenantId} />
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
