'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import Link from 'next/link';
import { Info, type LucideIcon } from 'lucide-react';
import { Card, type CardProps } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Chrome comum dos widgets do Workspace — F0.
 *
 * Usa o <Card> do design system (que já é dark-mode correto via tokens
 * semânticos — o comentário "#309 Card hardcoded light" da Home antiga estava
 * obsoleto), com os paddings px-5 do antigo Panel local para paridade visual.
 *
 * Hierarquia visual (auditoria UX 30/07): três níveis com a MESMA grid,
 * mesmo padding e mesmo raio — a diferença é só de presença da superfície:
 *  - nível 1 (atenção): Card default + accent semântico quando há alarme;
 *  - nível 2 (trabalho): Card default;
 *  - nível 3 (auxiliar: atalhos e gráficos de contexto): `quiet` — outlined,
 *    sem sombra, a superfície recua e deixa os níveis acima falarem primeiro.
 *
 * Todo widget é embrulhado em ErrorBoundary: um widget quebrado degrada para
 * uma linha discreta, nunca derruba os vizinhos.
 */

interface WidgetErrorBoundaryProps {
  children: ReactNode;
}

class WidgetErrorBoundary extends Component<WidgetErrorBoundaryProps, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[workspace] widget crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <p className="flex items-center gap-2 py-4 text-caption text-content-muted">
          <Info size={14} /> Não foi possível carregar este bloco.
        </p>
      );
    }
    return this.props.children;
  }
}

export function WidgetFrame({
  title,
  action,
  badge,
  quiet,
  accent,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  /** Contador discreto ao lado do título (ex.: nº de pendências). */
  badge?: number;
  /** Nível 3 (auxiliar): superfície outlined sem sombra — recua na hierarquia. */
  quiet?: boolean;
  /** Alarme real no widget inteiro (ex.: Antonella com insight crítico). */
  accent?: CardProps['accent'];
  children: ReactNode;
}) {
  // h-full: no grid da Home, cards da mesma linha compartilham a altura —
  // o card mais baixo estica a superfície em vez de deixar buraco embaixo.
  // Hover: elevação sobe UM degrau (elevation-2), nunca mais que isso.
  return (
    <Card
      variant={quiet ? 'outlined' : 'default'}
      accent={accent}
      className={cn(
        'h-full',
        !quiet && 'transition-shadow duration-flow ease-flow hover:shadow-elevation-2',
      )}
    >
      <div className="flex items-center justify-between gap-2 px-5 pb-1 pt-5">
        <h3 className="flex items-baseline gap-2 text-title text-content">
          {title}
          {badge != null && badge > 0 && (
            <span className="rounded-full bg-neutral-500/10 px-2 py-0.5 text-helper font-medium tabular-nums text-content-secondary">
              {badge}
            </span>
          )}
        </h3>
        {action}
      </div>
      <div className="px-5 pb-5 pt-3">
        <WidgetErrorBoundary>{children}</WidgetErrorBoundary>
      </div>
    </Card>
  );
}

/** Widgets sem superfície (saudação, KPIs de-boxed) — só o ErrorBoundary. */
export function ChromelessWidget({ children }: { children: ReactNode }) {
  return <WidgetErrorBoundary>{children}</WidgetErrorBoundary>;
}

/** Link de ação do header ("ver fluxo", "abrir WMS") — um só estilo em todos. */
export function WidgetAction({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="shrink-0 text-caption font-medium text-brand-600 transition-colors duration-micro hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
    >
      {children}
    </Link>
  );
}

// ─── Estados compartilhados ──────────────────────────────────────────────────

export function ChartSkeleton() {
  return (
    <div className="h-[240px] w-full animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800" />
  );
}

export function ListSkeleton() {
  return (
    <div className="space-y-3 py-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-3 flex-1 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      ))}
    </div>
  );
}

/**
 * Empty state padrão dos widgets — ilustração mínima (ícone em disco de tint),
 * título firme e uma linha de contexto. `tone="success"` é o "tudo em dia";
 * `neutral` é o "ainda sem dados". Nunca gráfico vazio, nunca linha solta.
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  tone = 'neutral',
  tall,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  tone?: 'neutral' | 'success';
  tall?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 text-center',
        tall ? 'h-[240px]' : 'py-6',
      )}
    >
      <span
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-full',
          tone === 'success' ? 'bg-success/10 text-success' : 'bg-neutral-500/10 text-content-muted',
        )}
      >
        <Icon size={18} strokeWidth={1.75} />
      </span>
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-content">{title}</p>
        {hint && <p className="mx-auto max-w-[36ch] text-caption text-content-muted">{hint}</p>}
      </div>
    </div>
  );
}

/** Placeholder de widget enquanto as permissões do usuário carregam. */
export function WidgetFrameSkeleton() {
  return (
    <Card>
      <div className="px-5 pb-1 pt-5">
        <div className="h-5 w-36 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
      </div>
      <div className="px-5 pb-5 pt-3">
        <ListSkeleton />
      </div>
    </Card>
  );
}
