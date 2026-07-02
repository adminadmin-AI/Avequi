import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  icon?: React.ReactNode;
}

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** CTA principal (botão primary) */
  action?: EmptyStateAction;
  /** ação secundária (botão ghost) */
  secondaryAction?: EmptyStateAction;
  /** menos padding, p/ uso dentro de cards/tabelas */
  compact?: boolean;
  className?: string;
}

/**
 * Estado vazio reutilizável (F4.2 / #319): ícone grande muted + título +
 * descrição + CTA. Dark-mode aware. Usado pela DataTable e em telas/cards.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-4 py-10' : 'px-6 py-16',
        className,
      )}
    >
      {Icon && (
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-secondary text-content-muted">
          <Icon size={28} />
        </div>
      )}
      <h3 className="mt-4 text-base font-semibold text-content">{title}</h3>
      {description && (
        <p className="mt-1 max-w-xs text-sm text-content-secondary">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-5 flex items-center gap-2">
          {action && (
            <Button variant="primary" onClick={action.onClick} leftIcon={action.icon}>
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button variant="ghost" onClick={secondaryAction.onClick} leftIcon={secondaryAction.icon}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
