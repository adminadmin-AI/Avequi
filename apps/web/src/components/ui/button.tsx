'use client';

import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Spinner } from './spinner';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap rounded-lg transition-[colors,transform] duration-fast ease-precise active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-xs',
        secondary:
          'bg-surface text-content border border-line hover:bg-surface-secondary shadow-xs',
        outline:
          'border border-line bg-transparent text-content hover:bg-neutral-100 dark:hover:bg-neutral-800',
        ghost: 'text-content-secondary hover:bg-neutral-100 dark:hover:bg-neutral-800',
        link: 'text-brand-600 dark:text-brand-400 underline-offset-4 hover:underline dark:text-brand-400',
        danger: 'bg-danger text-white hover:bg-danger-700 shadow-xs',
        accent: 'bg-accent text-white hover:brightness-95 shadow-xs',
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
