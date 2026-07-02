'use client';

import { forwardRef } from 'react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { cn } from '@/lib/utils';
import { menuContentClass, menuItemClass } from './dropdown-menu';

/**
 * ContextMenu — F2.9 (#315)
 *
 * Menu de clique-direito para linhas de tabela e cards. Mesmo visual do
 * DropdownMenu (reutiliza menuContentClass/menuItemClass), mesma API de
 * item com icon/shortcut/danger.
 *
 * Uso:
 *   <ContextMenu>
 *     <ContextMenuTrigger asChild><tr>…</tr></ContextMenuTrigger>
 *     <ContextMenuContent>
 *       <ContextMenuItem icon={<Pencil />}>Editar</ContextMenuItem>
 *       <ContextMenuSeparator />
 *       <ContextMenuItem danger icon={<Trash2 />}>Excluir</ContextMenuItem>
 *     </ContextMenuContent>
 *   </ContextMenu>
 */

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuGroup = ContextMenuPrimitive.Group;

export const ContextMenuContent = forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn(menuContentClass, className)}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = 'ContextMenuContent';

export interface ContextMenuItemProps
  extends React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> {
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
}

export const ContextMenuItem = forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  ContextMenuItemProps
>(({ className, icon, shortcut, danger, children, ...props }, ref) => (
  <ContextMenuPrimitive.Item
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
  </ContextMenuPrimitive.Item>
));
ContextMenuItem.displayName = 'ContextMenuItem';

export const ContextMenuLabel = forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={cn('px-2.5 py-1.5 text-caption font-semibold text-content-muted', className)}
    {...props}
  />
));
ContextMenuLabel.displayName = 'ContextMenuLabel';

export const ContextMenuSeparator = forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-line', className)}
    {...props}
  />
));
ContextMenuSeparator.displayName = 'ContextMenuSeparator';
