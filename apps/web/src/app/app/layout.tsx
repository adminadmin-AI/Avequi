'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Package,
  Users,
  Factory,
  Warehouse,
  Building2,
  UserCog,
  Wallet,
  CreditCard,
  SlidersHorizontal,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { BrandMark } from '@/components/brand-mark';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}
interface NavSection {
  title?: string;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    items: [{ href: '/app', label: 'Início', icon: LayoutDashboard }],
  },
  {
    title: 'Cadastros',
    items: [
      { href: '/app/products', label: 'Produtos', icon: Package },
      { href: '/app/customers', label: 'Clientes', icon: Users },
      { href: '/app/suppliers', label: 'Fornecedores', icon: Factory },
    ],
  },
  {
    title: 'Financeiro',
    items: [
      { href: '/app/finance/receivables', label: 'Recebíveis', icon: Wallet },
      { href: '/app/finance/payables', label: 'Pagáveis', icon: CreditCard },
      { href: '/app/finance/settings', label: 'Categorias / CC', icon: SlidersHorizontal },
    ],
  },
  {
    title: 'Configurações',
    items: [
      { href: '/app/settings/users', label: 'Usuários', icon: UserCog },
      { href: '/app/settings/warehouses', label: 'Depósitos', icon: Warehouse },
      { href: '/app/settings/company', label: 'Empresa', icon: Building2 },
    ],
  },
];

function isActive(pathname: string, href: string) {
  if (href === '/app') return pathname === '/app';
  return pathname === href || pathname.startsWith(href + '/');
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAuthenticated, logout } = useAuthStore();
  const [mounted, setMounted] = useState(false);

  // Aguarda a rehidratação do zustand/persist antes de decidir o guard.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (mounted && !isAuthenticated) router.replace('/login');
  }, [mounted, isAuthenticated, router]);

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  if (!mounted || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* ─── Sidebar (Shell A — 240px) ─── */}
      <aside className="fixed inset-y-0 left-0 z-20 flex w-60 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100">
          <BrandMark size={26} />
          <span className="text-base font-semibold tracking-tight text-slate-900">Avequi</span>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {NAV.map((section, i) => (
            <div key={i}>
              {section.title && (
                <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {section.title}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map(({ href, label, icon: Icon }) => {
                  const active = isActive(pathname, href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={cn(
                        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-fast',
                        active
                          ? 'bg-brand-50 font-medium text-brand-700'
                          : 'text-slate-600 hover:bg-slate-100',
                      )}
                    >
                      <Icon size={17} className={active ? 'text-brand-600' : 'text-slate-400'} />
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* ─── Conteúdo ─── */}
      <div className="flex min-h-screen flex-1 flex-col pl-60">
        {/* Header */}
        <header className="sticky top-0 z-10 flex h-14 items-center justify-end gap-4 border-b border-slate-200 bg-white/80 px-6 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="text-right leading-tight">
              <p className="text-sm font-medium text-slate-800">{user?.name}</p>
              <p className="text-xs text-slate-400">{user?.role}</p>
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-gradient text-xs font-semibold text-white">
              {user?.name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <button
              onClick={handleLogout}
              title="Sair"
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
