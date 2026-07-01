'use client';

import { Menu, Search } from 'lucide-react';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { UserMenu } from '@/components/shell/user-menu';
import { NotificationBell } from '@/components/notification-bell';
import { useUiStore } from '@/stores/ui-store';

export function Header() {
  const { setMobileNavOpen, setCommandOpen } = useUiStore();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/80 px-4 backdrop-blur sm:px-6">
      {/* Hamburger (mobile) */}
      <button
        onClick={() => setMobileNavOpen(true)}
        aria-label="Abrir menu"
        className="rounded-lg p-2 text-content-secondary transition-colors hover:bg-neutral-100 hover:text-content lg:hidden dark:hover:bg-neutral-800"
      >
        <Menu size={18} />
      </button>

      {/* Breadcrumbs */}
      <div className="hidden min-w-0 flex-1 sm:flex">
        <Breadcrumbs />
      </div>
      <div className="flex-1 sm:hidden" />

      {/* Trigger do command palette */}
      <button
        onClick={() => setCommandOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-line bg-surface-secondary px-2.5 py-1.5 text-caption text-content-muted transition-colors hover:border-line-strong hover:text-content-secondary"
        aria-label="Buscar (Ctrl+K)"
      >
        <Search size={15} />
        <span className="hidden md:inline">Buscar…</span>
        <kbd className="hidden rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-medium md:inline">
          Ctrl K
        </kbd>
      </button>

      <NotificationBell />
      <UserMenu />
    </header>
  );
}
