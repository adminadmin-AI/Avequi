'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Spinner } from './spinner';

/**
 * Toast — F2.6 (#312)
 *
 * Notificações premium sobre Radix Toast, mantendo a API existente
 * (toast/success/error) e adicionando:
 *  - Stacking: no máximo 3 visíveis; excedente vira contador "+N"
 *  - Undo: `action: { label, onClick }` (ex.: "Desfazer")
 *  - Progress bar: timer visual do auto-dismiss (pausa no hover, como o Radix)
 *  - Promise toast: `toast.promise(p, { loading, success, error })`
 *  - Posição configurável no <ToastProvider position="..."> (default bottom-right)
 *  - Swipe to dismiss (nativo do Radix, direção acompanha a posição)
 *  - Dark mode via tokens
 */

type ToastVariant = 'success' | 'error' | 'warning' | 'info' | 'loading';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Botão de ação (ex.: "Desfazer"). Clicar executa e fecha o toast. */
  action?: ToastAction;
  /** ms até auto-dismiss (default 4000; loading não expira). */
  duration?: number;
}

interface ToastItem extends Required<Pick<ToastOptions, 'title' | 'variant'>> {
  id: number;
  description?: string;
  action?: ToastAction;
  duration: number;
}

interface PromiseMessages<T> {
  loading: string;
  success: string | ((value: T) => string);
  error: string | ((err: unknown) => string);
}

interface ToastContextValue {
  toast: (opts: ToastOptions) => void;
  success: (title: string, description?: string, action?: ToastAction) => void;
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  /** loading → success/error automático conforme a promise resolve. */
  promise: <T>(p: Promise<T>, msgs: PromiseMessages<T>) => Promise<T>;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast deve ser usado dentro de <ToastProvider>');
  return ctx;
}

const VARIANT_CONFIG: Record<
  ToastVariant,
  { icon: React.FC<{ className?: string }>; color: string; bar: string }
> = {
  success: { icon: CheckCircle2, color: 'text-success', bar: 'bg-success' },
  error: { icon: AlertCircle, color: 'text-danger', bar: 'bg-danger' },
  warning: { icon: AlertTriangle, color: 'text-warning', bar: 'bg-warning' },
  info: { icon: Info, color: 'text-info', bar: 'bg-info' },
  loading: { icon: Info, color: 'text-content-muted', bar: 'bg-brand-600' },
};

export type ToastPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

const POSITION_CLASS: Record<ToastPosition, string> = {
  'bottom-right': 'bottom-0 right-0',
  'bottom-left': 'bottom-0 left-0',
  'top-right': 'top-0 right-0',
  'top-left': 'top-0 left-0',
};

const MAX_VISIBLE = 3;
const DEFAULT_DURATION = 4000;

let nextId = 1;

export function ToastProvider({
  children,
  position = 'bottom-right',
}: {
  children: React.ReactNode;
  position?: ToastPosition;
}) {
  const [items, setItems] = useState<ToastItem[]>([]);
  // ref para o promise() ler/remover itens sem depender do closure do state
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const push = useCallback((opts: ToastOptions): number => {
    const id = nextId++;
    setItems((prev) => [
      ...prev,
      {
        id,
        variant: opts.variant ?? 'info',
        title: opts.title,
        description: opts.description,
        action: opts.action,
        duration:
          opts.duration ?? (opts.variant === 'loading' ? Infinity : DEFAULT_DURATION),
      },
    ]);
    return id;
  }, []);

  const promiseToast = useCallback(
    <T,>(p: Promise<T>, msgs: PromiseMessages<T>): Promise<T> => {
      const loadingId = push({ title: msgs.loading, variant: 'loading' });
      p.then(
        (value) => {
          remove(loadingId);
          push({
            title: typeof msgs.success === 'function' ? msgs.success(value) : msgs.success,
            variant: 'success',
          });
        },
        (err) => {
          remove(loadingId);
          push({
            title: typeof msgs.error === 'function' ? msgs.error(err) : msgs.error,
            variant: 'error',
          });
        },
      );
      return p;
    },
    [push, remove],
  );

  const value: ToastContextValue = {
    toast: push,
    success: (title, description, action) =>
      void push({ title, description, action, variant: 'success' }),
    error: (title, description) => void push({ title, description, variant: 'error' }),
    warning: (title, description) => void push({ title, description, variant: 'warning' }),
    info: (title, description) => void push({ title, description, variant: 'info' }),
    promise: promiseToast,
  };

  const swipeDirection = position.endsWith('right') ? 'right' : 'left';
  const hiddenCount = Math.max(0, items.length - MAX_VISIBLE);
  const visible = items.slice(-MAX_VISIBLE);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection={swipeDirection} duration={DEFAULT_DURATION}>
        {children}
        {visible.map((item) => {
          const { icon: Icon, color, bar } = VARIANT_CONFIG[item.variant];
          const timed = Number.isFinite(item.duration);
          return (
            <ToastPrimitive.Root
              key={item.id}
              duration={item.duration}
              onOpenChange={(open) => !open && remove(item.id)}
              className={cn(
                'group relative flex items-start gap-3 overflow-hidden rounded-xl border border-line bg-surface-elevated p-4 shadow-elevation-3',
                'data-[state=open]:animate-in data-[state=open]:slide-in-from-right-full',
                'data-[state=closed]:animate-out data-[state=closed]:fade-out',
                'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=end]:animate-out data-[swipe=end]:fade-out',
                position.endsWith('left') &&
                  'data-[state=open]:slide-in-from-left-full',
              )}
            >
              {item.variant === 'loading' ? (
                <Spinner size="sm" className="mt-0.5 shrink-0" />
              ) : (
                <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', color)} />
              )}
              <div className="flex-1">
                <ToastPrimitive.Title className="text-sm font-medium text-content">
                  {item.title}
                </ToastPrimitive.Title>
                {item.description && (
                  <ToastPrimitive.Description className="mt-0.5 text-sm text-content-secondary">
                    {item.description}
                  </ToastPrimitive.Description>
                )}
                {item.action && (
                  <ToastPrimitive.Action asChild altText={item.action.label}>
                    <button
                      onClick={item.action.onClick}
                      className="mt-2 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
                    >
                      {item.action.label}
                    </button>
                  </ToastPrimitive.Action>
                )}
              </div>
              <ToastPrimitive.Close className="text-content-muted hover:text-content">
                <X className="h-4 w-4" />
              </ToastPrimitive.Close>
              {/* progress bar do auto-dismiss (pausa no hover, acompanhando o Radix) */}
              {timed && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute bottom-0 left-0 h-0.5 animate-toast-progress group-hover:[animation-play-state:paused]',
                    bar,
                  )}
                  style={{ animationDuration: `${item.duration}ms` }}
                />
              )}
            </ToastPrimitive.Root>
          );
        })}
        <ToastPrimitive.Viewport
          className={cn(
            'fixed z-[60] flex w-full max-w-sm flex-col gap-2 p-4 outline-none',
            POSITION_CLASS[position],
          )}
        />
        {hiddenCount > 0 && (
          <div
            className={cn(
              'pointer-events-none fixed z-[60] m-4 rounded-full border border-line bg-surface-elevated px-2.5 py-1 text-caption font-medium text-content-muted shadow-elevation-1',
              // encosta no canto oposto da pilha para não cobrir os toasts
              position.startsWith('bottom') ? 'bottom-0' : 'top-0',
              position.endsWith('right') ? 'right-0 mr-[360px]' : 'left-0 ml-[360px]',
            )}
          >
            +{hiddenCount} notificaç{hiddenCount === 1 ? 'ão' : 'ões'}
          </div>
        )}
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
