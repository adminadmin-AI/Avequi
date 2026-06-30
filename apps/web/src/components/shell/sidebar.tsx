'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, PanelLeftClose, PanelLeft, Search, Star, X } from 'lucide-react';
import { NAV, flatNav, isActive, type NavItem } from '@/lib/nav-config';
import { useSidebarCounts } from '@/hooks/use-sidebar-counts';
import { useCurrentCompany } from '@/hooks/use-current-company';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { BrandMark } from '@/components/brand-mark';
import { cn } from '@/lib/utils';

const FAV_KEY = 'avequi:sidebar:favorites';
const COLLAPSED_SECTIONS_KEY = 'avequi:sidebar:collapsed-sections';
const APP_VERSION = 'v1.0';

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebarCollapsed, mobileNavOpen, setMobileNavOpen } =
    useUiStore();

  return (
    <>
      {/* Desktop — fixa */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-20 hidden flex-col border-r border-line bg-surface transition-[width] duration-flow ease-precise lg:flex',
          sidebarCollapsed ? 'w-16' : 'w-60',
        )}
      >
        <SidebarInner
          mini={sidebarCollapsed}
          onToggleMini={toggleSidebarCollapsed}
        />
      </aside>

      {/* Mobile — drawer overlay */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Fechar menu"
            className="absolute inset-0 bg-surface-overlay backdrop-blur-sm duration-fast animate-in fade-in"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-line bg-surface duration-flow animate-in slide-in-from-left">
            <SidebarInner mini={false} onClose={() => setMobileNavOpen(false)} showClose />
          </aside>
        </div>
      )}
    </>
  );
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
  const role = useAuthStore((s) => s.user?.role);
  const counts = useSidebarCounts();
  const companyName = useCurrentCompany();

  const [hydrated, setHydrated] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    try {
      setFavorites(JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]'));
      setCollapsedSections(JSON.parse(localStorage.getItem(COLLAPSED_SECTIONS_KEY) ?? '[]'));
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  function persistFav(next: string[]) {
    setFavorites(next);
    localStorage.setItem(FAV_KEY, JSON.stringify(next));
  }
  function toggleFav(href: string) {
    persistFav(favorites.includes(href) ? favorites.filter((h) => h !== href) : [...favorites, href]);
  }
  function toggleSection(key: string) {
    const next = collapsedSections.includes(key)
      ? collapsedSections.filter((k) => k !== key)
      : [...collapsedSections, key];
    setCollapsedSections(next);
    localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify(next));
  }

  const sections = useMemo(
    () =>
      NAV.map((s) => ({
        ...s,
        items: s.items.filter((it) => !it.roles || (role ? it.roles.includes(role) : false)),
      })).filter((s) => s.items.length > 0),
    [role],
  );

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return flatNav(role).filter((it) => it.label.toLowerCase().includes(q));
  }, [search, role]);

  const favItems = useMemo(() => {
    const all = flatNav(role);
    return favorites.map((h) => all.find((it) => it.href === h)).filter(Boolean) as NavItem[];
  }, [favorites, role]);

  return (
    <div className="flex h-full flex-col">
      {/* ─── Topo: marca + toggles ─── */}
      <div
        className={cn(
          'flex h-14 items-center border-b border-line',
          mini ? 'justify-center px-2' : 'gap-2.5 px-4',
        )}
      >
        <BrandMark size={26} />
        {!mini && (
          <span className="flex-1 text-base font-semibold tracking-tight text-content">Avequi</span>
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
              className="h-9 w-full rounded-lg border border-line bg-surface-secondary pl-8 pr-7 text-sm text-content placeholder:text-content-muted focus-ring"
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
        {/* Resultados de busca (modo plano) */}
        {searchResults ? (
          <div className="space-y-0.5">
            {searchResults.length === 0 && (
              <p className="px-3 py-2 text-caption text-content-muted">Nenhum item encontrado.</p>
            )}
            {searchResults.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isActive(pathname, item.href)}
                mini={false}
                count={counts[item.href] ?? 0}
                isFavorite={favorites.includes(item.href)}
                onToggleFav={() => toggleFav(item.href)}
                onNavigate={onClose}
                highlight={search}
              />
            ))}
          </div>
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
                      active={isActive(pathname, item.href)}
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
              const sectionActive = section.items.some((it) => isActive(pathname, it.href));
              const open = !collapsed || sectionActive; // seção ativa sempre aberta
              return (
                <div key={section.key}>
                  {section.title && !mini && (
                    <button
                      onClick={() => toggleSection(section.key)}
                      className="group flex w-full items-center gap-1 px-3 pb-1.5 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-content-muted transition-colors hover:text-content-secondary"
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
                          active={isActive(pathname, item.href)}
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

      {/* ─── Footer ─── */}
      <div className={cn('border-t border-line px-3 py-2.5', mini && 'px-2 text-center')}>
        {mini ? (
          <p className="text-helper text-content-muted">{APP_VERSION}</p>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-caption text-content-secondary" title={companyName ?? ''}>
              {companyName ?? 'Avequi ERP'}
            </span>
            <span className="shrink-0 text-helper text-content-muted">{APP_VERSION}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function NavLink({
  item,
  active,
  mini,
  count,
  isFavorite,
  onToggleFav,
  onNavigate,
  highlight,
}: {
  item: NavItem;
  active: boolean;
  mini: boolean;
  count: number;
  isFavorite: boolean;
  onToggleFav: () => void;
  onNavigate?: () => void;
  highlight?: string;
}) {
  const { icon: Icon, label, href } = item;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      title={mini ? label : undefined}
      className={cn(
        'group relative flex items-center rounded-lg text-sm transition-colors duration-fast',
        mini ? 'h-10 justify-center' : 'gap-2.5 px-3 py-2',
        active
          ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-600/15 dark:text-brand-300'
          : 'text-content-secondary hover:bg-neutral-100 dark:hover:bg-neutral-800',
      )}
    >
      {/* left border accent quando ativo */}
      {active && (
        <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand-600 dark:bg-brand-400" />
      )}
      <Icon
        size={17}
        className={cn('shrink-0', active ? 'text-brand-600 dark:text-brand-300' : 'text-content-muted')}
      />
      {!mini && (
        <>
          <span className="flex-1 truncate">
            {highlight ? <Highlighted text={label} term={highlight} /> : label}
          </span>
          {count > 0 && (
            <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white duration-fast animate-in zoom-in">
              {count > 99 ? '99+' : count}
            </span>
          )}
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleFav();
            }}
            aria-label={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
            className={cn(
              'rounded p-0.5 transition-opacity',
              isFavorite
                ? 'text-warning opacity-100'
                : 'text-content-muted opacity-0 hover:text-warning group-hover:opacity-100',
            )}
          >
            <Star size={14} className={isFavorite ? 'fill-warning' : ''} />
          </button>
        </>
      )}
      {/* badge compacto no modo mini */}
      {mini && count > 0 && (
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger" />
      )}
    </Link>
  );
}

function Highlighted({ text, term }: { text: string; term: string }) {
  const q = term.trim();
  if (!q) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-brand-100 text-brand-700 dark:bg-brand-600/30 dark:text-brand-200">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}
