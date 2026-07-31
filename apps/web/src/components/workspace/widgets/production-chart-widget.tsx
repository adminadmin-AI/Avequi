'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { Factory } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import type { ProductionOrder, ProductionOrderStatus } from '@/types/api';
import type { WidgetComponentProps } from '../types';
import { ChartSkeleton, EmptyState, WidgetFrame } from '../widget-frame';

const ProductionBarChart = dynamic(() => import('./charts').then((m) => m.ProductionBarChart), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

const PROD_STATUS_LABEL: Record<ProductionOrderStatus, string> = {
  DRAFT: 'Planejada',
  RELEASED: 'Liberada',
  IN_PROGRESS: 'Em produção',
  PENDING_INSPECTION: 'Inspeção',
  DONE: 'Concluída',
  CANCELLED: 'Cancelada',
};

/** OPs por status — zona de contexto (tendência, nunca acima de tarefa). */
export function ProductionChartWidget(_: WidgetComponentProps) {
  const productionQ = useQuery({
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryKey: ['/production'],
    queryFn: async () => (await apiClient.get<ProductionOrder[]>('/production')).data,
  });

  const prodByStatus = useMemo(() => {
    const counts = new Map<ProductionOrderStatus, number>();
    for (const o of productionQ.data ?? []) counts.set(o.status, (counts.get(o.status) ?? 0) + 1);
    return (Object.keys(PROD_STATUS_LABEL) as ProductionOrderStatus[])
      .filter((s) => s !== 'CANCELLED')
      .map((s) => ({ status: PROD_STATUS_LABEL[s], count: counts.get(s) ?? 0 }));
  }, [productionQ.data]);

  // Nunca gráfico vazio: barras todas zeradas viram empty state.
  const hasData = prodByStatus.some((s) => s.count > 0);

  return (
    <WidgetFrame title="Produção por status" quiet>
      {productionQ.isLoading ? (
        <ChartSkeleton />
      ) : !hasData ? (
        <EmptyState
          tall
          icon={Factory}
          title="Ainda não há ordens de produção"
          hint="Assim que novas OPs forem registradas, elas aparecem aqui."
        />
      ) : (
        <ProductionBarChart data={prodByStatus} />
      )}
    </WidgetFrame>
  );
}
