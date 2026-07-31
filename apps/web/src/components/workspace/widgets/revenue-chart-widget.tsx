'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import type { WidgetComponentProps } from '../types';
import { ChartSkeleton, EmptyState, WidgetFrame } from '../widget-frame';
import { isoDaysAgo, num, useWorkspacePeriod } from '../workspace-context';

const RevenueLineChart = dynamic(() => import('./charts').then((m) => m.RevenueLineChart), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

interface SalesCubeRow {
  period: string;
  totalRevenue: number;
}

/** Faturamento no período — zona de contexto (tendência, nunca acima de tarefa). */
export function RevenueChartWidget(_: WidgetComponentProps) {
  const { periodDays } = useWorkspacePeriod();
  const startDate = isoDaysAgo(periodDays);
  const endDate = isoDaysAgo(0);

  const salesQ = useQuery({
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryKey: ['/analytics/sales-cube', startDate, endDate],
    queryFn: async () =>
      (await apiClient.get<SalesCubeRow[]>('/analytics/sales-cube', { params: { startDate, endDate } }))
        .data,
  });

  const revenueSeries = useMemo(() => {
    const byPeriod = new Map<string, number>();
    for (const r of salesQ.data ?? []) {
      byPeriod.set(r.period, (byPeriod.get(r.period) ?? 0) + num(r.totalRevenue));
    }
    return [...byPeriod.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, value]) => ({ period, value }));
  }, [salesQ.data]);

  return (
    <WidgetFrame title="Faturamento" quiet>
      {salesQ.isLoading ? (
        <ChartSkeleton />
      ) : revenueSeries.length === 0 ? (
        <EmptyState
          tall
          icon={BarChart3}
          title="Ainda não há dados neste período"
          hint="Assim que novas vendas forem registradas, a tendência aparece aqui."
        />
      ) : (
        <RevenueLineChart data={revenueSeries} />
      )}
    </WidgetFrame>
  );
}
