'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ExternalLink } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useDetail } from '@/hooks/use-resource';
import type { SalesOrder } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { FormDialog } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { erroDeAcao } from '@/lib/feedback';
import { cn } from '@/lib/utils';
import { formatBRL, formatDate } from '@/lib/format';
import {
  SALES_STATUS,
  SALES_PIPELINE,
  salesOrderTotal,
  availableSalesActions,
  type SalesAction,
} from '../sales-status';
import {
  PaymentPlanEditor,
  PAYMENT_METHOD_LABEL,
  isCardMethod,
  validatePlan,
  type DraftPayment,
} from '../payment-plan-editor';
import { VehicleDocsCard } from './vehicle-docs-card';

const RESOURCE = '/sales';

function shortId(id: string) {
  return id.slice(-6).toUpperCase();
}

/** Stepper horizontal do pipeline. Cancelada/Devolvida saem do caminho feliz. */
function Pipeline({ status }: { status: SalesOrder['status'] }) {
  const offPath = status === 'CANCELLED' || status === 'RETURNED';
  const currentIdx = SALES_PIPELINE.findIndex((s) => s.status === status);
  return (
    <div className="flex items-center gap-2">
      {SALES_PIPELINE.map((step, i) => {
        const done = !offPath && currentIdx >= 0 && i < currentIdx;
        const active = !offPath && i === currentIdx;
        return (
          <div key={step.status} className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                  done && 'bg-success text-white',
                  active && 'bg-brand-600 text-white',
                  !done && !active && 'bg-surface-secondary text-content-muted',
                )}
              >
                {done ? <Check size={13} /> : i + 1}
              </span>
              <span className={cn('text-xs', active ? 'font-medium text-content' : 'text-content-muted')}>
                {step.label}
              </span>
            </div>
            {i < SALES_PIPELINE.length - 1 && <div className="h-px w-6 bg-neutral-200 dark:bg-neutral-700" />}
          </div>
        );
      })}
      {offPath && (
        <Badge variant={status === 'CANCELLED' ? 'neutral' : 'warning'} className="ml-2">
          {SALES_STATUS[status].label}
        </Badge>
      )}
    </div>
  );
}

export default function SalesDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const { data: order, isLoading } = useDetail<SalesOrder>(RESOURCE, id);

  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [returnJustif, setReturnJustif] = useState('');

  // #584 — edição do plano de pagamento antes do faturamento
  const [payOpen, setPayOpen] = useState(false);
  const [draftPayments, setDraftPayments] = useState<DraftPayment[]>([]);

  const savePayments = useMutation({
    mutationFn: () =>
      apiClient.patch(`${RESOURCE}/${id}/payments`, {
        payments: draftPayments.map((p) => ({
          method: p.method,
          amount: p.amount,
          installments: p.installments,
          acquirerId: p.acquirerId || undefined,
          brand: p.brand || undefined,
        })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [RESOURCE] });
      setPayOpen(false);
      toast.success('Plano de pagamento atualizado');
    },
    onError: (err: any) => toast.error(erroDeAcao('salvar o plano de pagamento', err)),
  });

  // #596 — gate TEF: cartão precisa autorizar antes de faturar
  const authorizeCards = useMutation({
    mutationFn: async () => (await apiClient.post(`${RESOURCE}/${id}/authorize`)).data,
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: [RESOURCE] });
      if (res?.denied > 0) toast.error(res.message || 'Cartão negado');
      else toast.success('Cartão autorizado');
    },
    onError: (err: any) => toast.error(erroDeAcao('autorizar o cartão', err)),
  });

  const transition = useMutation({
    mutationFn: ({ endpoint, body }: { endpoint: string; body?: any }) =>
      apiClient.patch(`${RESOURCE}/${id}/${endpoint}`, body ?? {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [RESOURCE] });
    },
  });

  const MENSAGEM_SUCESSO_POR_ENDPOINT: Record<string, (codigo: string) => string> = {
    'approve-credit': (codigo) => `Crédito do pedido #${codigo} aprovado`,
    reserve: (codigo) => `Pedido #${codigo} com estoque reservado`,
    confirm: (codigo) => `Pedido #${codigo} confirmado`,
    invoice: (codigo) => `Pedido #${codigo} faturado`,
    cancel: (codigo) => `Pedido #${codigo} cancelado`,
  };
  const ACAO_INFINITIVO_POR_ENDPOINT: Record<string, string> = {
    'approve-credit': 'aprovar o crédito do pedido',
    reserve: 'reservar o estoque do pedido',
    confirm: 'confirmar o pedido',
    invoice: 'faturar o pedido',
    cancel: 'cancelar o pedido',
  };

  function runAction(action: SalesAction) {
    if (action.endpoint === 'return') {
      setReturnOpen(true);
      return;
    }
    const doIt = () =>
      transition.mutate(
        { endpoint: action.endpoint },
        {
          onSuccess: () =>
            toast.success(
              order ? MENSAGEM_SUCESSO_POR_ENDPOINT[action.endpoint]?.(shortId(order.id)) ?? 'Pedido atualizado' : 'Pedido atualizado',
            ),
          onError: (err) =>
            toast.error(erroDeAcao(ACAO_INFINITIVO_POR_ENDPOINT[action.endpoint] ?? 'atualizar o pedido', err)),
        },
      );

    if (action.endpoint === 'cancel') {
      confirm({
        title: 'Cancelar o pedido?',
        description: 'Você não vai conseguir desfazer isso.',
        confirmLabel: 'Cancelar pedido',
        variant: 'danger',
      }).then((ok) => ok && doIt());
    } else {
      doIt();
    }
  }

  // #491: conferência da carga — dupla checagem antes de liberar a NF-e
  const confer = useMutation({
    mutationFn: () =>
      apiClient.post(`${RESOURCE}/${id}/conference`, {
        items: (order?.items ?? []).map((it) => ({
          saleItemId: it.id,
          quantity: Number(it.quantity),
          ...(it.serialNumberId && { serialNumberId: it.serialNumberId }),
        })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [RESOURCE] });
      toast.success('Carga conferida. Pedido liberado para faturamento.');
    },
    onError: (err: any) => toast.error(erroDeAcao('conferir a carga', err)),
  });

  function submitReturn() {
    if (returnReason.trim().length < 3) {
      toast.error('Informe o motivo (mín. 3 caracteres)');
      return;
    }
    transition.mutate(
      {
        endpoint: 'return',
        body: {
          reason: returnReason,
          justificativa: returnJustif.length >= 15 ? returnJustif : undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success('Devolução registrada');
          setReturnOpen(false);
          setReturnReason('');
          setReturnJustif('');
        },
        onError: (err) => toast.error(erroDeAcao('registrar a devolução', err)),
      },
    );
  }

  if (isLoading || !order) {
    return (
      <div>
        <PageHeader title="Pedido de venda" />
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  const total = salesOrderTotal(order);
  const actions = availableSalesActions(order.status);

  return (
    <div>
      <PageHeader
        title={`Pedido #${shortId(order.id)}`}
        description={order.customer?.name ?? 'Sem cliente'}
        actions={
          <Button variant="secondary" onClick={() => router.push('/app/sales')}>
            <ArrowLeft size={16} />
            Voltar
          </Button>
        }
      />

      {/* Cabeçalho + pipeline */}
      <Card className="mb-5">
        <CardContent className="space-y-4 py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-content-muted">Status</p>
                <Badge variant={SALES_STATUS[order.status].variant}>{SALES_STATUS[order.status].label}</Badge>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-content-muted">Criação</p>
                <p className="text-content">{formatDate(order.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-content-muted">Confirmação</p>
                <p className="text-content">{order.confirmedAt ? formatDate(order.confirmedAt) : '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-content-muted">Depósito</p>
                <p className="text-content">{order.warehouse?.name ?? '—'}</p>
              </div>
            </div>
            {actions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {actions.map((a) => (
                  <Button
                    key={a.endpoint}
                    variant={a.variant}
                    onClick={() => runAction(a)}
                    loading={transition.isPending}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
          <div className="border-t border-line pt-4">
            <Pipeline status={order.status} />
          </div>
        </CardContent>
      </Card>

      {/* #491: Conferência da carga */}
      {order.status === 'AWAITING_CONFERENCE' && (
        <Card className="mb-5 border-warning/40">
          <CardHeader>
            <CardTitle className="text-base">Conferência da carga</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pb-5">
            <p className="text-sm text-content-secondary">
              Confira fisicamente os itens separados. Itens com chassi devem bater com o
              reboque que sai do pátio. O chassi vai na NF-e e define o emplacamento.
            </p>
            <ul className="space-y-1.5">
              {(order.items ?? []).map((it) => (
                <li key={it.id} className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm">
                  <span>
                    {Number(it.quantity)}× {it.product?.name ?? it.productId}
                  </span>
                  {it.serialNumber ? (
                    <span className="font-mono text-xs text-content-secondary">
                      chassi {it.serialNumber.chassi ?? it.serialNumber.serial}
                    </span>
                  ) : it.product?.tracksSerial ? (
                    <Badge variant="danger">sem chassi</Badge>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <Button onClick={() => confer.mutate()} loading={confer.isPending}>
                Confirmar carga conferida
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* #533: Documentação veicular (BIN / RENAVE / ATPV-e) */}
      <VehicleDocsCard salesOrderId={order.id} />

      {/* Itens */}
      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="text-base">Itens</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-content-muted">
                  <th className="py-2 text-left font-medium">SKU</th>
                  <th className="py-2 text-left font-medium">Produto</th>
                  <th className="py-2 text-right font-medium">Qtd</th>
                  <th className="py-2 text-right font-medium">Preço unit.</th>
                  <th className="py-2 text-right font-medium">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {(order.items ?? []).map((it) => (
                  <tr key={it.id} className="border-b border-line">
                    <td className="py-2 font-mono text-xs text-content-muted">{it.product?.sku ?? '—'}</td>
                    <td className="py-2 text-content">{it.product?.name ?? '—'}</td>
                    <td className="py-2 text-right tabular-nums">{Number(it.quantity)}</td>
                    <td className="py-2 text-right tabular-nums">{formatBRL(Number(it.unitPrice))}</td>
                    <td className="py-2 text-right font-medium tabular-nums">
                      {formatBRL(Number(it.quantity) * Number(it.unitPrice))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="py-3 text-right text-sm font-medium text-content-secondary">
                    Total geral
                  </td>
                  <td className="py-3 text-right text-base font-semibold tabular-nums text-content">
                    {formatBRL(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* #584 — Plano de pagamento */}
      <Card className="mb-5">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Pagamento</CardTitle>
          <div className="flex gap-2">
            {(order.payments ?? []).some(
              (p) => isCardMethod(p.method) && p.authStatus !== 'AUTHORIZED',
            ) &&
              order.status !== 'INVOICED' &&
              order.status !== 'CANCELLED' &&
              order.status !== 'RETURNED' && (
                <Button size="sm" onClick={() => authorizeCards.mutate()} loading={authorizeCards.isPending}>
                  Autorizar cartão (TEF)
                </Button>
              )}
            {['DRAFT', 'RESERVED', 'CONFIRMED', 'AWAITING_PICKING', 'AWAITING_CONFERENCE', 'READY_TO_INVOICE'].includes(
              order.status,
            ) && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setDraftPayments(
                    (order.payments ?? []).map((p) => ({
                      method: p.method,
                      amount: Number(p.amount),
                      installments: p.installments,
                      acquirerId: p.acquirerId ?? undefined,
                      brand: p.brand ?? undefined,
                    })),
                  );
                  setPayOpen(true);
                }}
              >
                {(order.payments ?? []).length > 0 ? 'Editar plano' : 'Montar plano'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {(order.payments ?? []).length === 0 ? (
            <p className="py-2 text-sm text-content-muted">
              Sem plano de pagamento. A NF-e sai com a forma legada ({order.paymentMethod ?? 'Outros'}) e o
              título nasce no padrão 30 dias.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-content-muted">
                    <th className="py-2 text-left font-medium">Forma</th>
                    <th className="py-2 text-right font-medium">Valor</th>
                    <th className="py-2 text-right font-medium">Parcelas</th>
                    <th className="py-2 text-left font-medium">Adquirente / Bandeira</th>
                    <th className="py-2 text-right font-medium">MDR</th>
                    <th className="py-2 text-right font-medium">Liquidação</th>
                    <th className="py-2 text-left font-medium">TEF</th>
                  </tr>
                </thead>
                <tbody>
                  {(order.payments ?? []).map((p) => (
                    <tr key={p.id} className="border-b border-line last:border-0">
                      <td className="py-2">{PAYMENT_METHOD_LABEL[p.method] ?? p.method}</td>
                      <td className="py-2 text-right font-medium tabular-nums">{formatBRL(Number(p.amount))}</td>
                      <td className="py-2 text-right tabular-nums">{p.installments}x</td>
                      <td className="py-2 text-content-secondary">
                        {p.acquirer?.name ?? '—'}
                        {p.brand ? ` · ${p.brand}` : ''}
                      </td>
                      <td className="py-2 text-right tabular-nums text-content-secondary">
                        {p.mdrRate ? `${Number(p.mdrRate)}% (${formatBRL(Number(p.mdrAmount ?? 0))})` : '—'}
                      </td>
                      <td className="py-2 text-right tabular-nums text-content-secondary">
                        {p.settlementDays != null ? `D+${p.settlementDays}` : '—'}
                      </td>
                      <td className="py-2">
                        {isCardMethod(p.method) ? (
                          <Badge
                            variant={
                              p.authStatus === 'AUTHORIZED'
                                ? 'success'
                                : p.authStatus === 'DENIED'
                                  ? 'danger'
                                  : 'warning'
                            }
                          >
                            {p.authStatus === 'AUTHORIZED'
                              ? `Autorizado${p.nsu ? ` · NSU ${p.nsu}` : ''}`
                              : p.authStatus === 'DENIED'
                                ? 'Negado'
                                : 'Aguardando'}
                          </Badge>
                        ) : (
                          <span className="text-xs text-content-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rodapé */}
      <Card>
        <CardContent className="grid gap-4 py-5 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-content-muted">Observações</p>
            <p className="mt-1 text-sm text-content-secondary">{order.notes || '—'}</p>
          </div>
          {order.status === 'INVOICED' && (
            <div>
              <p className="text-xs uppercase tracking-wide text-content-muted">Conta a receber</p>
              <Link
                href="/app/finance/receivables"
                className="mt-1 inline-flex items-center gap-1 text-sm text-brand-600 dark:text-brand-400 hover:underline"
              >
                <ExternalLink size={14} /> Ver em Contas a receber
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog de devolução */}
      <FormDialog
        open={returnOpen}
        onOpenChange={setReturnOpen}
        title="Devolver venda"
        description="Estorna o estoque e cancela a NF-e na SEFAZ."
        formId="return-form"
        submitLabel="Confirmar devolução"
        loading={transition.isPending}
      >
        <form
          id="return-form"
          onSubmit={(e) => {
            e.preventDefault();
            submitReturn();
          }}
          className="space-y-4 py-1"
        >
          {/* Itens a devolver (devolução total — ver nota) */}
          <div>
            <Label>Itens a devolver</Label>
            <div className="mt-1 overflow-hidden rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-secondary text-xs uppercase tracking-wide text-content-muted">
                    <th className="px-3 py-2 text-left font-medium">Produto</th>
                    <th className="px-3 py-2 text-right font-medium">Qtd a devolver</th>
                  </tr>
                </thead>
                <tbody>
                  {(order.items ?? []).map((it) => (
                    <tr key={it.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 text-content">
                        {it.product?.name ?? '—'}
                        <span className="ml-1 font-mono text-xs text-content-muted">{it.product?.sku}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(it.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-warning">
              A devolução é <strong>total</strong> (todos os itens, quantidade integral). A devolução parcial por item ainda não está disponível.
            </p>
          </div>

          <div>
            <Label required>Motivo da devolução</Label>
            <Input
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              placeholder="Ex.: Produto com defeito"
            />
          </div>
          <div>
            <Label>Justificativa p/ SEFAZ (mín. 15 caracteres)</Label>
            <Input
              value={returnJustif}
              onChange={(e) => setReturnJustif(e.target.value)}
              placeholder="Opcional (usada no cancelamento da NF-e)"
            />
            <p className="mt-1 text-xs text-content-muted">
              Se preenchida, deve ter ao menos 15 caracteres.
            </p>
          </div>
        </form>
      </FormDialog>

      {/* #584 — dialog do plano de pagamento */}
      <FormDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        title="Plano de pagamento"
        description={`A soma das formas deve fechar o total da venda (${formatBRL(total)}). Cartão congela MDR e prazo da adquirente no salvamento.`}
        formId="payments-form"
        submitLabel="Salvar plano"
        loading={savePayments.isPending}
      >
        <form
          id="payments-form"
          onSubmit={(e) => {
            e.preventDefault();
            const error = validatePlan(draftPayments, total);
            if (error) {
              toast.error(error);
              return;
            }
            savePayments.mutate();
          }}
          className="py-1"
        >
          <PaymentPlanEditor payments={draftPayments} onChange={setDraftPayments} total={total} />
        </form>
      </FormDialog>
    </div>
  );
}
