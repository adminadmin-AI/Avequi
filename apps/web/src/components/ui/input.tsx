'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-lg border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400',
        'transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400',
        error
          ? 'border-danger focus-visible:ring-danger'
          : 'border-slate-200 focus-visible:ring-brand-600',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
