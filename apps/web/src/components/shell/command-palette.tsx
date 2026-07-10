'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { CornerDownLeft, History, Keyboard, Moon, Search, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { flatNav, QUICK_ACTIONS } from '@/lib/nav-config';
import { useNavAccess } from '@/hooks/use-permission';
import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';

interface Entry {
  id: string;
  label: string;
  icon: LucideIcon;
  group: 'Recentes' | 'Ações' | 'Navegação';
  href?: string;
  action?: () => void;
}

export const RECENT_PAGES_KEY = 'avequi:recent-pages';

/**
 * Busca fuzzy simples (#325): match por inclusão OU subsequência
 * ("prd" acha "Produtos"). Inclusões rankeiam antes das subsequências.
 */
function fuzzyScore(label: string, q: string): number {
  const l = label.toLowerCase();
  if (l.includes(q)) return 2;
  let i = 0;
  for (const ch of l) {
    if (ch === q[i]) i += 1;
    if (i === q.length) return 1;
  }
  return 0;
}

/** Command palette estilo Raycast/Linear (#305, upgrades #325). Ctrl+K. */
export function CommandPalette() {
  const router = useRouter();
  const access = useNavAccess();
  const { commandOpen, setCommandOpen, setShortcutsOpen } = useUiStore();
  const { resolvedTheme, setTheme } = useTheme();

  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isDark = resolvedTheme === 'dark';

  const entries = useMemo<Entry[]>(() => {
    const nav = flatNav(access);
    const navEntries: Entry[] = nav.map((it) => ({
      id: 'nav:' + it.href,
      label: it.label,
      href: it.href,
      icon: it.icon,
      group: 'Navegação',
    }));
    // recentes: últimas páginas visitadas que existem no nav (máx. 5)
    const recentEntries: Entry[] = recents
      .map((href) => nav.find((n) => n.href === href))
      .filter((n): n is NonNullable<typeof n> => !!n)
      .slice(0, 5)
      .map((it) => ({
        id: 'rec:' + it.href,
        label: it.label,
        href: it.href,
        icon: History,
        group: 'Recentes',
      }));
    const actionEntries: Entry[] = [
      ...QUICK_ACTIONS.map((a) => ({
        id: 'act:' + a.label,
        label: a.label,
        href: a.href,
        icon: a.icon,
        group: 'Ações' as const,
      })),
      {
        id: 'act:theme',
        label: isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro',
        icon: isDark ? Sun : Moon,
        group: 'Ações',
        action: () => setTheme(isDark ? 'light' : 'dark'),
      },
      {
        id: 'act:shortcuts',
        label: 'Atalhos de teclado',
        icon: Keyboard,
        group: 'Ações',
        action: () => setShortcutsOpen(true),
      },
    ];
    return [...recentEntries, ...actionEntries, ...navEntries];
  }, [access, recents, isDark, setTheme, setShortcutsOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries
      .map((e) => ({ e, score: fuzzyScore(e.label, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.e);
  }, [entries, query]);

  // Reset ao abrir/fechar + carrega recentes
  useEffect(() => {
    if (commandOpen) {
      setQuery('');
      setActiveIdx(0);
      try {
        setRecents(JSON.parse(localStorage.getItem(RECENT_PAGES_KEY) ?? '[]'));
      } catch {
        setRecents([]);
      }
      // foca no próximo tick (após render do overlay)
      const t = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(t);
    }
  }, [commandOpen]);

  useEffect(() => setActiveIdx(0), [query]);

  // Mantém o item ativo visível
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!commandOpen) return null;

  function select(entry?: Entry) {
    if (!entry) return;
    setCommandOpen(false);
    if (entry.action) entry.action();
    else if (entry.href) router.push(entry.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      select(filtered[activeIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setCommandOpen(false);
    }
  }

  let runningIdx = -1;
  let lastGroup = '';

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
      <button
        aria-label="Fechar"
        className="absolute inset-0 bg-surface-overlay backdrop-blur-sm duration-fast animate-in fade-in"
        onClick={() => setCommandOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface-elevated shadow-elevation-5 duration-fast animate-in fade-in zoom-in-95"
        onKeyDown={onKeyDown}
      >
        {/* Busca */}
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={18} className="shrink-0 text-content-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar páginas e ações…"
            className="h-12 flex-1 bg-transparent text-sm text-content placeholder:text-content-muted focus:outline-none"
          />
          <kbd className="rounded border border-line bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-content-muted">
            Esc
          </kbd>
        </div>

        {/* Resultados */}
        <div ref={listRef} className="avequi-scroll max-h-[52vh] overflow-y-auto p-2">
          {filtered.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-content-muted">
              Nenhum resultado para “{query}”.
            </p>
          )}
          {filtered.map((entry) => {
            runningIdx += 1;
            const idx = runningIdx;
            const active = idx === activeIdx;
            const showGroup = entry.group !== lastGroup;
            lastGroup = entry.group;
            const Icon = entry.icon;
            return (
              <div key={entry.id}>
                {showGroup && (
                  <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
                    {entry.group}
                  </p>
                )}
                <button
                  data-idx={idx}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => select(entry)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                    active ? 'bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-300' : 'text-content-secondary',
                  )}
                >
                  <Icon size={16} className={active ? 'text-brand-600 dark:text-brand-300' : 'text-content-muted'} />
                  <span className="flex-1 text-left">{entry.label}</span>
                  {active && <CornerDownLeft size={14} className="text-content-muted" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
