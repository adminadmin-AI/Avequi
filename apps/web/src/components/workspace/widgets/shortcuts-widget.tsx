'use client';

import Link from 'next/link';
import { ArrowRight, Boxes, CreditCard, Factory, ShoppingCart, type LucideIcon } from 'lucide-react';
import { usePermission } from '@/hooks/use-permission';
import type { WidgetComponentProps } from '../types';
import { WidgetFrame } from '../widget-frame';

/**
 * Ações rápidas — launcher (auditoria UX 30/07, direção Raycast): cards
 * pequenos com o ícone do DOMÍNIO em tint da marca, não uma lista de linhas.
 * Widget auxiliar (nível 3): moldura quiet, quem fala é o conteúdo.
 *
 * O template escolhe o conjunto via props.actions; cada atalho ainda gateia a
 * si mesmo pela permissão de CREATE do endpoint alvo. Sem nenhum atalho
 * permitido, o bloco some inteiro (nada de frame vazio).
 */

export type ShortcutKey = 'new-sale' | 'new-production' | 'new-product' | 'new-purchase';

const SHORTCUT_ACTIONS: Record<
  ShortcutKey,
  { label: string; desc: string; href: string; icon: LucideIcon; permission: string[] }
> = {
  'new-sale': {
    label: 'Nova venda',
    desc: 'Criar um pedido de venda',
    href: '/app/sales/new',
    icon: ShoppingCart,
    permission: ['sales.orders.create'],
  },
  'new-production': {
    label: 'Nova OP',
    desc: 'Abrir uma ordem de produção',
    href: '/app/production',
    icon: Factory,
    permission: ['production.orders.create'],
  },
  'new-product': {
    label: 'Novo produto',
    desc: 'Cadastrar um item no catálogo',
    href: '/app/products',
    icon: Boxes,
    permission: ['products.catalog.create'],
  },
  'new-purchase': {
    label: 'Nova compra',
    desc: 'Criar um pedido de compra',
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
    <WidgetFrame title="Ações rápidas" quiet>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {actions.map((key) => {
          const { label, desc, href, icon: Icon } = SHORTCUT_ACTIONS[key];
          return (
            <Link
              key={href}
              href={href}
              className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-line bg-surface p-3 transition-[border-color,box-shadow,transform] duration-fast ease-flow hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-elevation-3 active:translate-y-0 active:scale-[0.99] dark:hover:border-brand-700"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition-transform duration-fast ease-orbital group-hover:scale-105 dark:bg-brand-600/15 dark:text-brand-400">
                <Icon size={19} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-content">{label}</span>
                <span className="block truncate text-caption text-content-muted">{desc}</span>
              </span>
              <ArrowRight
                size={16}
                className="shrink-0 text-content-muted opacity-0 transition-all duration-fast ease-flow group-hover:translate-x-0 group-hover:text-brand-600 group-hover:opacity-100 dark:group-hover:text-brand-400 -translate-x-1"
              />
            </Link>
          );
        })}
      </div>
    </WidgetFrame>
  );
}
