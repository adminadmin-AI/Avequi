'use client';

import type { ReactNode } from 'react';
import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';

/** Estado que a casca entrega ao conteúdo da sidebar. */
export interface SidebarFrameContext {
  /** modo mini (só ícones) — desktop com Ctrl+B acionado */
  mini: boolean;
  /** presente só no desktop: alterna o modo mini */
  onToggleMini?: () => void;
  /** presente só no drawer mobile: fecha o overlay */
  onClose?: () => void;
  /** o conteúdo deve renderizar o botão de fechar (drawer mobile) */
  showClose?: boolean;
}

/**
 * Casca da sidebar (OPS F2): a coluna fixa do desktop + o drawer do mobile,
 * ambos ligados no `useUiStore` (colapso persistido por Ctrl+B, drawer
 * aberto pelo hamburger do Header).
 *
 * Extraída da `Sidebar` do ERP para que o console da operadora ganhe o
 * MESMO comportamento sem reimplementá-lo — o que muda entre os dois é só o
 * conteúdo, passado como função para receber o contexto de cada viewport.
 */
export function SidebarFrame({
  children,
}: {
  children: (ctx: SidebarFrameContext) => ReactNode;
}) {
  const { sidebarCollapsed, toggleSidebarCollapsed, mobileNavOpen, setMobileNavOpen } =
    useUiStore();

  return (
    <>
      {/* Desktop — fixa */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-20 hidden flex-col bg-surface-secondary transition-[width] duration-flow ease-precise lg:flex',
          sidebarCollapsed ? 'w-16' : 'w-60',
        )}
      >
        {children({ mini: sidebarCollapsed, onToggleMini: toggleSidebarCollapsed })}
      </aside>

      {/* Mobile — drawer overlay */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Fechar menu"
            className="absolute inset-0 bg-surface-overlay backdrop-blur-sm duration-fast animate-in fade-in"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface shadow-elevation-4 duration-flow animate-in slide-in-from-left">
            {children({ mini: false, onClose: () => setMobileNavOpen(false), showClose: true })}
          </aside>
        </div>
      )}
    </>
  );
}

// #versioning — versão real do produto, injetada do package.json em build time
const APP_VERSION = `v${process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev'}`;

/** Rodapé comum às duas sidebars: só a versão (a marca já vive no topo). */
export function SidebarVersionFooter({ mini }: { mini: boolean }) {
  return (
    <div className={cn('border-t border-line px-4 py-2.5', mini && 'px-2 text-center')}>
      <p className="text-helper text-content-muted">{APP_VERSION}</p>
    </div>
  );
}
