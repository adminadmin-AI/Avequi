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
import { cn } from '@/lib/utils';
import { formatBRL, formatDate } from '@/lib/format';
import {
  SALES_STATUS,
  SALES_PIPELINE,
  salesOrderTotal,
  availableSalesActions,
  type SalesAction,
} from '../sales-status';

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
                  !done && !active && 'bg-slate-100 text-slate-400',
                )}
              >
                {done ? <Check size={13} /> : i + 1}
              </span>
              <span className={cn('text-xs', active ? 'font-medium text-slate-800' : 'text-slate-400')}>
                {step.label}
              </span>
            </div>
            {i < SALES_PIPELINE.length - 1 && <div className="h-px w-6 bg-slate-200" />}
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

  const transition = useMutation({
    mutationFn: ({ endpoint, body }: { endpoint: string; body?: any }) =>
      apiClient.patch(`${RESOURCE}/${id}/${endpoint}`, body ?? {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [RESOURCE] });
    },
  });

  function runAction(action: SalesAction) {
    if (action.endpoint === 'return') {
      setReturnOpen(true);
      return;
    }
    const doIt = () =>
      transition.mutate(
        { endpoint: action.endpoint },
        {
          onSuccess: () => toast.success('Status atualizado'),
          onError: () => toast.error('Não foi possível executar a ação'),
        },
      );

    if (action.endpoint === 'cancel') {
      confirm({
        title: 'Cancelar ordem de venda?',
        description: 'Esta ação não pode ser desfeita.',
        confirmLabel: 'Cancelar OV',
        variant: 'danger',
      }).then((ok) => ok && doIt());
    } else {
      doIt();
    }
  }

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
        onError: () => toast.error('Não foi possível registrar a devolução'),
      },
    );
  }

  if (isLoading || !order) {
    return (
      <div>
        <PageHeader title="Ordem de Venda" />
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
        title={`OV #${shortId(order.id)}`}
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
                <p className="text-xs uppercase tracking-wide text-slate-400">Status</p>
                <Badge variant={SALES_STATUS[order.status].variant}>{SALES_STATUS[order.status].label}</Badge>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Criação</p>
                <p className="text-slate-800">{formatDate(order.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Confirmação</p>
                <p className="text-slate-800">{order.confirmedAt ? formatDate(order.confirmedAt) : '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Depósito</p>
                <p className="text-slate-800">{order.warehouse?.name ?? '—'}</p>
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
          <div className="border-t border-slate-100 pt-4">
            <Pipeline status={order.status} />
          </div>
        </CardContent>
      </Card>

      {/* Itens */}
      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="text-base">Itens</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 text-left font-medium">SKU</th>
                  <th className="py-2 text-left font-medium">Produto</th>
                  <th className="py-2 text-right font-medium">Qtd</th>
                  <th className="py-2 text-right font-medium">Preço unit.</th>
                  <th className="py-2 text-right font-medium">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {(order.items ?? []).map((it) => (
                  <tr key={it.id} className="border-b border-slate-50">
                    <td className="py-2 font-mono text-xs text-slate-500">{it.product?.sku ?? '—'}</td>
                    <td className="py-2 text-slate-800">{it.product?.name ?? '—'}</td>
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
                  <td colSpan={4} className="py-3 text-right text-sm font-medium text-slate-600">
                    Total geral
                  </td>
                  <td className="py-3 text-right text-base font-semibold tabular-nums text-slate-900">
                    {formatBRL(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Rodapé */}
      <Card>
        <CardContent className="grid gap-4 py-5 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Observações</p>
            <p className="mt-1 text-sm text-slate-700">{order.notes || '—'}</p>
          </div>
          {order.status === 'INVOICED' && (
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Conta a receber</p>
              <Link
                href="/app/finance/receivables"
                className="mt-1 inline-flex items-center gap-1 text-sm text-brand-600 hover:underline"
              >
                <ExternalLink size={14} /> Ver em Recebíveis
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
              placeholder="Opcional — usada no cancelamento da NF-e"
            />
            <p className="mt-1 text-xs text-slate-400">
              Se preenchida, deve ter ao menos 15 caracteres.
            </p>
          </div>
        </form>
      </FormDialog>
    </div>
  );
}
