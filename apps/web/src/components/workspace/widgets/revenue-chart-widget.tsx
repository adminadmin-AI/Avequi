'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { WidgetComponentProps } from '../types';
import { ChartSkeleton, EmptyContent, WidgetFrame } from '../widget-frame';
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
    <WidgetFrame title="Faturamento">
      {salesQ.isLoading ? (
        <ChartSkeleton />
      ) : revenueSeries.length === 0 ? (
        <EmptyContent label="Sem dados de faturamento no período." />
      ) : (
        <RevenueLineChart data={revenueSeries} />
      )}
    </WidgetFrame>
  );
}
