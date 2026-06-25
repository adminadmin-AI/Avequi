'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { SalesOrder, SalesOrderStatus } from '@/types/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { formatBRL, formatDate } from '@/lib/format';
import { SALES_STATUS, salesOrderTotal } from './sales-status';

const RESOURCE = '/sales';

/** Colunas do quadro e quais status caem em cada uma. */
const COLUMNS: { id: string; label: string; statuses: SalesOrderStatus[] }[] = [
  { id: 'draft', label: 'Rascunho', statuses: ['DRAFT', 'CREDIT_HOLD'] },
  { id: 'reserved', label: 'Reservado', statuses: ['RESERVED'] },
  {
    id: 'confirmed',
    label: 'Em andamento',
    statuses: ['CONFIRMED', 'AWAITING_PICKING', 'READY_TO_INVOICE'],
  },
  { id: 'invoiced', label: 'Faturado', statuses: ['INVOICED'] },
  { id: 'cancelled', label: 'Cancelado', statuses: ['CANCELLED', 'RETURNED'] },
];

/**
 * Resolve a transição ao soltar um card numa coluna.
 * Retorna o endpoint PATCH /sales/:id/<endpoint> e o label, ou null se a
 * transição não é permitida a partir do status atual (pipeline estrito).
 */
function resolveDrop(
  current: SalesOrderStatus,
  targetColumn: string,
): { endpoint: string; label: string } | null {
  if (targetColumn === 'reserved' && current === 'DRAFT')
    return { endpoint: 'reserve', label: 'Reservar estoque' };
  if (targetColumn === 'confirmed' && current === 'RESERVED')
    return { endpoint: 'confirm', label: 'Confirmar OV' };
  if (targetColumn === 'invoiced' && current === 'READY_TO_INVOICE')
    return { endpoint: 'invoice', label: 'Faturar (emitir NF-e)' };
  if (
    targetColumn === 'cancelled' &&
    ['DRAFT', 'CREDIT_HOLD', 'RESERVED', 'CONFIRMED', 'AWAITING_PICKING'].includes(current)
  )
    return { endpoint: 'cancel', label: 'Cancelar OV' };
  return null;
}

function shortId(id: string) {
  return id.slice(-6).toUpperCase();
}

export function SalesKanban({ orders }: { orders: SalesOrder[] }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const transition = useMutation({
    mutationFn: ({ id, endpoint }: { id: string; endpoint: string }) =>
      apiClient.patch(`${RESOURCE}/${id}/${endpoint}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: [RESOURCE] }),
  });

  const byColumn = useMemo(() => {
    const map: Record<string, SalesOrder[]> = {};
    for (const col of COLUMNS) map[col.id] = [];
    for (const o of orders) {
      const col = COLUMNS.find((c) => c.statuses.includes(o.status));
      if (col) map[col.id].push(o);
    }
    return map;
  }, [orders]);

  async function onDrop(targetColumn: string) {
    setOverCol(null);
    const order = orders.find((o) => o.id === dragId);
    setDragId(null);
    if (!order) return;

    const resolved = resolveDrop(order.status, targetColumn);
    if (!resolved) {
      toast.error('Transição não permitida a partir deste status.');
      return;
    }
    const ok = await confirm({
      title: resolved.label + '?',
      description: `OV #${shortId(order.id)} — ${SALES_STATUS[order.status].label} → ${resolved.label}.`,
      confirmLabel: 'Confirmar',
      variant: resolved.endpoint === 'cancel' ? 'danger' : 'primary',
    });
    if (!ok) return;
    transition.mutate(
      { id: order.id, endpoint: resolved.endpoint },
      {
        onSuccess: () => toast.success('Status atualizado'),
        onError: () => toast.error('Não foi possível executar a transição'),
      },
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {COLUMNS.map((col) => (
        <div
          key={col.id}
          onDragOver={(e) => {
            e.preventDefault();
            setOverCol(col.id);
          }}
          onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
          onDrop={() => onDrop(col.id)}
          className={cn(
            'flex flex-col rounded-xl border bg-slate-50/60 p-2 transition-colors',
            overCol === col.id ? 'border-brand-400 bg-brand-50/50' : 'border-slate-200',
          )}
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {col.label}
            </span>
            <span className="rounded-full bg-slate-200 px-2 text-xs font-medium text-slate-600">
              {byColumn[col.id].length}
            </span>
          </div>

          <div className="flex min-h-[80px] flex-col gap-2 p-1">
            {byColumn[col.id].map((o) => (
              <div
                key={o.id}
                draggable
                onDragStart={() => setDragId(o.id)}
                onDragEnd={() => {
                  setDragId(null);
                  setOverCol(null);
                }}
                onClick={() => router.push(`/app/sales/${o.id}`)}
                className={cn(
                  'cursor-grab rounded-lg border border-slate-200 bg-white p-3 shadow-xs transition-shadow hover:shadow-sm active:cursor-grabbing',
                  dragId === o.id && 'opacity-50',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-medium text-slate-500">#{shortId(o.id)}</span>
                  <span className="text-xs text-slate-400">{formatDate(o.createdAt)}</span>
                </div>
                <p className="mt-1 truncate text-sm font-medium text-slate-800">
                  {o.customer?.name ?? 'Sem cliente'}
                </p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
                  {formatBRL(salesOrderTotal(o))}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
