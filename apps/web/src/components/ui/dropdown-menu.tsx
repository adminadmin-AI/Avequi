'use client';

import { forwardRef } from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * DropdownMenu — F2.9 (#315)
 *
 * Wrapper premium sobre Radix DropdownMenu com o visual do design system:
 * elevation-3, animação scale-in + fade (95% → 100%), dark mode via tokens.
 *
 * Recursos (nativos do Radix): navegação por setas, type-ahead search,
 * fechamento por Escape/click-outside, submenus.
 *
 * Extras deste wrapper:
 *  - `DropdownMenuItem` com `icon`, `shortcut` e `danger`
 *  - `DropdownMenuLabel` + `DropdownMenuSeparator` para grupos
 *  - `DropdownMenuCheckboxItem` para toggles em menus (ex.: colunas visíveis)
 */

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;

/** Classes compartilhadas entre DropdownMenu e ContextMenu (mesmo visual). */
export const menuContentClass = cn(
  'z-50 min-w-[200px] overflow-hidden rounded-lg border border-line bg-surface-elevated p-1 text-content shadow-elevation-3',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
  'data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1',
  'data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1',
);

export const menuItemClass = cn(
  'relative flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none transition-colors duration-micro',
  'focus:bg-neutral-100 dark:focus:bg-neutral-800',
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
);

export const DropdownMenuContent = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(menuContentClass, className)}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = 'DropdownMenuContent';

export interface DropdownMenuItemProps
  extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> {
  /** Ícone à esquerda (ex.: <Settings className="h-4 w-4" />). */
  icon?: React.ReactNode;
  /** Atalho de teclado exibido à direita (ex.: "Ctrl+K"). */
  shortcut?: string;
  /** Ação destrutiva — texto e foco em vermelho. */
  danger?: boolean;
}

export const DropdownMenuItem = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  DropdownMenuItemProps
>(({ className, icon, shortcut, danger, children, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      menuItemClass,
      danger &&
        'text-danger-600 focus:bg-danger-50 focus:text-danger-700 dark:text-danger-400 dark:focus:bg-danger-900/30 dark:focus:text-danger-300',
      className,
    )}
    {...props}
  >
    {icon && <span className="shrink-0 text-content-muted [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
    <span className="flex-1">{children}</span>
    {shortcut && (
      <kbd className="ml-auto text-caption font-medium tracking-wide text-content-muted">
        {shortcut}
      </kbd>
    )}
  </DropdownMenuPrimitive.Item>
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuCheckboxItem = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(menuItemClass, 'pl-8', className)}
    {...props}
  >
    <span className="absolute left-2.5 flex h-4 w-4 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4 text-brand-600 dark:text-brand-400" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem';

export const DropdownMenuLabel = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn('px-2.5 py-1.5 text-caption font-semibold text-content-muted', className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = 'DropdownMenuLabel';

export const DropdownMenuSeparator = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-line', className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';

export const DropdownMenuSubTrigger = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    icon?: React.ReactNode;
  }
>(({ className, icon, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(menuItemClass, 'data-[state=open]:bg-neutral-100 dark:data-[state=open]:bg-neutral-800', className)}
    {...props}
  >
    {icon && <span className="shrink-0 text-content-muted [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
    <span className="flex-1">{children}</span>
    <ChevronRight className="h-4 w-4 text-content-muted" />
  </DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName = 'DropdownMenuSubTrigger';

export const DropdownMenuSubContent = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      className={cn(menuContentClass, className)}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuSubContent.displayName = 'DropdownMenuSubContent';
