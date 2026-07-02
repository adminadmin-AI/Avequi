'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Sheet — F2.5 (#311)
 *
 * Painel lateral (slide-in pela direita) construído sobre Radix Dialog.
 * Para: detalhes de registro, edição inline, filtros avançados.
 *
 *  - `size`: sm (320px) · md (480px, default) · lg (640px)
 *  - Backdrop com click-to-close e Esc (nativos do Radix)
 *  - Header/footer fixos, corpo com scroll (SheetBody)
 *  - Mobile: ocupa a largura toda
 *
 * Uso:
 *   <Sheet open={open} onOpenChange={setOpen}>
 *     <SheetContent size="md">
 *       <SheetHeader><SheetTitle>Detalhes</SheetTitle></SheetHeader>
 *       <SheetBody>…</SheetBody>
 *       <SheetFooter><Button>Salvar</Button></SheetFooter>
 *     </SheetContent>
 *   </Sheet>
 */

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export type SheetSize = 'sm' | 'md' | 'lg';

const sizeClass: Record<SheetSize, string> = {
  sm: 'sm:max-w-[320px]',
  md: 'sm:max-w-[480px]',
  lg: 'sm:max-w-[640px]',
};

export function SheetContent({
  className,
  children,
  showClose = true,
  size = 'md',
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  showClose?: boolean;
  size?: SheetSize;
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
          'fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col',
          'border-l border-line bg-surface-elevated text-content shadow-elevation-4 focus:outline-none',
          'data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=open]:duration-deliberate',
          'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=closed]:duration-flow',
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

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('shrink-0 border-b border-line px-6 pb-4 pt-6', className)} {...props} />
  );
}

export function SheetTitle({
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

export function SheetDescription({
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

/** Corpo do sheet com scroll independente. */
export function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('avequi-scroll min-h-0 flex-1 overflow-y-auto px-6 py-4', className)}
      {...props}
    />
  );
}

export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
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
