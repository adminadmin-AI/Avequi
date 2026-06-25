'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Contadores dinâmicos exibidos como badges na sidebar (#142).
 *
 * Não há endpoint agregado (`/app/sidebar-counts`) no backend, então os
 * números são derivados dos endpoints existentes, com polling de 60s.
 *
 * Mapa href -> contador:
 *   /app/approvals             -> aprovações pendentes
 *   /app/alerts                -> alertas ativos (= notificações não lidas)
 *   /app/finance/reconciliation-> itens de conciliação pendentes
 */
export function useSidebarCounts(): Record<string, number> {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const common = {
    enabled: isAuthenticated,
    refetchInterval: 60_000,
    retry: false,
    staleTime: 30_000,
  } as const;

  const approvals = useQuery({
    ...common,
    queryKey: ['/approvals/pending', 'count'],
    queryFn: async () => (await apiClient.get<unknown[]>('/approvals/pending')).data.length,
  });
  const alerts = useQuery({
    ...common,
    queryKey: ['/alerts', 'count'],
    queryFn: async () => (await apiClient.get<unknown[]>('/alerts')).data.length,
  });
  const reconciliation = useQuery({
    ...common,
    queryKey: ['/banking/reconciliation/unmatched', 'count'],
    queryFn: async () => (await apiClient.get<unknown[]>('/banking/reconciliation/unmatched')).data.length,
  });

  return {
    '/app/approvals': approvals.data ?? 0,
    '/app/alerts': alerts.data ?? 0,
    '/app/finance/reconciliation': reconciliation.data ?? 0,
  };
}
