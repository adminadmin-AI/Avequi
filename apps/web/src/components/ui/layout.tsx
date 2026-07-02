'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Primitivos de layout de página — F3.2 (#317)
 *
 * Padroniza containers e grids que hoje cada página implementa ad-hoc:
 *  - PageContainer: largura máxima 1280px centrada (ou fullWidth)
 *  - KpiGrid: linha de KPIs auto-fit minmax(240px, 1fr)
 *  - CardGrid: grade de cards auto-fit minmax(320px, 1fr)
 *  - ContentWithSidebar: conteúdo 2fr + sidebar 1fr (empilha no mobile)
 *  - Section: bloco de página com título/descrição/divider, collapsible
 */

// ─── PageContainer ────────────────────────────────────────────────────────────

export function PageContainer({
  fullWidth,
  className,
  children,
}: {
  /** sem restrição de largura (tabelas largas, dashboards) */
  fullWidth?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('mx-auto w-full', !fullWidth && 'max-w-[1280px]', className)}>
      {children}
    </div>
  );
}

// ─── Grids ────────────────────────────────────────────────────────────────────

/** Linha de KPIs: quantos couberem, mínimo 240px por card. */
export function KpiGrid({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]', className)}>
      {children}
    </div>
  );
}

/** Grade de cards: quantos couberem, mínimo 320px por card. */
export function CardGrid({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]', className)}>
      {children}
    </div>
  );
}

/** Conteúdo principal (2fr) + sidebar (1fr); empilha em telas menores. */
export function ContentWithSidebar({
  sidebar,
  side = 'right',
  className,
  children,
}: {
  sidebar: React.ReactNode;
  side?: 'left' | 'right';
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'grid gap-6',
        side === 'right' ? 'lg:grid-cols-[2fr_1fr]' : 'lg:grid-cols-[1fr_2fr]',
        className,
      )}
    >
      {side === 'left' && <aside className="min-w-0">{sidebar}</aside>}
      <div className="min-w-0">{children}</div>
      {side === 'right' && <aside className="min-w-0">{sidebar}</aside>}
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

/**
 * Bloco de página com título/descrição. Diferente do FormSection (fieldset
 * com borda p/ formulários), a Section é leve: divider superior opcional,
 * sem borda em volta — para separar áreas de conteúdo numa página.
 */
export function Section({
  title,
  description,
  collapsible,
  defaultOpen = true,
  divider = true,
  actions,
  className,
  children,
}: {
  title: string;
  description?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** divider superior (border-t) separando da área anterior */
  divider?: boolean;
  /** ações à direita do título (botões, filtros) */
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = !collapsible || open;

  const heading = (
    <div className="flex flex-1 items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-content">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-content-secondary">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );

  return (
    <section className={cn(divider && 'border-t border-line pt-6', className)}>
      {collapsible ? (
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-1 rounded-md p-0.5 text-content-muted transition-colors hover:text-content"
          >
            <ChevronDown
              className={cn('h-4 w-4 transition-transform duration-fast', !open && '-rotate-90')}
            />
          </button>
          {heading}
        </div>
      ) : (
        heading
      )}
      {expanded && <div className="mt-4">{children}</div>}
    </section>
  );
}
