'use client';

import type { ReactNode } from 'react';
import { usePermission } from '@/hooks/use-permission';

/**
 * Renderização condicional por permissão — issue #351 (IAM F7.1).
 *
 * ```tsx
 * <Can permission="sales.orders.create">
 *   <Button>Nova Ordem de Venda</Button>
 * </Can>
 *
 * <Can anyOf={['iam.roles.view', 'iam.roles.manage']} fallback={<AcessoRestrito />}>
 *   <RolesTable />
 * </Can>
 * ```
 *
 * Critérios combinam com E lógico quando mais de um é passado
 * (permission + anyOf + allOf). Wildcard de sufixo suportado (`sales.*`).
 *
 * FAIL-CLOSED: enquanto as permissões carregam, renderiza `loading`
 * (default: nada) — nunca os filhos. SSR-safe: componente client; no
 * servidor não há usuário, então nada é renderizado até hidratar.
 *
 * Isto é UX, não segurança — o backend sempre revalida (PermissionGuard).
 */
export interface CanProps {
  /** Code exato ou wildcard de sufixo (`modulo.*`). */
  permission?: string;
  /** Pelo menos UMA das permissões. */
  anyOf?: string[];
  /** TODAS as permissões. */
  allOf?: string[];
  /** Renderizado quando NÃO tem permissão (default: nada). */
  fallback?: ReactNode;
  /** Renderizado ENQUANTO carrega (default: nada — fail-closed). */
  loading?: ReactNode;
  children: ReactNode;
}

export function Can({
  permission,
  anyOf,
  allOf,
  fallback = null,
  loading = null,
  children,
}: CanProps) {
  const { can, canAny, canAll, isLoading } = usePermission();

  if (isLoading) return <>{loading}</>;

  let allowed = true;
  if (permission !== undefined) allowed = allowed && can(permission);
  if (anyOf !== undefined) allowed = allowed && canAny(anyOf);
  if (allOf !== undefined) allowed = allowed && canAll(allOf);

  return <>{allowed ? children : fallback}</>;
}
