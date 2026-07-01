'use client';

import { forwardRef } from 'react';
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
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    { className, error, inputSize = 'md', leftIcon, rightIcon, helperText, ...props },
    ref,
  ) => {
    const field = (
      <input
        ref={ref}
        className={cn(
          'w-full rounded-lg border bg-surface px-3 text-content placeholder:text-content-muted',
          'transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
          'disabled:cursor-not-allowed disabled:bg-surface-secondary disabled:text-content-muted',
          SIZE_CLASSES[inputSize],
          leftIcon && 'pl-9',
          rightIcon && 'pr-9',
          error
            ? 'border-danger focus-visible:ring-danger'
            : 'border-line focus-visible:ring-brand-600',
          className,
        )}
        {...props}
      />
    );

    if (!leftIcon && !rightIcon && !helperText) return field;

    return (
      <div>
        <div className="relative">
          {leftIcon && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted">
              {leftIcon}
            </span>
          )}
          {field}
          {rightIcon && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-content-muted">
              {rightIcon}
            </span>
          )}
        </div>
        {helperText && <p className="mt-1 text-caption text-content-muted">{helperText}</p>}
      </div>
    );
  },
);
Input.displayName = 'Input';
