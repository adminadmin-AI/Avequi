import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const cardVariants = cva('rounded-xl bg-surface text-content', {
  variants: {
    // Soft Surfaces: profundidade por sombra suave; a borda é um sussurro.
    // surface-sheen = luz de topo quase imperceptível — container vira superfície.
    variant: {
      default: 'surface-sheen shadow-soft',
      elevated:
        'surface-sheen shadow-soft transition-shadow duration-flow hover:shadow-lg',
      outlined: 'border border-line',
      ghost: 'bg-transparent',
      interactive:
        'surface-sheen shadow-soft transition-[box-shadow,transform] duration-fast hover:shadow-md active:scale-[0.99] cursor-pointer',
    },
    accent: {
      none: '',
      brand: 'border-l-4 border-l-brand-500',
      success: 'border-l-4 border-l-success',
      warning: 'border-l-4 border-l-warning',
      danger: 'border-l-4 border-l-danger',
      info: 'border-l-4 border-l-info',
    },
  },
  defaultVariants: { variant: 'default', accent: 'none' },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export function Card({ className, variant, accent, ...props }: CardProps) {
  return <div className={cn(cardVariants({ variant, accent }), className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-6 pb-1 pt-5', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        'text-lg font-semibold leading-snug tracking-[-0.01em] text-content',
        className,
      )}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-6 py-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center gap-3 px-6 pb-5 pt-1', className)}
      {...props}
    />
  );
}

export { cardVariants };
