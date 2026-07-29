'use client';

import { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          'h-10 w-full appearance-none rounded-lg border bg-surface pl-3 pr-9 text-sm text-content',
          // mesmo tratamento de foco do Input (glow suave, não anel duro) —
          // um formulário premium fala UMA língua em todos os campos
          'shadow-[inset_0_1px_2px_rgb(15_23_42/0.03)]',
          'transition-[border-color,box-shadow] duration-fast focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:bg-surface-secondary disabled:text-content-muted',
          error
            ? 'border-danger focus-visible:shadow-[0_0_0_3px_rgb(220_38_38/0.15)]'
            : 'border-line hover:border-line-strong focus-visible:border-brand-500/50 focus-visible:shadow-[0_0_0_3px_rgb(61_44_230/0.12),0_0_16px_rgb(61_44_230/0.08)]',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted" />
    </div>
  ),
);
Select.displayName = 'Select';
