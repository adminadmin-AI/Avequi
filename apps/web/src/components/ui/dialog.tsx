'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Dialog — F2.5 (#311)
 *
 * Modal premium sobre Radix Dialog:
 *  - `size`: sm (400px) · md (500px, default) · lg (640px) · xl (800px) · full (90vw)
 *  - Mobile (< 640px): vira bottom sheet (desliza de baixo, ocupa a largura toda)
 *  - Corpo com scroll independente: use <DialogBody> entre Header e Footer —
 *    o conteúdo rola, header/footer ficam fixos (max-h 85vh)
 *  - Nested dialogs: suportado nativamente pelo Radix (abrir um Dialog dentro
 *    de outro empilha overlays; Esc fecha o do topo)
 *  - Dark mode via tokens semânticos
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const sizeClass: Record<DialogSize, string> = {
  sm: 'sm:max-w-[400px]',
  md: 'sm:max-w-[500px]',
  lg: 'sm:max-w-[640px]',
  xl: 'sm:max-w-[800px]',
  full: 'sm:max-w-[90vw]',
};

export function DialogContent({
  className,
  children,
  showClose = true,
  size = 'md',
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  showClose?: boolean;
  size?: DialogSize;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          'fixed inset-0 z-50 bg-surface-overlay backdrop-blur-sm',
          'data-[state=open]:animate-in data-[state=open]:fade-in',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out',
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          // base: coluna com altura máxima — o DialogBody rola, header/footer fixos
          'fixed z-50 flex max-h-[85vh] w-full flex-col',
          'border border-line bg-surface-elevated text-content shadow-elevation-4 focus:outline-none',
          // mobile (< sm): bottom sheet — cola embaixo, largura total, cantos só no topo
          'bottom-0 left-0 rounded-t-xl',
          'data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:max-sm:slide-in-from-bottom-8',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out',
          // desktop (>= sm): centralizado com zoom-in
          'sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl',
          'sm:data-[state=open]:zoom-in-95',
          sizeClass[size],
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md text-content-muted transition-colors hover:text-content focus:outline-none">
            <X className="h-5 w-5" />
            <span className="sr-only">Fechar</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('shrink-0 px-6 pt-6 pb-4', className)} {...props} />;
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-lg font-semibold text-content', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('mt-1 text-sm text-content-secondary', className)}
      {...props}
    />
  );
}

/** Corpo do modal com scroll independente (header/footer permanecem fixos). */
export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('avequi-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-2', className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-end gap-3 border-t border-line px-6 py-4',
        className,
      )}
      {...props}
    />
  );
}
