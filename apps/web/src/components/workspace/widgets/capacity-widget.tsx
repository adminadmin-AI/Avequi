'use client';

import { useQuery } from '@tanstack/react-query';
import { Gauge } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { WidgetComponentProps } from '../types';
import { EmptyState, ListSkeleton, WidgetAction, WidgetFrame } from '../widget-frame';
import { isoDaysAgo } from '../workspace-context';

/**
 * Capacidade & gargalos — F3, zona de trabalho (perfis production e
 * operations). Consome GET /capacity/plan (startDate/endDate OBRIGATÓRIOS —
 * janela de 30 dias a partir de hoje). Barras de utilização por centro de
 * trabalho, gargalo destacado — sem recharts: barra é div, mais leve.
 */

interface WorkCenterCapacity {
  workCenterId: string;
  code: string;
  name: string;
  utilizationPct: number;
  isBottleneck: boolean;
}

interface CapacityPlanResponse {
  workCenters: WorkCenterCapacity[];
  bottlenecks: string[];
  summary: { totalWorkCenters: number; bottleneckCount: number; avgUtilizationPct: number };
}

export function CapacityWidget(_: WidgetComponentProps) {
  const startDate = isoDaysAgo(0);
  const endDate = isoDaysAgo(-30);

  const capacityQ = useQuery({
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryKey: ['/capacity/plan', startDate, endDate],
    queryFn: async () =>
      (await apiClient.get<CapacityPlanResponse>('/capacity/plan', { params: { startDate, endDate } }))
        .data,
  });

  // Gargalos primeiro, depois por utilização — mostra o que aperta
  const centers = [...(capacityQ.data?.workCenters ?? [])]
    .sort((a, b) => Number(b.isBottleneck) - Number(a.isBottleneck) || b.utilizationPct - a.utilizationPct)
    .slice(0, 6);

  return (
    <WidgetFrame
      title="Capacidade & gargalos"
      action={<WidgetAction href="/app/production/work-centers">ver centros</WidgetAction>}
    >
      {capacityQ.isLoading ? (
        <ListSkeleton />
      ) : centers.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title="Sem carga de produção"
          hint="Nenhum centro de trabalho com carga nos próximos 30 dias."
        />
      ) : (
        <ul className="space-y-2.5">
          {centers.map((wc) => {
            const pct = Math.round(wc.utilizationPct);
            return (
              <li key={wc.workCenterId} className="min-w-0">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm text-content">{wc.name}</span>
                  <span
                    className={cn(
                      'shrink-0 text-caption tabular-nums',
                      wc.isBottleneck ? 'font-medium text-danger' : 'text-content-muted',
                    )}
                  >
                    {pct}%{wc.isBottleneck ? ' ⚠' : ''}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-neutral-500/10">
                  <div
                    className={cn(
                      'h-full rounded-full transition-[width] duration-flow',
                      wc.isBottleneck ? 'bg-danger' : pct >= 85 ? 'bg-warning' : 'bg-brand-500',
                    )}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetFrame>
  );
}
