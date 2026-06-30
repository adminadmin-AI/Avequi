'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Home } from 'lucide-react';
import { buildBreadcrumbs } from '@/lib/nav-config';
import { cn } from '@/lib/utils';

/** Breadcrumbs auto-gerados a partir do pathname (#305). */
export function Breadcrumbs() {
  const pathname = usePathname();
  const crumbs = buildBreadcrumbs(pathname);

  // O primeiro crumb (/app) vira o ícone Home.
  const rest = crumbs.slice(1);

  return (
    <nav aria-label="breadcrumb" className="flex min-w-0 items-center gap-1 text-caption">
      <Link
        href="/app"
        className="flex items-center rounded p-1 text-content-muted transition-colors hover:text-content"
        aria-label="Início"
      >
        <Home size={15} />
      </Link>
      {rest.map((crumb, i) => {
        const last = i === rest.length - 1;
        return (
          <span key={crumb.href} className="flex min-w-0 items-center gap-1">
            <ChevronRight size={13} className="shrink-0 text-content-muted" />
            {last || crumb.isId ? (
              <span
                className={cn('truncate', last ? 'font-medium text-content' : 'text-content-secondary')}
                title={crumb.label}
              >
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.href}
                className="truncate text-content-secondary transition-colors hover:text-content"
                title={crumb.label}
              >
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
