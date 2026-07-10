'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, Home, ShieldAlert } from 'lucide-react';
import { checkRouteAccess } from '@/lib/nav-config';
import { useNavAccess } from '@/hooks/use-permission';
import { Button, buttonVariants } from '@/components/ui/button';
import { USER_ROLE_LABELS } from '@/lib/enums';
import type { UserRole } from '@/types/api';

/**
 * Guard de rota (#453/Frente 7 do hardening de IAM; permissões RBAC v2 no #351).
 *
 * Resolve o pathname atual contra o mapa central de navegação (NAV em
 * nav-config.ts — o MESMO mapa que a sidebar e o command palette usam) e:
 * - rota liberada → renderiza a página normalmente;
 * - rota gated por `permission` com as permissões ainda carregando → segura o
 *   render (fail-closed: sem flash de conteúdo que o backend vai negar);
 * - rota restrita sem acesso (permissão OU role) → página "Acesso negado"
 *   (sem redirect silencioso — melhor UX e mais fácil de debugar);
 * - rota NÃO mapeada no NAV → libera (default aberto para não quebrar
 *   páginas novas antes de entrarem no menu), com warning no console em dev.
 *
 * ⚠️ Isso é defesa de UX, não de segurança: qualquer controle no cliente é
 * contornável. A autorização real é o backend (@RequirePermission/@Roles).
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const access = useNavAccess();
  const routeAccess = checkRouteAccess(pathname, access);

  useEffect(() => {
    if (routeAccess.status === 'unmapped' && process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.warn(
        `[RouteGuard] Rota "${pathname}" não está mapeada no NAV (nav-config.ts). ` +
          'Acesso liberado por padrão — adicione um item de navegação (com `permission` ' +
          'ou `roles`, se for restrita) para que o guard passe a controlá-la.',
      );
    }
  }, [routeAccess.status, pathname]);

  if (routeAccess.status === 'loading') return null;

  if (routeAccess.status === 'denied') {
    return (
      <AccessDenied
        role={access.role ?? undefined}
        allowedRoles={routeAccess.roles}
        permission={routeAccess.permission}
      />
    );
  }

  return <>{children}</>;
}

function AccessDenied({
  role,
  allowedRoles,
  permission,
}: {
  role?: string;
  allowedRoles: string[];
  permission?: string;
}) {
  const router = useRouter();
  const roleLabel = role ? (USER_ROLE_LABELS[role as UserRole] ?? role) : 'desconhecido';
  const allowedLabels = allowedRoles
    .map((r) => USER_ROLE_LABELS[r as UserRole] ?? r)
    .join(', ');

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-danger/10">
        <ShieldAlert size={28} className="text-danger" aria-hidden />
      </div>
      <h1 className="mt-4 text-xl font-semibold text-content">Acesso negado</h1>
      {permission ? (
        <p className="mt-2 max-w-md text-sm text-content-secondary">
          Seu perfil não tem a permissão necessária para acessar esta página
          (<code className="rounded bg-surface-secondary px-1 py-0.5 text-xs">{permission}</code>).
        </p>
      ) : (
        <p className="mt-2 max-w-md text-sm text-content-secondary">
          Seu perfil (<strong>{roleLabel}</strong>) não tem permissão para acessar esta página.
          Perfis com acesso: {allowedLabels}.
        </p>
      )}
      <p className="mt-1 max-w-md text-sm text-content-muted">
        Se você acredita que deveria ter acesso, fale com o administrador do sistema.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <Button variant="secondary" onClick={() => router.back()} leftIcon={<ArrowLeft size={16} />}>
          Voltar
        </Button>
        <Link href="/app" className={buttonVariants({ variant: 'primary', size: 'md' })}>
          <Home size={16} aria-hidden />
          Ir para o Início
        </Link>
      </div>
    </div>
  );
}
