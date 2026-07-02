'use client';

import { forwardRef } from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

/**
 * Toggle (Switch) — F2.8 (#314)
 *
 * Interruptor on/off para configurações. Baseado no Radix Switch, então é
 * acessível por padrão (role="switch", espaço/enter, foco visível) e
 * integra com formulários via `name`/`value`.
 *
 * Uso controlado:   <Toggle checked={v} onCheckedChange={setV} />
 * Uso simples:       <Toggle defaultChecked label="Notificações" />
 */

export interface ToggleProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  size?: 'sm' | 'md';
  /** Rótulo opcional renderizado ao lado do switch (clicável). */
  label?: React.ReactNode;
}

const dims = {
  sm: { root: 'h-4 w-7', thumb: 'h-3 w-3 data-[state=checked]:translate-x-3' },
  md: { root: 'h-5 w-9', thumb: 'h-4 w-4 data-[state=checked]:translate-x-4' },
} as const;

export const Toggle = forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  ToggleProps
>(({ className, size = 'md', label, id, ...props }, ref) => {
  const d = dims[size];
  const control = (
    <SwitchPrimitive.Root
      ref={ref}
      id={id}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-fast ease-precise',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'bg-neutral-300 data-[state=checked]:bg-brand-600 dark:bg-neutral-700 dark:data-[state=checked]:bg-brand-500',
        d.root,
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block translate-x-0 rounded-full bg-white shadow-xs transition-transform duration-fast ease-precise',
          d.thumb,
        )}
      />
    </SwitchPrimitive.Root>
  );

  if (label == null) return control;

  return (
    <label
      htmlFor={id}
      className="inline-flex cursor-pointer items-center gap-2 text-sm text-content"
    >
      {control}
      {label}
    </label>
  );
});
Toggle.displayName = 'Toggle';
