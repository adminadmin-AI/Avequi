'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * SegmentedControl — F2.8 (#314)
 *
 * Grupo de botões mutuamente exclusivos (estilo iOS). Ideal para alternar
 * entre visões de um mesmo dado — ex.: Tabela / Kanban, Lista / Grade.
 *
 * Componente controlado: informe `value` e `onValueChange`. Cada opção pode
 * ter um ícone opcional. Acessível via `role="radiogroup"` + setas do teclado.
 */

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

function SegmentedControlInner<T extends string = string>(
  {
    options,
    value,
    onValueChange,
    size = 'md',
    className,
    'aria-label': ariaLabel,
  }: SegmentedControlProps<T>,
  ref: React.Ref<HTMLDivElement>,
) {
  const enabled = options.filter((o) => !o.disabled);

  const move = (dir: 1 | -1) => {
    const idx = enabled.findIndex((o) => o.value === value);
    if (idx === -1) return;
    const next = enabled[(idx + dir + enabled.length) % enabled.length];
    onValueChange(next.value);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    }
  };

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex items-center gap-1 rounded-lg bg-surface-secondary p-1',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={opt.disabled}
            tabIndex={active ? 0 : -1}
            onClick={() => onValueChange(opt.value)}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-fast ease-precise',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
              'disabled:pointer-events-none disabled:opacity-50',
              size === 'sm' ? 'h-7 px-2.5 text-caption' : 'h-8 px-3 text-sm',
              active
                ? 'bg-surface-elevated text-content shadow-xs'
                : 'text-content-secondary hover:text-content',
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// forwardRef com genéricos preservados (cast necessário — limitação do TS).
export const SegmentedControl = forwardRef(SegmentedControlInner) as <
  T extends string = string,
>(
  props: SegmentedControlProps<T> & { ref?: React.Ref<HTMLDivElement> },
) => React.ReactElement;
