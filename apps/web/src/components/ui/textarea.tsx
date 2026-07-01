'use client';

import { forwardRef, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
  /** cresce com o conteúdo */
  autoResize?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, autoResize, onChange, value, ...props }, ref) => {
    const innerRef = useRef<HTMLTextAreaElement | null>(null);

    function setRefs(node: HTMLTextAreaElement | null) {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
    }

    function resize() {
      const el = innerRef.current;
      if (!el || !autoResize) return;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }

    useEffect(() => {
      resize();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, autoResize]);

    return (
      <textarea
        ref={setRefs}
        value={value}
        onChange={(e) => {
          onChange?.(e);
          resize();
        }}
        className={cn(
          'w-full rounded-lg border bg-surface px-3 py-2 text-sm text-content placeholder:text-content-muted',
          'transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
          'disabled:cursor-not-allowed disabled:bg-surface-secondary disabled:text-content-muted',
          autoResize ? 'resize-none overflow-hidden' : 'min-h-[80px]',
          error
            ? 'border-danger focus-visible:ring-danger'
            : 'border-line focus-visible:ring-brand-600',
          className,
        )}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';
