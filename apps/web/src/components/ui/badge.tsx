import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const COLORS: Record<BadgeVariant, { soft: string; outline: string; dot: string }> = {
  neutral: {
    soft: 'bg-neutral-100 text-content-secondary dark:bg-neutral-800 dark:text-content-secondary',
    outline: 'border border-line text-content-secondary',
    dot: 'bg-neutral-400',
  },
  brand: {
    soft: 'bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-300',
    outline: 'border border-brand-200 text-brand-700 dark:border-brand-600/40 dark:text-brand-300',
    dot: 'bg-brand-500',
  },
  success: {
    soft: 'bg-success-50 text-success-700 dark:bg-success-900/20 dark:text-success-400',
    outline: 'border border-success-200 text-success-700 dark:border-success-900 dark:text-success-400',
    dot: 'bg-success',
  },
  warning: {
    soft: 'bg-warning-50 text-warning-700 dark:bg-warning-900/20 dark:text-warning-400',
    outline: 'border border-warning-200 text-warning-700 dark:border-warning-900 dark:text-warning-400',
    dot: 'bg-warning',
  },
  danger: {
    soft: 'bg-danger-50 text-danger-700 dark:bg-danger-900/20 dark:text-danger-400',
    outline: 'border border-danger-200 text-danger-700 dark:border-danger-900 dark:text-danger-400',
    dot: 'bg-danger',
  },
  info: {
    soft: 'bg-info-50 text-info-700 dark:bg-info-900/20 dark:text-info-400',
    outline: 'border border-info-200 text-info-700 dark:border-info-900 dark:text-info-400',
    dot: 'bg-info',
  },
};

const BASE = 'inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium leading-none';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  /** estilo de borda em vez de fundo suave */
  outline?: boolean;
  /** mostra um ponto colorido antes do texto */
  dot?: boolean;
  /** anima o ponto (urgência) */
  pulse?: boolean;
}

export function Badge({
  className,
  variant = 'neutral',
  outline,
  dot,
  pulse,
  children,
  ...props
}: BadgeProps) {
  const c = COLORS[variant];
  return (
    <span className={cn(BASE, outline ? c.outline : c.soft, className)} {...props}>
      {dot && (
        <span className="relative flex h-1.5 w-1.5">
          {pulse && (
            <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', c.dot)} />
          )}
          <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', c.dot)} />
        </span>
      )}
      {children}
    </span>
  );
}

/** Ponto colorido + label (timelines, status inline). */
export function StatusDot({
  variant = 'neutral',
  children,
  className,
}: {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm text-content-secondary', className)}>
      <span className={cn('h-2 w-2 rounded-full', COLORS[variant].dot)} />
      {children}
    </span>
  );
}

/** Indicador de tendência: ↑12% (verde) · ↓5% (vermelho) · →0% (neutro). */
export function TrendIndicator({
  value,
  suffix = '%',
  className,
}: {
  value: number;
  suffix?: string;
  className?: string;
}) {
  const tone =
    value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-content-muted';
  const arrow = value > 0 ? '↑' : value < 0 ? '↓' : '→';
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium tabular-nums', tone, className)}>
      {arrow}
      {Math.abs(value)}
      {suffix}
    </span>
  );
}

/** Tag removível (chips de filtro). */
export function Tag({
  children,
  onRemove,
  variant = 'neutral',
  className,
}: {
  children: React.ReactNode;
  onRemove?: () => void;
  variant?: BadgeVariant;
  className?: string;
}) {
  return (
    <span className={cn(BASE, 'rounded-md py-1', COLORS[variant].soft, className)}>
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remover"
          className="-mr-0.5 ml-0.5 rounded-sm p-0.5 opacity-70 transition-opacity hover:opacity-100"
        >
          <X size={12} />
        </button>
      )}
    </span>
  );
}
