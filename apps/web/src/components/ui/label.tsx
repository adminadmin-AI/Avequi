'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export const Label = forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }
>(({ className, children, required, ...props }, ref) => (
  <label
    ref={ref}
    className={cn('mb-1.5 block text-sm font-medium text-content-secondary', className)}
    {...props}
  >
    {children}
    {required && <span className="text-danger ml-0.5">*</span>}
  </label>
));
Label.displayName = 'Label';
