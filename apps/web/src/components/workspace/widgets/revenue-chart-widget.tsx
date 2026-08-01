'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import type { WidgetComponentProps } from '../types';
import { ChartSkeleton, EmptyState, WidgetFrame } from '../widget-frame';
import { useWorkspacePeriod } from '../workspace-context';

const RevenueLineChart = dynamic(() => import('./charts').then((m) => m.RevenueLineChart), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

interface RevenueSeriesResponse {
  periodDays: number;
  total: number;
  series: { period: string; value: number }[];
}

/**
 * Faturamento no período — zona de contexto (tendência, nunca acima de tarefa).
 *
 * Consome GET /workspace/revenue: um ponto por DIA, só venda com NF emitida.
 * Antes lia o sales-cube, que agrupa por MÊS de criação do pedido e inclui
 * rascunho/cancelado — com período de 30 dias a "tendência" era um ou dois
 * pontos mensais, e o total divergia do que o Meu Dia mostra.
 */
export function RevenueChartWidget(_: WidgetComponentProps) {
  const { periodDays } = useWorkspacePeriod();

  const salesQ = useQuery({
    retry: false,
    staleTime: 5 * 60 * 1000,
    // Mesma queryKey do KPI de faturamento → uma requisição só.
    queryKey: ['/workspace/revenue', periodDays],
    queryFn: async () =>
      (await apiClient.get<RevenueSeriesResponse>('/workspace/revenue', { params: { days: periodDays } }))
        .data,
  });

  const revenueSeries = useMemo(
    () => (salesQ.data?.series ?? []).map((p) => ({ period: dayLabel(p.period), value: p.value })),
    [salesQ.data],
  );

  // Série só com zeros = período inteiro sem faturamento: o gráfico viraria uma
  // linha rasteira sem informação; o estado vazio diz isso com todas as letras.
  const hasMovement = revenueSeries.some((p) => p.value > 0);

  return (
    <WidgetFrame title="Faturamento" quiet>
      {salesQ.isLoading ? (
        <ChartSkeleton />
      ) : !hasMovement ? (
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

/** '2026-07-31' → '31/07' (o eixo X respira melhor sem o ano). */
function dayLabel(iso: string): string {
  const [, month, day] = iso.split('-');
  return month && day ? `${day}/${month}` : iso;
}
