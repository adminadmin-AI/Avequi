'use client';

import Link from 'next/link';
import { Star } from 'lucide-react';
import type { NavItem } from '@/lib/nav-config';
import { cn } from '@/lib/utils';

/**
 * Item de menu da sidebar — extraído da `Sidebar` do ERP na OPS F2 para que
 * o console da operadora (`OpsSidebar`) herde EXATAMENTE o mesmo tratamento
 * visual (seleção por tinta alpha, accent na borda esquerda, modo mini).
 *
 * Favorito e contador são opcionais: o console da operadora não tem estrela
 * nem badges de pendência, e omitir as props remove os controles do markup.
 */
export function NavLink({
  item,
  active,
  mini,
  count = 0,
  isFavorite,
  onToggleFav,
  onNavigate,
  highlight,
}: {
  item: NavItem;
  active: boolean;
  mini: boolean;
  count?: number;
  isFavorite?: boolean;
  onToggleFav?: () => void;
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
        // Soft Surfaces: seleção por tinta alpha (não bloco sólido)
        active
          ? 'bg-brand-600/[0.08] font-medium text-brand-700 dark:bg-brand-400/[0.10] dark:text-brand-300'
          : 'text-content-secondary hover:bg-neutral-500/[0.08]',
      )}
    >
      {/* left border accent quando ativo */}
      {active && (
        <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand-600 duration-flow animate-in fade-in slide-in-from-left-1 dark:bg-brand-400" />
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
          {onToggleFav && (
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
          )}
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
