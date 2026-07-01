'use client';

import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useDetail, useList } from '@/hooks/use-resource';
import type { ProductionOrder, ProductionOrderStatus, StockBalance } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { formatNumber, formatDate } from '@/lib/format';
import {
  PRODUCTION_STATUS,
  PRODUCTION_PIPELINE,
  availableProductionActions,
  type ProductionAction,
} from '../production-status';

const RESOURCE = '/production';

// O findOne inclui os componentes em `items` (com plannedQty/consumedQty).
interface OrderItem {
  id: string;
  component?: { id: string; sku: string; name: string } | null;
  plannedQty: string;
  consumedQty: string;
}
type OrderWithItems = ProductionOrder & { items?: OrderItem[] };

function shortId(id: string) {
  return id.slice(-6).toUpperCase();
}

function Pipeline({ status }: { status: ProductionOrderStatus }) {
  const offPath = status === 'CANCELLED';
  const currentIdx = PRODUCTION_PIPELINE.findIndex((s) => s.status === status);
  // PENDING_INSPECTION fica entre IN_PROGRESS e DONE
  const effIdx = status === 'PENDING_INSPECTION' ? 2 : currentIdx;
  return (
    <div className="flex items-center gap-2">
      {PRODUCTION_PIPELINE.map((step, i) => {
        const done = !offPath && effIdx >= 0 && i < effIdx;
        const active = !offPath && i === effIdx;
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
              <span className={cn('text-xs', active ? 'font-medium text-content' : 'text-content-muted')}>{step.label}</span>
            </div>
            {i < PRODUCTION_PIPELINE.length - 1 && <div className="h-px w-6 bg-neutral-200 dark:bg-neutral-700" />}
          </div>
        );
      })}
      {status === 'PENDING_INSPECTION' && (
        <Badge variant="warning" className="ml-2">
          Aguardando inspeção
        </Badge>
      )}
      {offPath && (
        <Badge variant="neutral" className="ml-2">
          Cancelada
        </Badge>
      )}
    </div>
  );
}

export default function ProductionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const { data: order, isLoading } = useDetail<OrderWithItems>(RESOURCE, id);
  const { data: balances = [] } = useList<StockBalance>('/stock/balances');

  const availableByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of balances) map.set(b.productId, (map.get(b.productId) ?? 0) + Number(b.available ?? 0));
    return map;
  }, [balances]);

  const transition = useMutation({
    mutationFn: (endpoint: string) => apiClient.patch(`${RESOURCE}/${id}/${endpoint}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: [RESOURCE] }),
  });

  function runAction(a: ProductionAction) {
    const doIt = () =>
      transition.mutate(a.endpoint, {
        onSuccess: () => toast.success('Status atualizado'),
        onError: () => toast.error('Não foi possível executar a ação'),
      });
    if (a.endpoint === 'cancel' || a.endpoint === 'complete') {
      confirm({
        title: a.label + '?',
        description:
          a.endpoint === 'complete'
            ? 'Concluir a OP registra a baixa dos componentes no estoque.'
            : 'Esta ação não pode ser desfeita.',
        confirmLabel: a.label,
        variant: a.endpoint === 'cancel' ? 'danger' : 'primary',
      }).then((ok) => ok && doIt());
    } else {
      doIt();
    }
  }

  if (isLoading || !order) {
    return (
      <div>
        <PageHeader title="Ordem de Produção" />
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  const actions = availableProductionActions(order.status);

  return (
    <div>
      <PageHeader
        title={`OP #${shortId(order.id)}`}
        description={order.product?.name ?? '—'}
        actions={
          <Button variant="secondary" onClick={() => router.push('/app/production')}>
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
                <p className="text-xs uppercase tracking-wide text-content-muted">Status</p>
                <Badge variant={PRODUCTION_STATUS[order.status].variant}>{PRODUCTION_STATUS[order.status].label}</Badge>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-content-muted">Quantidade</p>
                <p className="text-content tabular-nums">
                  {formatNumber(Number(order.producedQty))} / {formatNumber(Number(order.plannedQty))}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-content-muted">Depósito</p>
                <p className="text-content">{order.warehouse?.name ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-content-muted">Planejada</p>
                <p className="text-content">{order.scheduledStart ? formatDate(order.scheduledStart) : '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-content-muted">Conclusão</p>
                <p className="text-content">{order.completedAt ? formatDate(order.completedAt) : '—'}</p>
              </div>
            </div>
            {actions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {actions.map((a) => (
                  <Button key={a.endpoint} variant={a.variant} onClick={() => runAction(a)} loading={transition.isPending}>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Componentes (BOM)</CardTitle>
        </CardHeader>
        <CardContent>
          {(order.items ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-content-muted">
              Sem componentes registrados para esta OP.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-content-muted">
                    <th className="py-2 text-left font-medium">SKU</th>
                    <th className="py-2 text-left font-medium">Componente</th>
                    <th className="py-2 text-right font-medium">Necessário</th>
                    <th className="py-2 text-right font-medium">Consumido</th>
                    <th className="py-2 text-right font-medium">Em estoque</th>
                    <th className="py-2 text-center font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(order.items ?? []).map((it) => {
                    const needed = Number(it.plannedQty);
                    const avail = it.component ? availableByProduct.get(it.component.id) ?? 0 : 0;
                    const enough = avail >= needed;
                    return (
                      <tr key={it.id} className="border-b border-line">
                        <td className="py-2 font-mono text-xs text-content-muted">{it.component?.sku ?? '—'}</td>
                        <td className="py-2 text-content">{it.component?.name ?? '—'}</td>
                        <td className="py-2 text-right tabular-nums">{formatNumber(needed)}</td>
                        <td className="py-2 text-right tabular-nums text-content-muted">{formatNumber(Number(it.consumedQty))}</td>
                        <td className="py-2 text-right tabular-nums">{formatNumber(avail)}</td>
                        <td className="py-2 text-center">
                          <Badge variant={enough ? 'success' : 'danger'}>{enough ? 'OK' : 'Insuficiente'}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
