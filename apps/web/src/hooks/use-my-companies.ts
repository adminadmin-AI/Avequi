'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

export interface EmpresaDisponivel {
  id: string;
  name: string;
  razaoSocial: string | null;
  cnpj: string;
  /** Empresa de cadastro do usuário (a "casa") */
  isHome: boolean;
  /** Filial de uma matriz (o grupo inclui as filiais das empresas do grupo) */
  isBranch: boolean;
}

/**
 * Empresas que o usuário pode assumir como empresa ativa (#1119).
 *
 * Devolve pelo menos uma (a de cadastro). Uma só = usuário sem grupo
 * econômico, e aí o seletor não aparece — a esmagadora maioria dos casos.
 *
 * `staleTime` alto de propósito: a lista muda quando a operadora mexe no
 * grupo ou um admin concede/remove vínculo, o que é raríssimo comparado à
 * frequência de render do header.
 */
export function useMyCompanies() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const { data, isLoading } = useQuery({
    queryKey: ['/auth/me/companies'],
    enabled: isAuthenticated,
    retry: false,
    staleTime: 10 * 60 * 1000,
    queryFn: async () =>
      (await apiClient.get<EmpresaDisponivel[]>('/auth/me/companies')).data,
  });

  return {
    empresas: data ?? [],
    // O seletor só faz sentido com mais de uma opção.
    temGrupo: (data?.length ?? 0) > 1,
    isLoading,
  };
}
