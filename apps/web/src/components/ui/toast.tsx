'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (opts: { title: string; description?: string; variant?: ToastVariant }) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast deve ser usado dentro de <ToastProvider>');
  return ctx;
}

const VARIANT_CONFIG: Record<
  ToastVariant,
  { icon: React.FC<{ className?: string }>; color: string }
> = {
  success: { icon: CheckCircle2, color: 'text-success' },
  error: { icon: AlertCircle, color: 'text-danger' },
  info: { icon: Info, color: 'text-info' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback(
    (opts: { title: string; description?: string; variant?: ToastVariant }) => {
      setItems((prev) => [
        ...prev,
        { id: Date.now() + Math.random(), variant: 'info', ...opts },
      ]);
    },
    [],
  );

  const value: ToastContextValue = {
    toast: push,
    success: (title, description) => push({ title, description, variant: 'success' }),
    error: (title, description) => push({ title, description, variant: 'error' }),
  };

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right" duration={4000}>
        {children}
        {items.map((item) => {
          const { icon: Icon, color } = VARIANT_CONFIG[item.variant];
          return (
            <ToastPrimitive.Root
              key={item.id}
              onOpenChange={(open) =>
                !open && setItems((prev) => prev.filter((i) => i.id !== item.id))
              }
              className={cn(
                'flex items-start gap-3 rounded-xl border border-line bg-surface-elevated p-4 shadow-elevation-3',
                'data-[state=open]:animate-in data-[state=open]:slide-in-from-right-full',
                'data-[state=closed]:animate-out data-[state=closed]:fade-out',
              )}
            >
              <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', color)} />
              <div className="flex-1">
                <ToastPrimitive.Title className="text-sm font-medium text-content">
                  {item.title}
                </ToastPrimitive.Title>
                {item.description && (
                  <ToastPrimitive.Description className="mt-0.5 text-sm text-content-secondary">
                    {item.description}
                  </ToastPrimitive.Description>
                )}
              </div>
              <ToastPrimitive.Close className="text-content-muted hover:text-content">
                <X className="h-4 w-4" />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          );
        })}
        <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-50 flex w-full max-w-sm flex-col gap-2 p-4 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
