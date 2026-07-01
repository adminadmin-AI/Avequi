'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

interface Company {
  id: string;
  name?: string;
  tradeName?: string;
  razaoSocial?: string;
}

/**
 * Nome da empresa do usuário logado. Não há endpoint dedicado de "minha
 * empresa", então resolve a partir de GET /companies (lista) pelo companyId
 * do JWT. Falha silenciosamente (retry:false) — é informativo, não crítico.
 */
export function useCurrentCompany(): string | null {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const { data } = useQuery({
    queryKey: ['/companies', 'current'],
    enabled: isAuthenticated,
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => (await apiClient.get<Company[]>('/companies')).data,
  });

  if (!data || !user) return null;
  const company = data.find((c) => c.id === user.companyId);
  return company?.tradeName || company?.name || company?.razaoSocial || null;
}
