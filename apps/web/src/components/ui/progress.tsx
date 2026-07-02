'use client';

import { cn } from '@/lib/utils';

/**
 * Progress — F2.6 (#312)
 *
 * Barra de progresso determinada (value 0-100) ou indeterminada (omitir
 * value — anima em loop, para operações sem percentual conhecido).
 */

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0-100. Omitir para modo indeterminado. */
  value?: number;
  size?: 'sm' | 'md';
  /** Cor da barra (classe bg-*). Default brand. */
  barClassName?: string;
}

export function Progress({
  value,
  size = 'md',
  barClassName,
  className,
  ...props
}: ProgressProps) {
  const indeterminate = value == null;
  const clamped = indeterminate ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : clamped}
      className={cn(
        'relative w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800',
        size === 'sm' ? 'h-1' : 'h-2',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'h-full rounded-full bg-brand-600 dark:bg-brand-500',
          indeterminate
            ? 'w-1/3 animate-progress-indeterminate'
            : 'transition-[width] duration-flow ease-precise',
          barClassName,
        )}
        style={indeterminate ? undefined : { width: `${clamped}%` }}
      />
    </div>
  );
}
