'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CornerDownLeft, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { flatNav, QUICK_ACTIONS } from '@/lib/nav-config';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';

interface Entry {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  group: 'Navegação' | 'Ações';
}

/** Command palette estilo Raycast/Linear (#305). Abre com Ctrl+K. */
export function CommandPalette() {
  const router = useRouter();
  const role = useAuthStore((s) => s.user?.role);
  const { commandOpen, setCommandOpen } = useUiStore();

  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const entries = useMemo<Entry[]>(() => {
    const nav: Entry[] = flatNav(role).map((it) => ({
      id: 'nav:' + it.href,
      label: it.label,
      href: it.href,
      icon: it.icon,
      group: 'Navegação',
    }));
    const actions: Entry[] = QUICK_ACTIONS.map((a) => ({
      id: 'act:' + a.label,
      label: a.label,
      href: a.href,
      icon: a.icon,
      group: 'Ações',
    }));
    return [...actions, ...nav];
  }, [role]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.label.toLowerCase().includes(q));
  }, [entries, query]);

  // Reset ao abrir/fechar
  useEffect(() => {
    if (commandOpen) {
      setQuery('');
      setActiveIdx(0);
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
    router.push(entry.href);
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
