'use client';

import { useState } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Alert & InlineMessage — F2.6 (#312)
 *
 * Alert: banner de página (topo de tela/seção) para avisos persistentes —
 * success/warning/danger/info, dismissable, com ação opcional.
 *
 * InlineMessage: feedback compacto de formulário (abaixo de um campo ou no
 * topo do form) — mesma paleta, sem borda/fundo pesados.
 *
 * As tintas usam as escalas semânticas com alfa (danger/warning/etc. aceitam
 * `/10`), padrão consolidado na migração dark (F9).
 */

export type AlertVariant = 'success' | 'warning' | 'danger' | 'info';

const VARIANT_CONFIG: Record<
  AlertVariant,
  { icon: React.FC<{ className?: string }>; tint: string; iconColor: string }
> = {
  success: {
    icon: CheckCircle2,
    tint: 'border-success/30 bg-success/10',
    iconColor: 'text-success',
  },
  warning: {
    icon: AlertTriangle,
    tint: 'border-warning/30 bg-warning/10',
    iconColor: 'text-warning',
  },
  danger: {
    icon: AlertCircle,
    tint: 'border-danger/30 bg-danger/10',
    iconColor: 'text-danger',
  },
  info: {
    icon: Info,
    tint: 'border-info/30 bg-info/10',
    iconColor: 'text-info',
  },
};

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  title: string;
  description?: React.ReactNode;
  /** Mostra o X para fechar (estado interno; use onDismiss para reagir). */
  dismissable?: boolean;
  onDismiss?: () => void;
  /** Ação opcional à direita (ex.: <Button size="sm">Resolver</Button>). */
  action?: React.ReactNode;
}

export function Alert({
  variant = 'info',
  title,
  description,
  dismissable,
  onDismiss,
  action,
  className,
  ...props
}: AlertProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const { icon: Icon, tint, iconColor } = VARIANT_CONFIG[variant];

  return (
    <div
      role="alert"
      className={cn('flex items-start gap-3 rounded-lg border p-4', tint, className)}
      {...props}
    >
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', iconColor)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-content">{title}</p>
        {description && <div className="mt-1 text-sm text-content-secondary">{description}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
      {dismissable && (
        <button
          onClick={() => {
            setDismissed(true);
            onDismiss?.();
          }}
          className="shrink-0 rounded-md p-0.5 text-content-muted transition-colors hover:text-content"
          aria-label="Fechar aviso"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export interface InlineMessageProps extends React.HTMLAttributes<HTMLParagraphElement> {
  variant?: AlertVariant;
  children: React.ReactNode;
}

/** Feedback compacto de formulário (ex.: erro geral acima dos botões). */
export function InlineMessage({
  variant = 'info',
  children,
  className,
  ...props
}: InlineMessageProps) {
  const { icon: Icon, iconColor } = VARIANT_CONFIG[variant];
  return (
    <p
      role={variant === 'danger' ? 'alert' : undefined}
      className={cn('flex items-center gap-1.5 text-sm', iconColor, className)}
      {...props}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
