'use client';

import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ErrorStateProps {
  title?: string;
  description?: string;
  error?: (Error & { digest?: string }) | null;
  /** callback de retry (ex.: reset() do error boundary do Next) */
  onRetry?: () => void;
  /** false = variante inline (cards/widgets); default = página cheia */
  fullPage?: boolean;
  className?: string;
}

/**
 * Fallback visual elegante para erros (F4.3 / #320). Usado pelos
 * error.tsx (route error boundaries) e disponível para uso inline em
 * cards/widgets que falhem de forma independente. Dark-mode aware.
 */
export function ErrorState({
  title = 'Algo deu errado',
  description = 'Ocorreu um erro inesperado ao carregar esta área. Tente novamente.',
  error,
  onRetry,
  fullPage = true,
  className,
}: ErrorStateProps) {
  const isDev = process.env.NODE_ENV === 'development';
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        fullPage
          ? 'min-h-[60vh] px-6 py-10'
          : 'rounded-xl border border-line bg-surface px-4 py-10',
        className,
      )}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-danger">
        <AlertTriangle size={26} />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-content">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-content-secondary">{description}</p>

      {isDev && error?.message && (
        <pre className="mt-4 max-h-48 w-full max-w-xl overflow-auto rounded-lg bg-neutral-900 px-3 py-2 text-left text-[11px] leading-relaxed text-neutral-100">
          {error.message}
          {error.stack ? '\n\n' + error.stack : ''}
        </pre>
      )}

      {onRetry && (
        <Button
          variant="secondary"
          onClick={onRetry}
          leftIcon={<RotateCw size={16} />}
          className="mt-5"
        >
          Tentar novamente
        </Button>
      )}
    </div>
  );
}
