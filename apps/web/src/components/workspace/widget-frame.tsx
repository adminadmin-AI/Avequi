'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Card } from '@/components/ui/card';

/**
 * Chrome comum dos widgets do Workspace — F0.
 *
 * Usa o <Card> do design system (que já é dark-mode correto via tokens
 * semânticos — o comentário "#309 Card hardcoded light" da Home antiga estava
 * obsoleto), com os paddings px-5 do antigo Panel local para paridade visual.
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
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-2 px-5 pb-1 pt-5">
        <h3 className="text-title text-content">{title}</h3>
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

// ─── Estados compartilhados (mesmo visual da Home antiga) ────────────────────

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

export function EmptyContent({ label }: { label: string }) {
  return (
    <div className="flex h-[240px] items-center justify-center text-center text-caption text-content-muted">
      {label}
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
