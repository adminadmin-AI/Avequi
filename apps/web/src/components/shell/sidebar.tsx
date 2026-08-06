'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, PanelLeftClose, PanelLeft, Search, X } from 'lucide-react';
import { NAV, flatNav, navItemAllowed, resolveActiveHref, type NavItem } from '@/lib/nav-config';
import { useNavAccess, usePermission } from '@/hooks/use-permission';
import { Skeleton } from '@/components/ui/skeleton';
import { useSidebarCounts } from '@/hooks/use-sidebar-counts';
import { useSidebarPrefs } from '@/hooks/use-sidebar-prefs';
import { NavLink } from '@/components/shell/nav-link';
import { SidebarFrame, SidebarVersionFooter } from '@/components/shell/sidebar-frame';
import Image from 'next/image';
import { AvecchiWordmark } from '@/components/auth/avecchi-wordmark';
import { cn } from '@/lib/utils';

export function Sidebar() {
  // A casca (coluna fixa + drawer mobile + Ctrl+B) é compartilhada com o
  // console da operadora desde a OPS F2 — ver sidebar-frame.tsx.
  return <SidebarFrame>{(ctx) => <SidebarInner {...ctx} />}</SidebarFrame>;
}

function SidebarInner({
  mini,
  onToggleMini,
  onClose,
  showClose,
}: {
  mini: boolean;
  onToggleMini?: () => void;
  onClose?: () => void;
  showClose?: boolean;
}) {
  const pathname = usePathname();
  const access = useNavAccess();
  const { isLoading: permsLoading } = usePermission();
  const counts = useSidebarCounts();

  // Favoritos e seções recolhidas seguem o LOGIN, não o navegador (#975)
  const { hydrated, favorites, collapsedSections, toggleFav, toggleSection } = useSidebarPrefs();
  const [search, setSearch] = useState('');

  const activeHref = useMemo(() => resolveActiveHref(pathname), [pathname]);

  const sections = useMemo(
    () =>
      NAV.map((s) => ({
        ...s,
        items: s.items.filter((it) => navItemAllowed(it, access)),
      })).filter((s) => s.items.length > 0),
    [access],
  );

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const groups: { key: string; title?: string; items: NavItem[] }[] = [];
    for (const section of NAV) {
      const titleMatch = section.title?.toLowerCase().includes(q) ?? false;
      const items = section.items.filter((it) => {
        if (!navItemAllowed(it, access)) return false;
        // casa pelo rótulo do item OU pelo título da seção (ex.: "Cadastros")
        return titleMatch || it.label.toLowerCase().includes(q);
      });
      if (items.length > 0) groups.push({ key: section.key, title: section.title, items });
    }
    return groups;
  }, [search, access]);

  const favItems = useMemo(() => {
    const all = flatNav(access);
    return favorites.map((h) => all.find((it) => it.href === h)).filter(Boolean) as NavItem[];
  }, [favorites, access]);

  return (
    <div className="flex h-full flex-col">
      {/* ─── Topo: marca + toggles ─── */}
      <div
        className={cn(
          'flex h-14 items-center border-b border-line',
          mini ? 'justify-center px-2' : 'gap-2.5 px-4',
        )}
      >
        {/* A marca é o atalho para o início — substitui o ícone de casinha que
            ficava nos breadcrumbs. No drawer do mobile também fecha o menu,
            senão o overlay fica aberto por cima da tela de destino. */}
        {mini ? (
          <Link
            href="/app"
            onClick={onClose}
            aria-label="Ir para o início"
            className="rounded-lg transition-opacity hover:opacity-80"
          >
            <Image
              src="/brand/logo.png"
              alt="Avecchi"
              width={287}
              height={299}
              className="h-6 w-auto"
            />
          </Link>
        ) : (
          <Link
            href="/app"
            onClick={onClose}
            aria-label="Ir para o início"
            className="flex flex-1 items-center rounded-lg transition-opacity hover:opacity-80"
          >
            <AvecchiWordmark tone="auto" className="text-[17px]" />
          </Link>
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

      {/* ─── Busca (oculta no mini) ─── */}
      {!mini && (
        <div className="px-3 pt-3">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-content-muted"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar no menu…"
              className="h-8 w-full rounded-lg bg-neutral-500/[0.045] pl-8 pr-7 text-[13px] text-content transition-colors duration-micro placeholder:text-content-muted hover:bg-neutral-500/[0.08] focus-ring"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                aria-label="Limpar busca"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-content-muted hover:text-content"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ─── Navegação ─── */}
      <nav className="avequi-scroll flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {/* Esqueleto enquanto as permissões carregam — o nav é fail-closed
            (#351) e sem isto o menu aparece "encolhido" por um instante */}
        {permsLoading ? (
          <NavSkeleton mini={mini} />
        ) : /* Resultados de busca (agrupados por seção) */
        searchResults ? (
          searchResults.length === 0 ? (
            <p className="px-3 py-2 text-caption text-content-muted">Nenhum item encontrado.</p>
          ) : (
            searchResults.map((section) => (
              <div key={'search-' + section.key}>
                {section.title && (
                  <p className="px-3 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-content-muted">
                    {section.title}
                  </p>
                )}
                <div className="space-y-0.5">
                  {section.items.map((item) => (
                    <NavLink
                      key={item.href}
                      item={item}
                      active={item.href === activeHref}
                      mini={false}
                      count={counts[item.href] ?? 0}
                      isFavorite={favorites.includes(item.href)}
                      onToggleFav={() => toggleFav(item.href)}
                      onNavigate={onClose}
                      highlight={search}
                    />
                  ))}
                </div>
              </div>
            ))
          )
        ) : (
          <>
            {/* Favoritos */}
            {!mini && hydrated && favItems.length > 0 && (
              <div>
                <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
                  Favoritos
                </p>
                <div className="space-y-0.5">
                  {favItems.map((item) => (
                    <NavLink
                      key={'fav-' + item.href}
                      item={item}
                      active={item.href === activeHref}
                      mini={false}
                      count={counts[item.href] ?? 0}
                      isFavorite
                      onToggleFav={() => toggleFav(item.href)}
                      onNavigate={onClose}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Seções */}
            {sections.map((section) => {
              const collapsed = collapsedSections.includes(section.key);
              const sectionActive = section.items.some((it) => it.href === activeHref);
              const open = !collapsed || sectionActive; // seção ativa sempre aberta
              return (
                <div key={section.key}>
                  {section.title && !mini && (
                    <button
                      onClick={() => toggleSection(section.key)}
                      className="group flex w-full items-center gap-1 px-3 pb-1.5 pt-0.5 text-[10px] font-medium uppercase tracking-wider text-content-muted transition-colors hover:text-content-secondary"
                    >
                      <span className="flex-1 text-left">{section.title}</span>
                      <ChevronDown
                        size={13}
                        className={cn(
                          'transition-transform duration-fast',
                          open ? 'rotate-0' : '-rotate-90',
                        )}
                      />
                    </button>
                  )}
                  {(open || mini) && (
                    <div className="space-y-0.5">
                      {section.items.map((item) => (
                        <NavLink
                          key={item.href}
                          item={item}
                          active={item.href === activeHref}
                          mini={mini}
                          count={counts[item.href] ?? 0}
                          isFavorite={favorites.includes(item.href)}
                          onToggleFav={() => toggleFav(item.href)}
                          onNavigate={onClose}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </nav>

      {/* ─── Footer — dieta F2: só a versão (a marca já vive no topo) ─── */}
      <SidebarVersionFooter mini={mini} />
    </div>
  );
}

/**
 * Esqueleto do menu durante o load de /auth/me/permissions — preserva o
 * layout (sem CLS) e evita a impressão de "menu encolhido" do fail-closed.
 * Larguras variadas imitam rótulos reais; o primitivo Skeleton já cuida de
 * dark-mode e prefers-reduced-motion.
 */
function NavSkeleton({ mini }: { mini: boolean }) {
  if (mini) {
    return (
      <div className="flex flex-col items-center gap-3 pt-1">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-6 w-6 rounded-lg" />
        ))}
      </div>
    );
  }
  const groups: string[][] = [
    ['w-24', 'w-20', 'w-28', 'w-16'],
    ['w-28', 'w-20', 'w-24'],
    ['w-20', 'w-24', 'w-16', 'w-28'],
  ];
  return (
    <div className="space-y-5 pt-1">
      {groups.map((rows, g) => (
        <div key={g} className="space-y-1.5">
          <Skeleton className="ml-3 mb-2 h-3 w-20" />
          {rows.map((w, i) => (
            <div key={i} className="flex items-center gap-2.5 px-3 py-1.5">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className={`h-3.5 ${w}`} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
