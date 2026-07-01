'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { Sidebar } from '@/components/shell/sidebar';
import { Header } from '@/components/shell/header';
import { CommandPalette } from '@/components/shell/command-palette';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { sidebarCollapsed, toggleSidebarCollapsed, setCommandOpen, setMobileNavOpen } =
    useUiStore();
  const [mounted, setMounted] = useState(false);

  // Aguarda a rehidratação do zustand/persist antes de decidir o guard.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (mounted && !isAuthenticated) router.replace('/login');
  }, [mounted, isAuthenticated, router]);

  // Fecha o drawer mobile ao navegar.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname, setMobileNavOpen]);

  // Atalhos globais: Ctrl/⌘+K (command palette) e Ctrl/⌘+B (recolher sidebar).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        setCommandOpen(true);
      } else if (key === 'b') {
        e.preventDefault();
        toggleSidebarCollapsed();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setCommandOpen, toggleSidebarCollapsed]);

  if (!mounted || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-secondary">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-secondary">
      <Sidebar />
      <CommandPalette />

      <div
        className={cn(
          'flex min-h-screen flex-col transition-[padding] duration-flow ease-precise',
          sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-60',
        )}
      >
        <Header />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
