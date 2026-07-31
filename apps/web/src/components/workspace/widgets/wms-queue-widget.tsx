'use client';

import { useQuery } from '@tanstack/react-query';
import { PackageSearch } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { WidgetComponentProps } from '../types';
import { EmptyState, ListSkeleton, WidgetAction, WidgetFrame } from '../widget-frame';

/**
 * Fila do armazém — F3, zona de trabalho (perfil logistics). Consome
 * GET /wms/dashboard (sem warehouseId = agrega todos os armazéns da
 * empresa): a resposta imediata ao "o que separar/guardar agora?".
 */

interface WmsDashboardResponse {
  pendingPutaway: number;
  pendingPick: number;
  activeInventory: number;
  receiving: Record<string, number>;
  picking: Record<string, number>;
  inventory: Record<string, number>;
}

export function WmsQueueWidget(_: WidgetComponentProps) {
  const wmsQ = useQuery({
    retry: false,
    staleTime: 60 * 1000,
    queryKey: ['/wms/dashboard'],
    queryFn: async () => (await apiClient.get<WmsDashboardResponse>('/wms/dashboard')).data,
  });

  const d = wmsQ.data;
  const stats = d
    ? [
        { label: 'Pedidos para separar', value: d.pendingPick, alarm: d.pendingPick > 0 },
        { label: 'Aguardando guarda', value: d.pendingPutaway, alarm: d.pendingPutaway > 0 },
        { label: 'Inventários em curso', value: d.activeInventory, alarm: false },
      ]
    : [];

  return (
    <WidgetFrame
      title="Fila do armazém"
      action={<WidgetAction href="/app/stock/wms">abrir WMS</WidgetAction>}
    >
      {wmsQ.isLoading ? (
        <ListSkeleton />
      ) : !d ? (
        <EmptyState icon={PackageSearch} title="Fila indisponível no momento" />
      ) : (
        // De-box (padrão StatGroup): números como tipografia, cor só em alarme real
        <div className="grid grid-cols-3 gap-4">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0">
              <p
                className={cn(
                  'text-[19px] font-semibold leading-7 tabular-nums tracking-[-0.02em]',
                  s.alarm ? 'text-warning' : 'text-content',
                )}
              >
                {s.value}
              </p>
              <p className="text-caption text-content-muted">{s.label}</p>
            </div>
          ))}
        </div>
      )}
    </WidgetFrame>
  );
}
