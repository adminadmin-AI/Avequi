'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * PageHeader — refinado na F3.2 (#317), retrocompatível.
 *
 * Novos slots (todos opcionais):
 *  - `backHref`: seta de voltar à esquerda do título (detail pages)
 *  - `meta`: linha de metadados sob a descrição (badges, status, datas)
 *  - `tabs`: navegação por abas integrada sob o header (ex.: <Tabs/>)
 */
export function PageHeader({
  title,
  description,
  actions,
  backHref,
  meta,
  tabs,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  backHref?: string;
  meta?: React.ReactNode;
  tabs?: React.ReactNode;
}) {
  return (
    // Soft Surfaces: o sistema respira — mais espaço entre título e conteúdo
    <div className={cn('mb-8', tabs && 'mb-5')}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {backHref && (
            <Link
              href={backHref}
              aria-label="Voltar"
              className="mt-1 rounded-md p-1 text-content-muted transition-colors hover:bg-neutral-100 hover:text-content dark:hover:bg-neutral-800"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-content">{title}</h1>
            {description && <p className="mt-1 text-sm text-content-secondary">{description}</p>}
            {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {tabs && <div className="mt-4">{tabs}</div>}
    </div>
  );
}
