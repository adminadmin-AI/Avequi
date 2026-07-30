'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { usePermission } from '@/hooks/use-permission';
import type { LayoutOverride, PersistedLayout } from './types';

/**
 * Layout persistido da Home (F2) — GET/PUT/DELETE /workspace/layout.
 *
 * Optimistic: salvar atualiza o cache na hora (a Home reflete o arrasto
 * imediatamente); erro de rede reverte para o servidor no próximo refetch.
 * Sem permissão de leitura (ex.: usuário fora dos perfis com workspace.*),
 * a query nem roda e a Home usa o template puro.
 */

const KEY = ['/workspace/layout'] as const;

export function useWorkspaceLayout() {
  const { can, isLoading: permsLoading } = usePermission();
  const queryClient = useQueryClient();
  const canView = !permsLoading && can('workspace.layout.view');
  const canEdit = !permsLoading && can('workspace.layout.update');

  const layoutQ = useQuery({
    retry: false,
    staleTime: 5 * 60 * 1000,
    enabled: canView,
    queryKey: KEY,
    queryFn: async () => (await apiClient.get<PersistedLayout | null>('/workspace/layout')).data,
  });

  const saveM = useMutation({
    mutationFn: async (widgets: LayoutOverride[]) =>
      (await apiClient.put<PersistedLayout>('/workspace/layout', { version: 1, widgets })).data,
    onMutate: async (widgets) => {
      await queryClient.cancelQueries({ queryKey: KEY });
      queryClient.setQueryData<PersistedLayout | null>(KEY, { version: 1, widgets });
    },
    onError: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });

  const resetM = useMutation({
    mutationFn: async () => (await apiClient.delete('/workspace/layout')).data,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: KEY });
      queryClient.setQueryData<PersistedLayout | null>(KEY, null);
    },
    onError: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });

  return {
    overrides: layoutQ.data?.widgets ?? null,
    profileOverride: layoutQ.data?.profile ?? null,
    isLoading: canView && layoutQ.isLoading,
    canEdit,
    save: (widgets: LayoutOverride[]) => saveM.mutate(widgets),
    reset: () => resetM.mutate(),
  };
}
