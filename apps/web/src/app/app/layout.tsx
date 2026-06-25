'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSidebarCounts } from '@/hooks/use-sidebar-counts';
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
  Landmark,
  LineChart,
  Scale,
  Barcode,
  CalendarClock,
  ShoppingCart,
  FileText,
  PackageOpen,
  BadgeCheck,
  Gauge,
  FileInput,
  Boxes,
  ArrowLeftRight,
  Truck,
  MapPin,
  ClipboardList,
  Network,
  Calculator,
  Workflow,
  ScrollText,
  ClipboardCheck,
  AlertTriangle,
  ShieldCheck,
  Wrench,
  BarChart3,
  Bell,
  History,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { BrandMark } from '@/components/brand-mark';
import { NotificationBell } from '@/components/notification-bell';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** se definido, o item só aparece para esses papéis */
  roles?: string[];
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
    title: 'Comercial',
    items: [
      { href: '/app/sales', label: 'Ordens de Venda', icon: ShoppingCart },
      { href: '/app/quotations', label: 'Cotações', icon: FileText },
    ],
  },
  {
    title: 'Estoque',
    items: [
      { href: '/app/stock', label: 'Saldos', icon: Boxes },
      { href: '/app/stock/movements', label: 'Movimentações', icon: ArrowLeftRight },
      { href: '/app/stock/transfers', label: 'Transferências', icon: Truck },
      { href: '/app/stock/locations', label: 'Localizações', icon: MapPin },
      { href: '/app/stock/wms', label: 'Tarefas WMS', icon: ClipboardList },
    ],
  },
  {
    title: 'Produção',
    items: [
      { href: '/app/production', label: 'Ordens de Produção', icon: Factory },
      { href: '/app/production/bom', label: 'BOM', icon: Network },
      { href: '/app/production/mrp', label: 'MRP', icon: Calculator },
      { href: '/app/production/routing', label: 'Roteiros', icon: Workflow },
      { href: '/app/production/work-centers', label: 'Centros de Trabalho', icon: Gauge },
    ],
  },
  {
    title: 'Suprimentos',
    items: [
      { href: '/app/purchases', label: 'Pedidos de Compra', icon: PackageOpen },
      { href: '/app/purchases/automation', label: 'Automação', icon: Gauge },
      { href: '/app/purchases/inbound-nfe', label: 'NF-e de Entrada', icon: FileInput },
      { href: '/app/approvals', label: 'Aprovações', icon: BadgeCheck },
    ],
  },
  {
    title: 'Qualidade',
    items: [
      { href: '/app/quality', label: 'Dashboard', icon: ShieldCheck },
      { href: '/app/quality/inspections', label: 'Inspeções', icon: ClipboardCheck },
      { href: '/app/quality/ncr', label: 'Não Conformidades', icon: AlertTriangle },
    ],
  },
  {
    title: 'Manutenção',
    items: [{ href: '/app/maintenance', label: 'Ordens de Manutenção', icon: Wrench }],
  },
  {
    title: 'Fiscal',
    items: [{ href: '/app/fiscal', label: 'Documentos Fiscais', icon: ScrollText }],
  },
  {
    title: 'Financeiro',
    items: [
      { href: '/app/finance/receivables', label: 'Recebíveis', icon: Wallet },
      { href: '/app/finance/payables', label: 'Pagáveis', icon: CreditCard },
      { href: '/app/finance/cash-flow', label: 'Fluxo de Caixa', icon: LineChart },
      { href: '/app/finance/bank-accounts', label: 'Contas Bancárias', icon: Landmark },
      { href: '/app/finance/reconciliation', label: 'Conciliação', icon: Scale },
      { href: '/app/finance/collection-tools', label: 'Cobranças', icon: Barcode },
      { href: '/app/finance/scheduled-payments', label: 'Agendamentos', icon: CalendarClock },
      { href: '/app/finance/settings', label: 'Categorias / CC', icon: SlidersHorizontal },
    ],
  },
  {
    title: 'Inteligência',
    items: [
      { href: '/app/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/app/reports', label: 'Relatórios', icon: FileText },
      { href: '/app/alerts', label: 'Alertas', icon: Bell },
    ],
  },
  {
    title: 'Configurações',
    items: [
      { href: '/app/settings/users', label: 'Usuários', icon: UserCog },
      { href: '/app/settings/warehouses', label: 'Depósitos', icon: Warehouse },
      { href: '/app/settings/company', label: 'Empresa', icon: Building2 },
      { href: '/app/settings/audit', label: 'Log de Auditoria', icon: History, roles: ['SUPER_ADMIN'] },
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

  // Badges dinâmicos da sidebar (aprovações, alertas, conciliação). Polling 60s.
  const counts = useSidebarCounts();

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
                {section.items
                  .filter((it) => !it.roles || (user?.role ? it.roles.includes(user.role) : false))
                  .map(({ href, label, icon: Icon }) => {
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
                      <span className="flex-1">{label}</span>
                      {(counts[href] ?? 0) > 0 && (
                        <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white">
                          {counts[href] > 99 ? '99+' : counts[href]}
                        </span>
                      )}
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
          <NotificationBell />
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
