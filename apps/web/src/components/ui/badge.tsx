import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium leading-none',
  {
    variants: {
      variant: {
        neutral: 'bg-slate-100 text-slate-700',
        brand: 'bg-brand-50 text-brand-700',
        success: 'bg-green-50 text-success',
        warning: 'bg-amber-50 text-warning',
        danger: 'bg-red-50 text-danger',
        info: 'bg-blue-50 text-info',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
