'use client';

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { NavAccess } from '@/lib/nav-config';
import { permissionMatches } from '@/lib/permission-match';
import { useAuthStore } from '@/stores/auth-store';
import type { MyEffectivePermissions, ResolvedEntitlements } from '@/types/api';

/**
 * Permissões efetivas do usuário logado no frontend — issue #351 (IAM F7.1).
 *
 * Fonte: GET /auth/me/permissions (RBAC v2 com cache Redis no backend +
 * fallback do enum legado para usuários não migrados). O TanStack Query é o
 * store: chave por userId, staleTime de 5 min (mesmo TTL do cache Redis do
 * PermissionService) — trocar de usuário troca a chave e busca de novo.
 *
 * Semântica FAIL-CLOSED: enquanto carrega (ou sem usuário), can() retorna
 * false. A UI decide com `isLoading` se mostra esqueleto ou esconde.
 *
 * REGRA DE OURO: isto é UX (esconder o que não pode), NUNCA segurança.
 * Toda validação real acontece no backend (PermissionGuard).
 */

const STALE_TIME_MS = 5 * 60_000; // = TTL do cache Redis do PermissionService

export const myPermissionsKey = (userId: string | undefined) =>
  ['auth', 'me', 'permissions', userId ?? 'anonymous'] as const;

/** Query crua — fetch no primeiro uso após login, refetch a cada 5 min. */
export function useMyPermissions() {
  const user = useAuthStore((s) => s.user);
  return useQuery<MyEffectivePermissions>({
    queryKey: myPermissionsKey(user?.id),
    enabled: !!user,
    staleTime: STALE_TIME_MS,
    queryFn: async () =>
      (await apiClient.get<MyEffectivePermissions>('/auth/me/permissions')).data,
  });
}

export interface UsePermissionResult {
  /** Tem a permissão? Aceita code exato ou wildcard de sufixo (`sales.*`). */
  can: (code: string) => boolean;
  /** Negação conveniente (API da issue #351). */
  cannot: (code: string) => boolean;
  /** Tem PELO MENOS UMA das permissões? (lista vazia → false) */
  canAny: (codes: string[]) => boolean;
  /** Tem TODAS as permissões? (lista vazia → true, igual ao backend) */
  canAll: (codes: string[]) => boolean;
  /** Tem o perfil DIRETAMENTE atribuído? (herança não conta — igual backend) */
  hasRole: (roleCode: string) => boolean;
  /** true enquanto a primeira busca não terminou (can() retorna false). */
  isLoading: boolean;
  /** Codes efetivos (para casos avançados, ex.: filtrar listas). */
  permissions: string[];
  /** Codes dos perfis diretamente atribuídos. */
  roles: string[];
  /** true = permissões derivadas do enum legado (usuário não migrado). */
  legacyFallback: boolean;
}

/**
 * API principal de checagem de permissão no frontend.
 *
 * ```tsx
 * const { can, canAny, isLoading } = usePermission();
 * if (can('sales.orders.create')) { ... }
 * if (canAny(['iam.roles.view', 'iam.roles.manage'])) { ... }
 * ```
 */
export function usePermission(): UsePermissionResult {
  const query = useMyPermissions();

  const effective = useMemo(
    () => new Set(query.data?.permissions ?? []),
    [query.data?.permissions],
  );
  const roles = query.data?.roles ?? [];

  const can = useCallback(
    (code: string) => permissionMatches(effective, code),
    [effective],
  );
  const cannot = useCallback((code: string) => !can(code), [can]);
  const canAny = useCallback(
    (codes: string[]) => codes.some((code) => permissionMatches(effective, code)),
    [effective],
  );
  const canAll = useCallback(
    (codes: string[]) => codes.every((code) => permissionMatches(effective, code)),
    [effective],
  );
  const hasRole = useCallback((roleCode: string) => roles.includes(roleCode), [roles]);

  return {
    can,
    cannot,
    canAny,
    canAll,
    hasRole,
    isLoading: query.isLoading,
    permissions: query.data?.permissions ?? [],
    roles,
    legacyFallback: query.data?.legacyFallback ?? false,
  };
}

/**
 * Entitlements efetivos da CONTA logada — OPS WP4 (#911).
 *
 * Fonte: GET /entitlements/me — QUALQUER usuário autenticado pode ler (é o
 * contrato comercial da própria conta, não segredo). Mesmo cache por
 * TanStack Query dos demais hooks de sessão (chave por userId, 5 min).
 *
 * Semântica FAIL-CLOSED igual a `usePermission`: sem dado carregado (loading
 * ou erro) → `useNavAccess.hasEntitlement` esconde o item. Conta LEGADO
 * (`legacy: true`, sem plano) libera todos os entitlements.
 */
export const myEntitlementsKey = (userId: string | undefined) =>
  ['auth', 'me', 'entitlements', userId ?? 'anonymous'] as const;

export function useMyEntitlements() {
  const user = useAuthStore((s) => s.user);
  return useQuery<ResolvedEntitlements>({
    queryKey: myEntitlementsKey(user?.id),
    enabled: !!user,
    staleTime: STALE_TIME_MS,
    queryFn: async () => (await apiClient.get<ResolvedEntitlements>('/entitlements/me')).data,
  });
}

/**
 * Contexto de acesso para filtrar o NAV (#351) — consumido por sidebar,
 * command palette e RouteGuard via `navItemAllowed`/`checkRouteAccess`.
 * Enquanto as permissões carregam, `can` fica undefined e os itens gated
 * por `permission` ficam ocultos / a rota segura render (fail-closed).
 *
 * `hasEntitlement` (OPS WP4 #911): sem dado de GET /entitlements/me (loading
 * ou erro na chamada) → retorna false para qualquer key (fail-closed); conta
 * legado (`legacy: true`) → retorna true para qualquer key.
 */
export function useNavAccess(): NavAccess {
  const role = useAuthStore((s) => s.user?.role);
  const { can, isLoading } = usePermission();
  const entitlementsQuery = useMyEntitlements();
  const entitlements = entitlementsQuery.data;

  const hasEntitlement = useCallback(
    (key: string) => {
      if (!entitlements) return false; // ainda carregando ou falhou — fail-closed
      if (entitlements.legacy) return true; // legado: sem plano, tudo liberado
      return entitlements.values[key] === true;
    },
    [entitlements],
  );

  return useMemo(
    () => ({ role, can: isLoading ? undefined : can, hasEntitlement }),
    [role, can, isLoading, hasEntitlement],
  );
}
