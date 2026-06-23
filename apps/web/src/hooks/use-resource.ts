'use client';

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

/**
 * Hooks CRUD genéricos sobre a API Avequi.
 *
 * Todos os endpoints de lista da API exigem `companyId` como query param
 * (limitação atual do backend). Os hooks injetam isso automaticamente quando
 * `companyId` é passado em `params`.
 *
 * Uso:
 *   const { data, isLoading } = useList<Product>('/products', { companyId });
 *   const create = useCreate<Product>('/products');
 *   create.mutate({ ...payload });
 */

type Params = Record<string, string | number | boolean | undefined | null>;

function cleanParams(params?: Params): Params | undefined {
  if (!params) return undefined;
  const out: Params = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

// ─── List ─────────────────────────────────────────────────────────────────────
export function useList<T>(
  resource: string,
  params?: Params,
  options?: Omit<UseQueryOptions<T[]>, 'queryKey' | 'queryFn'>,
) {
  const clean = cleanParams(params);
  return useQuery<T[]>({
    queryKey: [resource, clean ?? {}],
    queryFn: async () => {
      const { data } = await apiClient.get<T[]>(resource, { params: clean });
      return data;
    },
    ...options,
  });
}

// ─── Detail ───────────────────────────────────────────────────────────────────
export function useDetail<T>(
  resource: string,
  id: string | undefined,
  params?: Params,
  options?: Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>,
) {
  const clean = cleanParams(params);
  return useQuery<T>({
    queryKey: [resource, id, clean ?? {}],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await apiClient.get<T>(`${resource}/${id}`, { params: clean });
      return data;
    },
    ...options,
  });
}

// ─── Create ───────────────────────────────────────────────────────────────────
export function useCreate<T, TInput = Partial<T>>(resource: string) {
  const qc = useQueryClient();
  return useMutation<T, unknown, TInput>({
    mutationFn: async (payload) => {
      const { data } = await apiClient.post<T>(resource, payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [resource] }),
  });
}

// ─── Update ───────────────────────────────────────────────────────────────────
export function useUpdate<T, TInput = Partial<T>>(resource: string) {
  const qc = useQueryClient();
  return useMutation<T, unknown, { id: string; data: TInput }>({
    mutationFn: async ({ id, data }) => {
      const { data: res } = await apiClient.patch<T>(`${resource}/${id}`, data);
      return res;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [resource] }),
  });
}

// ─── Delete ───────────────────────────────────────────────────────────────────
export function useDelete(resource: string) {
  const qc = useQueryClient();
  return useMutation<void, unknown, string>({
    mutationFn: async (id) => {
      await apiClient.delete(`${resource}/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [resource] }),
  });
}
