'use client';

import { useMemo } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { PanelLeft, PanelLeftClose, X } from 'lucide-react';
import { OPS_NAV, navItemAllowed, resolveActiveHref } from '@/lib/nav-config';
import { useNavAccess, usePermission } from '@/hooks/use-permission';
import { AvecchiWordmark } from '@/components/auth/avecchi-wordmark';
import { Skeleton } from '@/components/ui/skeleton';
import { NavLink } from '@/components/shell/nav-link';
import {
  SidebarFrame,
  SidebarVersionFooter,
  type SidebarFrameContext,
} from '@/components/shell/sidebar-frame';
import { cn } from '@/lib/utils';

/**
 * Sidebar do CONSOLE DA OPERADORA (OPS F2).
 *
 * Controlar as contas SaaS da Avecchi não é um menu dentro do ERP de um
 * cliente: sob `/app/ops` o AppLayout troca a casca inteira e o usuário
 * entra num console próprio — "mesma conta, consoles separados" (padrão
 * Google Admin/Stripe). A volta é explícita, pelo switcher do topo.
 *
 * Reaproveita a casca (`SidebarFrame`: coluna fixa, drawer mobile, Ctrl+B
 * via useUiStore) e o `NavLink` do ERP — o que diferencia é a identidade:
 * wordmark com a tag "Operadora" e o fio de gradiente da marca sob o topo.
 */
export function OpsSidebar() {
  return <SidebarFrame>{(ctx) => <OpsSidebarInner {...ctx} />}</SidebarFrame>;
}

function OpsSidebarInner({ mini, onToggleMini, onClose, showClose }: SidebarFrameContext) {
  const pathname = usePathname();
  const access = useNavAccess();
  const { isLoading: permsLoading } = usePermission();

  const activeHref = useMemo(() => resolveActiveHref(pathname), [pathname]);

  // Mesmo filtro fail-closed do menu do ERP (#351): sem a permissão
  // carregada, item nenhum aparece.
  const sections = useMemo(
    () =>
      OPS_NAV.map((s) => ({
        ...s,
        items: s.items.filter((it) => navItemAllowed(it, access)),
      })).filter((s) => s.items.length > 0),
    [access],
  );

  return (
    <div className="flex h-full flex-col">
      {/* ─── Topo: marca da OPERADORA (não a do ERP do tenant) ─── */}
      <div
        className={cn(
          'flex h-14 items-center border-b border-line',
          mini ? 'justify-center px-2' : 'gap-2 px-4',
        )}
      >
        {mini ? (
          <Image
            src="/brand/logo.png"
            alt="Avecchi Operadora"
            width={287}
            height={299}
            className="h-6 w-auto"
          />
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            <AvecchiWordmark tone="auto" className="shrink-0 text-[17px]" />
            {/* Tag discreta no accent da marca (teal) — o console é da
                Avecchi, o indigo segue sendo a tinta do produto */}
            <span className="shrink-0 whitespace-nowrap rounded-full bg-accent-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-700 dark:bg-accent-400/[0.14] dark:text-accent-300">
              Operadora
            </span>
          </span>
        )}
        {showClose ? (
          <button
            onClick={onClose}
            aria-label="Fechar menu"
            className="rounded-lg p-1.5 text-content-muted transition-colors hover:bg-neutral-100 hover:text-content dark:hover:bg-neutral-800"
          >
            <X size={18} />
          </button>
        ) : (
          onToggleMini && (
            <button
              onClick={onToggleMini}
              aria-label={mini ? 'Expandir menu' : 'Recolher menu'}
              title={mini ? 'Expandir (Ctrl+B)' : 'Recolher (Ctrl+B)'}
              className={cn(
                'rounded-lg p-1.5 text-content-muted transition-colors hover:bg-neutral-100 hover:text-content dark:hover:bg-neutral-800',
                mini && 'hidden',
              )}
            >
              <PanelLeftClose size={18} />
            </button>
          )
        )}
      </div>
      {/* Fio de gradiente da marca: o sinal silencioso de "você está no
          console da Avecchi", visível inclusive no modo mini */}
      <div aria-hidden className="h-px shrink-0 bg-brand-gradient opacity-70" />

      {/* Botão expandir (visível só no modo mini) */}
      {mini && onToggleMini && (
        <button
          onClick={onToggleMini}
          aria-label="Expandir menu"
          title="Expandir (Ctrl+B)"
          className="mx-auto mt-2 rounded-lg p-1.5 text-content-muted transition-colors hover:bg-neutral-100 hover:text-content dark:hover:bg-neutral-800"
        >
          <PanelLeft size={18} />
        </button>
      )}

      {/* OPS F2 (feedback do Claudio): SEM switcher "Voltar ao ERP" aqui —
          era saída acidental do console. A volta pro ERP do próprio usuário
          mora no menu do avatar ("Ir para o meu ERP"); a entrada nos ERPs
          dos CLIENTES é o "Entrar no ERP" de cada conta. */}

      {/* ─── Navegação do console ─── */}
      <nav className="avequi-scroll flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {permsLoading ? (
          <OpsNavSkeleton mini={mini} />
        ) : (
          sections.map((section) => (
            <div key={section.key} className="space-y-0.5">
              {section.title && !mini && (
                <p className="px-3 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-content-muted">
                  {section.title}
                </p>
              )}
              {section.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={item.href === activeHref}
                  mini={mini}
                  onNavigate={onClose}
                />
              ))}
            </div>
          ))
        )}
      </nav>

      <SidebarVersionFooter mini={mini} />
    </div>
  );
}

/** Esqueleto durante o load de /auth/me/permissions — mesmo motivo do ERP
 *  (o menu é fail-closed e sem isto pisca "vazio"). */
function OpsNavSkeleton({ mini }: { mini: boolean }) {
  if (mini) {
    return (
      <div className="flex flex-col items-center gap-3 pt-1">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-6 w-6 rounded-lg" />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-1.5 pt-1">
      {['w-32', 'w-24', 'w-20', 'w-16'].map((w, i) => (
        <div key={i} className="flex items-center gap-2.5 px-3 py-1.5">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className={`h-3.5 ${w}`} />
        </div>
      ))}
    </div>
  );
}
