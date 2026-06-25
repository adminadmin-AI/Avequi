'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ExternalLink, PackageCheck } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useDetail } from '@/hooks/use-resource';
import type { PurchaseOrder, PurchaseOrderStatus } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { formatBRL, formatDate } from '@/lib/format';
import { PO_STATUS, purchaseOrderTotal, availablePOActions } from '../purchase-status';

const RESOURCE = '/purchases/orders';

const PIPELINE: { status: PurchaseOrderStatus; label: string }[] = [
  { status: 'DRAFT', label: 'Rascunho' },
  { status: 'APPROVED', label: 'Aprovada' },
  { status: 'PARTIALLY_RECEIVED', label: 'Recebida parcial' },
  { status: 'RECEIVED', label: 'Recebida' },
];

function shortId(id: string) {
  return id.slice(-6).toUpperCase();
}

function Pipeline({ status }: { status: PurchaseOrderStatus }) {
  const cancelled = status === 'CANCELLED';
  const currentIdx = PIPELINE.findIndex((s) => s.status === status);
  return (
    <div className="flex items-center gap-2">
      {PIPELINE.map((step, i) => {
        const done = !cancelled && currentIdx >= 0 && i < currentIdx;
        const active = !cancelled && i === currentIdx;
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
            {i < PIPELINE.length - 1 && <div className="h-px w-6 bg-slate-200" />}
          </div>
        );
      })}
      {cancelled && (
        <Badge variant="neutral" className="ml-2">
          Cancelada
        </Badge>
      )}
    </div>
  );
}

export default function PurchaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const { data: po, isLoading } = useDetail<PurchaseOrder>(RESOURCE, id);

  const transition = useMutation({
    mutationFn: (endpoint: string) => apiClient.post(`${RESOURCE}/${id}/${endpoint}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: [RESOURCE] }),
  });

  function runAction(endpoint: 'approve' | 'cancel') {
    const doIt = () =>
      transition.mutate(endpoint, {
        onSuccess: () => toast.success('Status atualizado'),
        onError: () => toast.error('Não foi possível executar a ação'),
      });
    if (endpoint === 'cancel') {
      confirm({
        title: 'Cancelar pedido de compra?',
        description: 'Esta ação não pode ser desfeita.',
        confirmLabel: 'Cancelar PO',
        variant: 'danger',
      }).then((ok) => ok && doIt());
    } else {
      doIt();
    }
  }

  if (isLoading || !po) {
    return (
      <div>
        <PageHeader title="Pedido de Compra" />
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  const total = purchaseOrderTotal(po);
  const actions = availablePOActions(po.status);
  const canReceive = po.status === 'APPROVED' || po.status === 'PARTIALLY_RECEIVED';

  return (
    <div>
      <PageHeader
        title={`PO #${shortId(po.id)}`}
        description={po.supplier?.name ?? 'Sem fornecedor'}
        actions={
          <Button variant="secondary" onClick={() => router.push('/app/purchases')}>
            <ArrowLeft size={16} />
            Voltar
          </Button>
        }
      />

      <Card className="mb-5">
        <CardContent className="space-y-4 py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Status</p>
                <Badge variant={PO_STATUS[po.status].variant}>{PO_STATUS[po.status].label}</Badge>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Criação</p>
                <p className="text-slate-800">{formatDate(po.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Prevista</p>
                <p className="text-slate-800">{po.expectedAt ? formatDate(po.expectedAt) : '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Aprovação</p>
                <p className="text-slate-800">{po.approvedAt ? formatDate(po.approvedAt) : '—'}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {canReceive && (
                <Button onClick={() => router.push(`/app/purchases/${po.id}/receive`)}>
                  <PackageCheck size={16} />
                  Registrar recebimento
                </Button>
              )}
              {actions.map((a) => (
                <Button
                  key={a.endpoint}
                  variant={a.variant}
                  onClick={() => runAction(a.endpoint)}
                  loading={transition.isPending}
                >
                  {a.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="border-t border-slate-100 pt-4">
            <Pipeline status={po.status} />
          </div>
        </CardContent>
      </Card>

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
                  <th className="py-2 text-right font-medium">Recebido</th>
                  <th className="py-2 text-right font-medium">Custo unit.</th>
                  <th className="py-2 text-right font-medium">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {(po.items ?? []).map((it) => {
                  const received = Number(it.receivedQuantity ?? 0);
                  const qty = Number(it.quantity);
                  return (
                    <tr key={it.id} className="border-b border-slate-50">
                      <td className="py-2 font-mono text-xs text-slate-500">{it.product?.sku ?? '—'}</td>
                      <td className="py-2 text-slate-800">{it.product?.name ?? '—'}</td>
                      <td className="py-2 text-right tabular-nums">{qty}</td>
                      <td className="py-2 text-right tabular-nums">
                        <span className={cn(received >= qty ? 'text-success' : received > 0 ? 'text-warning' : 'text-slate-400')}>
                          {received}
                        </span>
                      </td>
                      <td className="py-2 text-right tabular-nums">{formatBRL(Number(it.unitCost))}</td>
                      <td className="py-2 text-right font-medium tabular-nums">
                        {formatBRL(qty * Number(it.unitCost))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} className="py-3 text-right text-sm font-medium text-slate-600">
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

      <Card>
        <CardContent className="grid gap-4 py-5 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Observações</p>
            <p className="mt-1 text-sm text-slate-700">{po.notes || '—'}</p>
          </div>
          {(po.status === 'RECEIVED' || po.status === 'PARTIALLY_RECEIVED') && (
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Conta a pagar</p>
              <Link
                href="/app/finance/payables"
                className="mt-1 inline-flex items-center gap-1 text-sm text-brand-600 hover:underline"
              >
                <ExternalLink size={14} /> Ver em Pagáveis
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
