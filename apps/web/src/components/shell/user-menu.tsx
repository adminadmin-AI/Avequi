'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Building2, ChevronDown, LogOut, Moon, Settings, Sun } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useCurrentCompany } from '@/hooks/use-current-company';
import { USER_ROLE_LABELS } from '@/lib/enums';
import type { UserRole } from '@/types/api';
import { cn } from '@/lib/utils';

function roleLabel(role?: string): string {
  if (!role) return '—';
  return USER_ROLE_LABELS[role as UserRole] ?? role;
}

export function UserMenu() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const companyName = useCurrentCompany();
  const { resolvedTheme, setTheme } = useTheme();

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isDark = resolvedTheme === 'dark';
  const initial = user?.name?.[0]?.toUpperCase() ?? '?';

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-gradient text-xs font-semibold text-white">
          {initial}
        </div>
        <div className="hidden text-left leading-tight sm:block">
          <p className="max-w-[140px] truncate text-sm font-medium text-content">{user?.name}</p>
          <p className="text-helper text-content-muted">{roleLabel(user?.role)}</p>
        </div>
        <ChevronDown size={15} className="text-content-muted" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 origin-top-right overflow-hidden rounded-xl border border-line bg-surface-elevated shadow-elevation-4 duration-fast animate-in fade-in zoom-in-95"
        >
          {/* Identidade */}
          <div className="border-b border-line p-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-gradient text-sm font-semibold text-white">
                {initial}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-content">{user?.name}</p>
                <p className="truncate text-helper text-content-muted">{user?.email}</p>
              </div>
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-surface-secondary px-2 py-1 text-helper text-content-secondary">
                <Building2 size={12} className="text-content-muted" />
                <span className="max-w-[120px] truncate" title={companyName ?? ''}>
                  {companyName ?? 'GDR'}
                </span>
              </span>
              <span className="rounded-md bg-brand-50 px-2 py-1 text-helper font-medium text-brand-700 dark:bg-brand-600/15 dark:text-brand-300">
                {roleLabel(user?.role)}
              </span>
            </div>
          </div>

          {/* Ações */}
          <div className="p-1.5">
            <button
              onClick={() => mounted && setTheme(isDark ? 'light' : 'dark')}
              role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-content-secondary transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
              <span className="flex-1 text-left">{isDark ? 'Tema claro' : 'Tema escuro'}</span>
            </button>
            <Link
              href="/app/settings/users"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-content-secondary transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <Settings size={16} />
              <span className="flex-1 text-left">Configurações</span>
            </Link>
          </div>

          {/* Atalhos + sair */}
          <div className="border-t border-line p-1.5">
            <div className="flex items-center justify-between px-2.5 py-1.5 text-helper text-content-muted">
              <span>Atalhos</span>
              <span className="flex gap-1">
                <Kbd>Ctrl K</Kbd>
                <Kbd>Ctrl B</Kbd>
              </span>
            </div>
            <button
              onClick={handleLogout}
              role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-danger transition-colors hover:bg-danger-50 dark:hover:bg-danger-900/20"
            >
              <LogOut size={16} />
              <span className="flex-1 text-left">Sair</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className={cn('rounded border border-line bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-content-muted')}>
      {children}
    </kbd>
  );
}
