'use client';

import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Spinner } from './spinner';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap rounded-lg transition-[color,background-color,border-color,box-shadow,transform] duration-fast ease-precise active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // Sólidos: luz interna de topo + lift de 1px no hover + glow da própria
        // cor — o botão "sobe em direção à luz" (transform não desloca layout)
        primary:
          'bg-brand-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(16_24_40/0.18)] hover:-translate-y-px hover:bg-brand-700 hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_2px_10px_rgb(61_44_230/0.30)] active:translate-y-0',
        secondary:
          'bg-surface text-content border border-line shadow-xs hover:border-line-strong hover:bg-surface-secondary hover:shadow-sm',
        outline:
          'border border-line bg-transparent text-content hover:border-line-strong hover:bg-neutral-500/[0.06]',
        ghost: 'text-content-secondary hover:bg-neutral-500/[0.08] hover:text-content',
        link: 'text-brand-600 dark:text-brand-400 underline-offset-4 hover:underline',
        danger:
          'bg-danger text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(16_24_40/0.18)] hover:-translate-y-px hover:bg-danger-700 hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.16),0_2px_10px_rgb(220_38_38/0.28)] active:translate-y-0',
        accent:
          'bg-accent text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.16),0_1px_2px_rgb(16_24_40/0.18)] hover:-translate-y-px hover:bg-accent-600 hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.20),0_2px_10px_rgb(0_194_168/0.30)] active:translate-y-0',
      },
      size: {
        xs: 'h-7 gap-1.5 px-2 text-xs',
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-11 px-5 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, loading, leftIcon, rightIcon, children, disabled, ...props },
    ref,
  ) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {/* o spinner ocupa o slot do leftIcon p/ não deslocar o texto */}
      {loading ? (
        <Spinner size="sm" className="border-current/30 border-t-current" />
      ) : (
        leftIcon
      )}
      {children}
      {!loading && rightIcon}
    </button>
  ),
);
Button.displayName = 'Button';

export { buttonVariants };
