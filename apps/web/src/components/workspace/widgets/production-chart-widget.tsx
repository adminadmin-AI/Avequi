'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { ProductionOrder, ProductionOrderStatus } from '@/types/api';
import type { WidgetComponentProps } from '../types';
import { ChartSkeleton, WidgetFrame } from '../widget-frame';

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

  return (
    <WidgetFrame title="Produção por status">
      {productionQ.isLoading ? <ChartSkeleton /> : <ProductionBarChart data={prodByStatus} />}
    </WidgetFrame>
  );
}
