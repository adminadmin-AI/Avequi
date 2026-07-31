'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Factory } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ProductionOrder, ProductionOrderStatus } from '@/types/api';
import type { WidgetComponentProps } from '../types';
import { EmptyState, ListSkeleton, WidgetAction, WidgetFrame } from '../widget-frame';
import { num } from '../workspace-context';

/**
 * Produção — widget VIVO (Fase 1.2 do "workspace vivo"): em vez de um gráfico
 * de barras por status, comunica ESTADO num relance — quanto do planejado já
 * foi produzido (barra de progresso) + o pipeline por status. Dado real do
 * /production (traz plannedQty/producedQty por OP).
 *
 * O progresso soma o trabalho EM ANDAMENTO (liberadas + em produção +
 * inspeção): produzido ÷ planejado. Concluídas/canceladas ficam fora do
 * denominador (não são mais "em aberto").
 */

const ACTIVE: ProductionOrderStatus[] = ['RELEASED', 'IN_PROGRESS', 'PENDING_INSPECTION'];

const PIPELINE: { status: ProductionOrderStatus; label: string; tone: string }[] = [
  { status: 'RELEASED', label: 'Liberadas', tone: 'bg-info' },
  { status: 'IN_PROGRESS', label: 'Em produção', tone: 'bg-brand-500' },
  { status: 'PENDING_INSPECTION', label: 'Inspeção', tone: 'bg-warning' },
  { status: 'DONE', label: 'Concluídas', tone: 'bg-success' },
];

export function ProductionChartWidget(_: WidgetComponentProps) {
  const productionQ = useQuery({
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryKey: ['/production'],
    queryFn: async () => (await apiClient.get<ProductionOrder[]>('/production')).data,
  });

  const { produced, planned, pct, counts, totalActive } = useMemo(() => {
    const orders = productionQ.data ?? [];
    let produced = 0;
    let planned = 0;
    const counts = new Map<ProductionOrderStatus, number>();
    for (const o of orders) {
      counts.set(o.status, (counts.get(o.status) ?? 0) + 1);
      if (ACTIVE.includes(o.status)) {
        produced += num(o.producedQty);
        planned += num(o.plannedQty);
      }
    }
    const pct = planned > 0 ? Math.min(100, Math.round((produced / planned) * 100)) : 0;
    const totalActive = ACTIVE.reduce((s, st) => s + (counts.get(st) ?? 0), 0);
    return { produced, planned, pct, counts, totalActive };
  }, [productionQ.data]);

  return (
    <WidgetFrame title="Produção" action={<WidgetAction href="/app/production">ver ordens</WidgetAction>}>
      {productionQ.isLoading ? (
        <ListSkeleton />
      ) : totalActive === 0 && planned === 0 ? (
        <EmptyState
          icon={Factory}
          title="Sem produção em andamento"
          hint="Assim que uma OP for liberada, o progresso aparece aqui."
        />
      ) : (
        <div className="space-y-4">
          {/* Progresso: produzido ÷ planejado das OPs em andamento */}
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[22px] font-semibold leading-7 tracking-[-0.02em] tabular-nums text-content">
                {formatNumber(produced)}
                <span className="text-content-muted"> / {formatNumber(planned)}</span>
                <span className="ml-1.5 text-caption font-normal text-content-muted">un.</span>
              </p>
              <p className="text-[19px] font-semibold leading-6 tabular-nums text-content">{pct}%</p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-500/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-[width] duration-flow ease-flow"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {/* Pipeline por status — de-boxed, só o que tem OP */}
          <ul className="space-y-1.5">
            {PIPELINE.filter((p) => (counts.get(p.status) ?? 0) > 0).map((p) => (
              <li key={p.status}>
                <Link
                  href="/app/production"
                  className="group flex items-center gap-2.5 rounded-lg px-1 py-1 transition-colors duration-micro hover:bg-neutral-500/[0.05]"
                >
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', p.tone)} />
                  <span className="min-w-0 flex-1 text-sm text-content-secondary">{p.label}</span>
                  <span className="shrink-0 text-sm font-medium tabular-nums text-content">
                    {counts.get(p.status)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </WidgetFrame>
  );
}
