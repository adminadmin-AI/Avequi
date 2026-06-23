'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export const Label = forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }
>(({ className, children, required, ...props }, ref) => (
  <label
    ref={ref}
    className={cn('block text-sm font-medium text-slate-700 mb-1.5', className)}
    {...props}
  >
    {children}
    {required && <span className="text-danger ml-0.5">*</span>}
  </label>
));
Label.displayName = 'Label';
