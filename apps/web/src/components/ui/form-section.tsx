'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * FormSection — F3.1 (#316)
 *
 * Agrupa campos de formulários longos com título, descrição e borda sutil.
 *  - `collapsible`: seção recolhível (útil em forms extensos)
 *  - `columns`: grid 1 coluna no mobile e N no desktop (default 2)
 *  - Espaçamento consistente: empilhe FormSections com `space-y-6`/`gap-8`
 */

export interface FormSectionProps {
  title: string;
  description?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** colunas no desktop (mobile é sempre 1) */
  columns?: 1 | 2 | 3;
  children: React.ReactNode;
  className?: string;
}

const COLS: Record<1 | 2 | 3, string> = {
  1: '',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
};

export function FormSection({
  title,
  description,
  collapsible,
  defaultOpen = true,
  columns = 2,
  children,
  className,
}: FormSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = !collapsible || open;

  return (
    <fieldset className={cn('rounded-xl border border-line', className)}>
      <legend className="sr-only">{title}</legend>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-start justify-between gap-3 px-5 py-4 text-left"
        >
          <SectionHeading title={title} description={description} />
          <ChevronDown
            className={cn(
              'mt-0.5 h-4 w-4 shrink-0 text-content-muted transition-transform duration-fast',
              open && 'rotate-180',
            )}
          />
        </button>
      ) : (
        <div className="px-5 pt-4">
          <SectionHeading title={title} description={description} />
        </div>
      )}
      {expanded && (
        <div className={cn('grid grid-cols-1 gap-4 px-5 pb-5', collapsible ? 'pt-0' : 'pt-4', COLS[columns])}>
          {children}
        </div>
      )}
    </fieldset>
  );
}

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <p className="text-sm font-semibold text-content">{title}</p>
      {description && <p className="mt-0.5 text-caption text-content-muted">{description}</p>}
    </div>
  );
}
