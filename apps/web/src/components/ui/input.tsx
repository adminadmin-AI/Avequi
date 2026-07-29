'use client';

import { forwardRef, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const SIZE_CLASSES = {
  sm: 'h-8 text-sm',
  md: 'h-10 text-sm',
  lg: 'h-12 text-base',
} as const;

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  error?: boolean;
  inputSize?: keyof typeof SIZE_CLASSES;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  /** texto auxiliar abaixo do campo */
  helperText?: string;
  /** botão X para limpar quando preenchido (dispara onChange com valor vazio) */
  clearable?: boolean;
  /** contador "n/max" abaixo do campo (requer maxLength) — F2.2 (#308) */
  characterCount?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      error,
      inputSize = 'md',
      leftIcon,
      rightIcon,
      helperText,
      clearable,
      characterCount,
      onChange,
      ...props
    },
    forwardedRef,
  ) => {
    const innerRef = useRef<HTMLInputElement | null>(null);
    // rastreia o conteúdo p/ clearable/characterCount funcionarem também
    // em inputs não-controlados (react-hook-form register)
    const [content, setContent] = useState(
      () => String(props.value ?? props.defaultValue ?? ''),
    );
    const current = props.value != null ? String(props.value) : content;

    const trackChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
      setContent(e.target.value);
      onChange?.(e);
    };

    // limpa via setter nativo + evento input p/ o react-hook-form enxergar
    const clear = () => {
      const el = innerRef.current;
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.focus();
    };

    const showClear = clearable && current.length > 0 && !props.disabled;
    const showCount = characterCount && props.maxLength != null;

    const field = (
      <input
        ref={(node) => {
          innerRef.current = node;
          if (typeof forwardedRef === 'function') forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        className={cn(
          'w-full rounded-lg border bg-surface px-3 text-content placeholder:text-content-muted',
          // Soft Surfaces: foco = glow discreto (borda brand suave + halo),
          // não um anel duro com offset
          'transition-[border-color,box-shadow] duration-fast focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:bg-surface-secondary disabled:text-content-muted',
          SIZE_CLASSES[inputSize],
          leftIcon && 'pl-9',
          (rightIcon || showClear) && 'pr-9',
          // profundidade física: leve rebaixo interno em repouso; o glow do
          // foco substitui a sombra inteira (composição única, sem somar)
          'shadow-[inset_0_1px_2px_rgb(15_23_42/0.03)]',
          error
            ? 'border-danger focus-visible:shadow-[0_0_0_3px_rgb(220_38_38/0.15)]'
            : 'border-line hover:border-line-strong focus-visible:border-brand-500/50 focus-visible:shadow-[0_0_0_3px_rgb(61_44_230/0.12),0_0_16px_rgb(61_44_230/0.08)]',
          className,
        )}
        onChange={trackChange}
        {...props}
      />
    );

    if (!leftIcon && !rightIcon && !helperText && !clearable && !showCount) return field;

    return (
      <div>
        <div className="relative">
          {leftIcon && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted">
              {leftIcon}
            </span>
          )}
          {field}
          {showClear ? (
            <button
              type="button"
              onClick={clear}
              tabIndex={-1}
              aria-label="Limpar campo"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded text-content-muted transition-colors hover:text-content"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            rightIcon && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-content-muted">
                {rightIcon}
              </span>
            )
          )}
        </div>
        {(helperText || showCount) && (
          <div className="mt-1 flex items-baseline justify-between gap-2">
            {helperText ? (
              <p className="text-caption text-content-muted">{helperText}</p>
            ) : (
              <span />
            )}
            {showCount && (
              <span
                className={cn(
                  'shrink-0 text-caption tabular-nums',
                  current.length >= (props.maxLength ?? 0)
                    ? 'text-warning'
                    : 'text-content-muted',
                )}
              >
                {current.length}/{props.maxLength}
              </span>
            )}
          </div>
        )}
      </div>
    );
  },
);
Input.displayName = 'Input';
