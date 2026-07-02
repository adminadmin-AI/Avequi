'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Building2, ChevronDown, LogOut, Moon, Settings, Sun } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useCurrentCompany } from '@/hooks/use-current-company';
import { USER_ROLE_LABELS } from '@/lib/enums';
import type { UserRole } from '@/types/api';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui';

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

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';
  const initial = user?.name?.[0]?.toUpperCase() ?? '?';

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 dark:hover:bg-neutral-800"
          aria-label="Menu do usuário"
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
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64 p-0">
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
          <DropdownMenuItem
            icon={isDark ? <Sun /> : <Moon />}
            // preventDefault mantém o menu aberto ao alternar o tema
            onSelect={(e) => {
              e.preventDefault();
              if (mounted) setTheme(isDark ? 'light' : 'dark');
            }}
          >
            {isDark ? 'Tema claro' : 'Tema escuro'}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Settings />}
            onSelect={() => router.push('/app/settings/users')}
          >
            Configurações
          </DropdownMenuItem>
        </div>

        <DropdownMenuSeparator className="mx-0 my-0" />

        {/* Atalhos + sair */}
        <div className="p-1.5">
          <div className="flex items-center justify-between px-2.5 py-1.5 text-helper text-content-muted">
            <span>Atalhos</span>
            <span className="flex gap-1">
              <Kbd>Ctrl K</Kbd>
              <Kbd>Ctrl B</Kbd>
            </span>
          </div>
          <DropdownMenuItem danger icon={<LogOut />} onSelect={handleLogout}>
            Sair
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className={cn('rounded border border-line bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-content-muted')}>
      {children}
    </kbd>
  );
}
