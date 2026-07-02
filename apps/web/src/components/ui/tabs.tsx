'use client';

import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

/**
 * Tabs — F2.8 (#314)
 *
 * Wrapper premium sobre Radix Tabs com duas variantes visuais:
 *  - `underline` (default): indicador deslizante animado sob a aba ativa
 *  - `pill`: abas em formato de "pílula" sobre uma trilha (bg-surface-secondary)
 *
 * Recursos:
 *  - Navegação por teclado (setas ←/→) — nativa do Radix
 *  - Scroll horizontal automático quando há muitas abas
 *  - Badge/contador opcional por aba (<TabsTrigger badge={3}>)
 *  - Dark mode via tokens semânticos
 *
 * O indicador deslizante lê o elemento [data-state="active"] direto do DOM e
 * é reposicionado por um MutationObserver — assim funciona igual em modo
 * controlado (value/onValueChange) e não-controlado (defaultValue).
 */

type TabsVariant = 'underline' | 'pill';

const TabsVariantContext = createContext<TabsVariant>('underline');

export interface TabsProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> {
  variant?: TabsVariant;
}

export const Tabs = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  TabsProps
>(({ variant = 'underline', className, ...props }, ref) => (
  <TabsVariantContext.Provider value={variant}>
    <TabsPrimitive.Root ref={ref} className={cn('w-full', className)} {...props} />
  </TabsVariantContext.Provider>
));
Tabs.displayName = 'Tabs';

export const TabsList = forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, forwardedRef) => {
  const variant = useContext(TabsVariantContext);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  // Reposiciona o indicador lendo a aba ativa direto do DOM.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || variant !== 'underline') return;

    const update = () => {
      const active = list.querySelector<HTMLElement>('[data-state="active"]');
      if (active) {
        setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
      }
    };

    update();

    // data-state muda quando o Radix troca a aba ativa (controlado ou não).
    const observer = new MutationObserver(update);
    observer.observe(list, {
      attributes: true,
      attributeFilter: ['data-state'],
      subtree: true,
    });

    // Reposiciona em resize (largura das abas pode mudar).
    const resize = new ResizeObserver(update);
    resize.observe(list);

    return () => {
      observer.disconnect();
      resize.disconnect();
    };
  }, [variant, children]);

  return (
    <TabsPrimitive.List
      ref={(node) => {
        listRef.current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      }}
      className={cn(
        'relative flex items-center overflow-x-auto scrollbar-none',
        variant === 'underline' && 'gap-1 border-b border-line',
        variant === 'pill' && 'gap-1 rounded-lg bg-surface-secondary p-1',
        className,
      )}
      {...props}
    >
      {children}
      {variant === 'underline' && indicator && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-brand-600 transition-[left,width] duration-fast ease-precise dark:bg-brand-400"
          style={{ left: indicator.left, width: indicator.width }}
        />
      )}
    </TabsPrimitive.List>
  );
});
TabsList.displayName = 'TabsList';

export interface TabsTriggerProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  /** Contador exibido como badge ao lado do rótulo. */
  badge?: React.ReactNode;
}

export const TabsTrigger = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(({ className, children, badge, ...props }, ref) => {
  const variant = useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'group inline-flex items-center gap-2 whitespace-nowrap text-sm font-medium transition-colors duration-fast ease-precise',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        'disabled:pointer-events-none disabled:opacity-50',
        variant === 'underline' && [
          'relative px-3 pb-2.5 pt-2 text-content-secondary hover:text-content',
          'data-[state=active]:text-brand-600 dark:data-[state=active]:text-brand-400',
        ],
        variant === 'pill' && [
          'rounded-md px-3 py-1.5 text-content-secondary hover:text-content',
          'data-[state=active]:bg-surface-elevated data-[state=active]:text-content data-[state=active]:shadow-xs',
        ],
        className,
      )}
      {...props}
    >
      {children}
      {badge != null && (
        <span
          className={cn(
            'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-caption font-semibold',
            'bg-neutral-100 text-content-secondary dark:bg-neutral-800',
            'group-data-[state=active]:bg-brand-100 group-data-[state=active]:text-brand-700',
          )}
        >
          {badge}
        </span>
      )}
    </TabsPrimitive.Trigger>
  );
});
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
      'data-[state=active]:animate-in data-[state=active]:fade-in-0',
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = 'TabsContent';
