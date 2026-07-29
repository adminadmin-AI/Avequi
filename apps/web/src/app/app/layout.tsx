'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { Sidebar } from '@/components/shell/sidebar';
import { Header } from '@/components/shell/header';
import { CommandPalette } from '@/components/shell/command-palette';
import { RouteGuard } from '@/components/shell/route-guard';
import { ShortcutsHelp } from '@/components/shell/shortcuts-help';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const {
    sidebarCollapsed,
    toggleSidebarCollapsed,
    setCommandOpen,
    setMobileNavOpen,
    setShortcutsOpen,
  } = useUiStore();
  const [mounted, setMounted] = useState(false);

  // Aguarda a rehidratação do zustand/persist antes de decidir o guard.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (mounted && !isAuthenticated) router.replace('/login');
  }, [mounted, isAuthenticated, router]);

  // Fecha o drawer mobile ao navegar + registra a página nos Recentes (#325).
  useEffect(() => {
    setMobileNavOpen(false);
    try {
      const key = 'avequi:recent-pages';
      const prev: string[] = JSON.parse(localStorage.getItem(key) ?? '[]');
      const next = [pathname, ...prev.filter((p) => p !== pathname)].slice(0, 8);
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* storage indisponível — recentes são só conveniência */
    }
  }, [pathname, setMobileNavOpen]);

  // Atalhos globais (#325): Ctrl+K palette · Ctrl+B sidebar · Ctrl+/ atalhos
  // · G+tecla navegação vim-style (fora de campos de texto).
  useEffect(() => {
    let gPending = 0; // timestamp do último "g" solto

    const G_ROUTES: Record<string, string> = {
      h: '/app',
      p: '/app/products',
      c: '/app/customers',
      v: '/app/sales',
      o: '/app/production',
      f: '/app/fiscal',
    };

    function isTyping(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      return (
        !!el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      );
    }

    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod) {
        if (key === 'k') {
          e.preventDefault();
          setCommandOpen(true);
        } else if (key === 'b') {
          e.preventDefault();
          toggleSidebarCollapsed();
        } else if (key === '/') {
          e.preventDefault();
          setShortcutsOpen(true);
        }
        return;
      }

      // navegação G+tecla (1,2s de janela; ignora quando digitando)
      if (isTyping(e) || e.altKey) return;
      if (key === 'g') {
        gPending = Date.now();
        return;
      }
      if (gPending && Date.now() - gPending < 1200 && G_ROUTES[key]) {
        e.preventDefault();
        router.push(G_ROUTES[key]);
      }
      gPending = 0;
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setCommandOpen, toggleSidebarCollapsed, setShortcutsOpen, router]);

  if (!mounted || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-secondary">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-secondary">
      {/* skip-to-content (WCAG 2.4.1, #322): invisível até receber foco via Tab */}
      <a
        href="#conteudo"
        className="sr-only rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100]"
      >
        Pular para o conteúdo
      </a>
      <Sidebar />
      <CommandPalette />
      <ShortcutsHelp />

      <div
        className={cn(
          'flex min-h-screen flex-col transition-[padding] duration-flow ease-precise',
          sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-60',
        )}
      >
        <Header />
        <main id="conteudo" tabIndex={-1} className="flex-1 p-4 outline-none sm:p-6">
          {/* Guard de rota por role: usa o mesmo mapa do menu (nav-config.ts). */}
          <RouteGuard>{children}</RouteGuard>
        </main>
        {/* #versioning — a versão do produto vive só no rodapé da sidebar */}
      </div>
    </div>
  );
}
