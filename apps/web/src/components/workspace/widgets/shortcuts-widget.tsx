'use client';

import Link from 'next/link';
import { Boxes, CreditCard, Factory, Plus, ShoppingCart, type LucideIcon } from 'lucide-react';
import { usePermission } from '@/hooks/use-permission';
import type { WidgetComponentProps } from '../types';
import { WidgetFrame } from '../widget-frame';

/**
 * Ações rápidas — zona de atenção, a resposta imediata ao "vim criar algo".
 * O template escolhe o conjunto via props.actions; cada atalho ainda gateia a
 * si mesmo pela permissão de CREATE do endpoint alvo. Sem nenhum atalho
 * permitido, o bloco some inteiro (nada de frame vazio).
 */

export type ShortcutKey = 'new-sale' | 'new-production' | 'new-product' | 'new-purchase';

const SHORTCUT_ACTIONS: Record<
  ShortcutKey,
  { label: string; href: string; icon: LucideIcon; permission: string[] }
> = {
  'new-sale': {
    label: 'Nova Ordem de Venda',
    href: '/app/sales/new',
    icon: ShoppingCart,
    permission: ['sales.orders.create'],
  },
  'new-production': {
    label: 'Nova Ordem de Produção',
    href: '/app/production',
    icon: Factory,
    permission: ['production.orders.create'],
  },
  'new-product': {
    label: 'Novo Produto',
    href: '/app/products',
    icon: Boxes,
    permission: ['products.catalog.create'],
  },
  'new-purchase': {
    label: 'Novo Pedido de Compra',
    href: '/app/purchases/new',
    icon: CreditCard,
    permission: ['purchases.orders.create'],
  },
};

export function ShortcutsWidget({ instance }: WidgetComponentProps) {
  const { canAny, isLoading } = usePermission();

  const requested = (instance.props?.actions as ShortcutKey[] | undefined) ?? [];
  const actions = requested.filter(
    (key) => SHORTCUT_ACTIONS[key] && !isLoading && canAny(SHORTCUT_ACTIONS[key].permission),
  );

  if (actions.length === 0) return null;

  return (
    <WidgetFrame title="Ações rápidas">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {actions.map((key) => {
          const { label, href, icon: Icon } = SHORTCUT_ACTIONS[key];
          return (
            <Link
              key={href}
              href={href}
              className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-micro hover:bg-neutral-500/[0.06]"
            >
              <Plus size={16} className="text-brand-600 dark:text-brand-400" />
              <span className="flex-1 text-sm font-medium text-content">{label}</span>
              <Icon
                size={16}
                className="text-content-muted opacity-60 transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          );
        })}
      </div>
    </WidgetFrame>
  );
}
