'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CreditCard,
  Factory,
  Info,
  Plus,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { formatBRL, formatNumber } from '@/lib/format';
import { colors } from '@/lib/design-tokens';
import { cn } from '@/lib/utils';
import type {
  BankAccount,
  FinancialEntry,
  ProductionOrder,
  ProductionOrderStatus,
  StockBalance,
} from '@/types/api';

// ─── Shapes dos endpoints (reaproveitados das telas existentes) ──────────────
interface OlapSummary {
  sales: { totalRevenue: number; totalOrders: number; avgTicket: number };
  inventory: { totalSkus: number; totalValue: number; slowMovingCount: number };
  production: { totalOrders: number; totalProduced: number; avgCostPerUnit: number };
  quality: { totalNcrs: number; openNcrs: number; criticalNcrs: number };
}
interface SalesCubeRow {
  period: string;
  totalRevenue: number;
}
interface Alert {
  id: string;
  type: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  body: string;
  entityId: string | null;
  entityType: string | null;
  createdAt: string;
}

const PERIODS = [
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
] as const;

const PROD_STATUS_LABEL: Record<ProductionOrderStatus, string> = {
  DRAFT: 'Planejada',
  RELEASED: 'Liberada',
  IN_PROGRESS: 'Em produção',
  PENDING_INSPECTION: 'Inspeção',
  DONE: 'Concluída',
  CANCELLED: 'Cancelada',
};

const QUICK_ACTIONS = [
  { label: 'Nova Ordem de Venda', href: '/app/sales/new', icon: ShoppingCart },
  { label: 'Nova Ordem de Produção', href: '/app/production', icon: Factory },
  { label: 'Novo Produto', href: '/app/products', icon: Boxes },
  { label: 'Novo Pedido de Compra', href: '/app/purchases/new', icon: CreditCard },
] as const;

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function num(v: string | number | null | undefined) {
  return v == null ? 0 : Number(v);
}
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export default function DashboardPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const firstName = user?.name?.split(' ')[0] ?? '';
  const [periodDays, setPeriodDays] = useState<number>(30);

  const startDate = isoDaysAgo(periodDays);
  const endDate = isoDaysAgo(0);
  const common = { retry: false, staleTime: 5 * 60 * 1000 } as const;

  const summaryQ = useQuery({
    ...common,
    queryKey: ['/analytics/summary'],
    queryFn: async () => (await apiClient.get<OlapSummary>('/analytics/summary')).data,
  });
  const salesQ = useQuery({
    ...common,
    queryKey: ['/analytics/sales-cube', startDate, endDate],
    queryFn: async () =>
      (await apiClient.get<SalesCubeRow[]>('/analytics/sales-cube', { params: { startDate, endDate } }))
        .data,
  });
  const cashAccountsQ = useQuery({
    ...common,
    queryKey: ['/finance/bank-accounts'],
    queryFn: async () => (await apiClient.get<BankAccount[]>('/finance/bank-accounts')).data,
  });
  const receivablesQ = useQuery({
    ...common,
    queryKey: ['/finance', 'RECEIVABLE'],
    queryFn: async () =>
      (await apiClient.get<FinancialEntry[]>('/finance', { params: { type: 'RECEIVABLE' } })).data,
  });
  const payablesQ = useQuery({
    ...common,
    queryKey: ['/finance', 'PAYABLE'],
    queryFn: async () =>
      (await apiClient.get<FinancialEntry[]>('/finance', { params: { type: 'PAYABLE' } })).data,
  });
  const productionQ = useQuery({
    ...common,
    queryKey: ['/production'],
    queryFn: async () => (await apiClient.get<ProductionOrder[]>('/production')).data,
  });
  const stockQ = useQuery({
    ...common,
    queryKey: ['/stock/balances'],
    queryFn: async () => (await apiClient.get<StockBalance[]>('/stock/balances')).data,
  });
  const alertsQ = useQuery({
    ...common,
    staleTime: 60 * 1000,
    queryKey: ['/alerts'],
    queryFn: async () => (await apiClient.get<Alert[]>('/alerts')).data,
  });

  // ─── Derivações ───
  const revenue = useMemo(
    () => (salesQ.data ?? []).reduce((s, r) => s + num(r.totalRevenue), 0),
    [salesQ.data],
  );
  const revenueSeries = useMemo(() => {
    const byPeriod = new Map<string, number>();
    for (const r of salesQ.data ?? []) {
      byPeriod.set(r.period, (byPeriod.get(r.period) ?? 0) + num(r.totalRevenue));
    }
    return [...byPeriod.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, value]) => ({ period, value }));
  }, [salesQ.data]);

  const today = isoDaysAgo(0);
  const inPeriod = isoDaysAgo(-periodDays);
  const overdueReceivable = useMemo(
    () =>
      (receivablesQ.data ?? [])
        .filter(
          (e) =>
            e.status === 'OVERDUE' ||
            ((e.status === 'OPEN' || e.status === 'PARTIALLY_PAID') && e.dueDate < today),
        )
        .reduce((s, e) => s + num(e.amount), 0),
    [receivablesQ.data, today],
  );
  const payableUpcoming = useMemo(
    () =>
      (payablesQ.data ?? [])
        .filter(
          (e) =>
            (e.status === 'OPEN' || e.status === 'PARTIALLY_PAID' || e.status === 'OVERDUE') &&
            e.dueDate >= today &&
            e.dueDate <= inPeriod,
        )
        .reduce((s, e) => s + num(e.amount), 0),
    [payablesQ.data, today, inPeriod],
  );
  const cashBalance = useMemo(
    () => (cashAccountsQ.data ?? []).reduce((s, a) => s + num(a.balance), 0),
    [cashAccountsQ.data],
  );
  const activeOps = useMemo(
    () =>
      (productionQ.data ?? []).filter(
        (o) => o.status === 'IN_PROGRESS' || o.status === 'RELEASED',
      ).length,
    [productionQ.data],
  );
  const belowMin = useMemo(
    () =>
      (stockQ.data ?? []).filter((b) => {
        const min = num(b.product?.minStock);
        return min > 0 && num(b.available) < min;
      }).length,
    [stockQ.data],
  );
  const prodByStatus = useMemo(() => {
    const counts = new Map<ProductionOrderStatus, number>();
    for (const o of productionQ.data ?? []) counts.set(o.status, (counts.get(o.status) ?? 0) + 1);
    return (Object.keys(PROD_STATUS_LABEL) as ProductionOrderStatus[])
      .filter((s) => s !== 'CANCELLED')
      .map((s) => ({ status: PROD_STATUS_LABEL[s], count: counts.get(s) ?? 0 }));
  }, [productionQ.data]);

  const pendencias = useMemo(() => {
    const order = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
    return [...(alertsQ.data ?? [])]
      .sort((a, b) => order[a.severity] - order[b.severity])
      .slice(0, 8);
  }, [alertsQ.data]);

  const anyLoading =
    summaryQ.isLoading || salesQ.isLoading || cashAccountsQ.isLoading || receivablesQ.isLoading;

  return (
    <div className="space-y-6">
      {/* ─── Cabeçalho + filtro ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-heading text-content">
            {greeting()}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-body text-content-secondary">Visão geral da operação.</p>
        </div>
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              onClick={() => setPeriodDays(p.days)}
              className={cn(
                'rounded-md px-3 py-1.5 text-caption font-medium transition-colors',
                periodDays === p.days
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-300'
                  : 'text-content-secondary hover:text-content',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── KPIs ─── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Faturamento"
          value={formatBRL(revenue)}
          icon={TrendingUp}
          tone="brand"
          sub={`Últimos ${periodDays}d`}
          loading={salesQ.isLoading}
        />
        <KpiCard
          label="Recebíveis em atraso"
          value={formatBRL(overdueReceivable)}
          icon={TrendingDown}
          tone={overdueReceivable > 0 ? 'danger' : 'success'}
          loading={receivablesQ.isLoading}
        />
        <KpiCard
          label={`A pagar (${periodDays}d)`}
          value={formatBRL(payableUpcoming)}
          icon={CreditCard}
          tone={payableUpcoming > 0 ? 'warning' : 'neutral'}
          sub="A vencer no período"
          loading={payablesQ.isLoading}
        />
        <KpiCard
          label="Saldo de caixa"
          value={formatBRL(cashBalance)}
          icon={Wallet}
          tone={cashBalance >= 0 ? 'success' : 'danger'}
          loading={cashAccountsQ.isLoading}
        />
        <KpiCard
          label="OPs ativas"
          value={formatNumber(activeOps)}
          icon={Factory}
          tone="info"
          loading={productionQ.isLoading}
        />
        <KpiCard
          label="Estoque abaixo do mín."
          value={formatNumber(belowMin)}
          icon={AlertTriangle}
          tone={belowMin > 0 ? 'warning' : 'success'}
          sub={belowMin > 0 ? 'itens críticos' : 'tudo ok'}
          loading={stockQ.isLoading}
        />
      </div>

      {/* ─── Grid principal ─── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Faturamento (line) */}
        <Panel>
          <PanelHeader>Faturamento</PanelHeader>
          <PanelBody>
            {salesQ.isLoading ? (
              <ChartSkeleton />
            ) : revenueSeries.length === 0 ? (
              <EmptyChart label="Sem dados de faturamento no período." />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={revenueSeries} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.neutral[200]} vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 11, fill: colors.neutral[400] }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: colors.neutral[400] }}
                    tickLine={false}
                    axisLine={false}
                    width={64}
                    tickFormatter={(v) => formatBRL(v).replace('R$', '').trim()}
                  />
                  <Tooltip
                    formatter={(v) => [formatBRL(Number(v)), 'Faturamento']}
                    contentStyle={tooltipStyle}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={colors.brand[600]}
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </PanelBody>
        </Panel>

        {/* Pendências & Alertas */}
        <Panel>
          <PanelHeader
            action={
              <Link href="/app/alerts" className="text-caption font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
                ver todos
              </Link>
            }
          >
            Pendências &amp; Alertas
          </PanelHeader>
          <PanelBody>
            {alertsQ.isLoading ? (
              <ListSkeleton />
            ) : pendencias.length === 0 ? (
              <EmptyChart label="Nenhuma pendência. Tudo em dia! 🎉" />
            ) : (
              <ul className="divide-y divide-line">
                {pendencias.map((a) => (
                  <li key={a.id}>
                    <button
                      onClick={() => router.push('/app/alerts')}
                      className="flex w-full items-start gap-3 py-2.5 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                    >
                      <span
                        className={cn(
                          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                          a.severity === 'CRITICAL'
                            ? 'bg-danger'
                            : a.severity === 'WARNING'
                              ? 'bg-warning'
                              : 'bg-info',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-content">{a.title}</span>
                        <span className="block truncate text-caption text-content-muted">{a.body}</span>
                      </span>
                      <ArrowRight size={14} className="mt-1 shrink-0 text-content-muted" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PanelBody>
        </Panel>

        {/* Produção (bar) */}
        <Panel>
          <PanelHeader>Produção por status</PanelHeader>
          <PanelBody>
            {productionQ.isLoading ? (
              <ChartSkeleton />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={prodByStatus} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.neutral[200]} vertical={false} />
                  <XAxis dataKey="status" tick={{ fontSize: 11, fill: colors.neutral[400] }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: colors.neutral[400] }} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                  <Tooltip formatter={(v) => [Number(v), 'OPs']} contentStyle={tooltipStyle} cursor={{ fill: colors.neutral[100] }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {prodByStatus.map((_, i) => (
                      <Cell key={i} fill={colors.brand[500]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </PanelBody>
        </Panel>

        {/* Ações rápidas */}
        <Panel>
          <PanelHeader>Ações rápidas</PanelHeader>
          <PanelBody>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {QUICK_ACTIONS.map(({ label, href, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="group flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 transition-colors hover:border-brand-300 hover:bg-brand-50 dark:hover:bg-brand-600/10"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-600/15 dark:text-brand-300">
                    <Plus size={16} />
                  </span>
                  <span className="flex-1 text-sm font-medium text-content">{label}</span>
                  <Icon size={16} className="text-content-muted transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          </PanelBody>
        </Panel>
      </div>

      {!anyLoading && summaryQ.isError && (
        <p className="flex items-center gap-2 text-caption text-content-muted">
          <Info size={14} /> Alguns indicadores podem estar indisponíveis no momento.
        </p>
      )}
    </div>
  );
}

// ─── Subcomponentes ──────────────────────────────────────────────────────────
// Painel local (em vez do <Card> do DS, que ainda é hardcoded light — migração
// do Card é a #309). Assim o dashboard já fica 100% dark-mode correto.
function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-line bg-surface shadow-elevation-1', className)}>
      {children}
    </div>
  );
}
function PanelHeader({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3.5">
      <h3 className="text-title text-content">{children}</h3>
      {action}
    </div>
  );
}
function PanelBody({ children }: { children: React.ReactNode }) {
  return <div className="p-5">{children}</div>;
}

const TONE: Record<string, string> = {
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-600/15 dark:text-brand-300',
  success: 'bg-success-50 text-success-700 dark:bg-success-900/20 dark:text-success-400',
  warning: 'bg-warning-50 text-warning-700 dark:bg-warning-900/20 dark:text-warning-400',
  danger: 'bg-danger-50 text-danger-700 dark:bg-danger-900/20 dark:text-danger-400',
  info: 'bg-info-50 text-info-700 dark:bg-info-900/20 dark:text-info-400',
  neutral: 'bg-neutral-100 text-content-secondary dark:bg-neutral-800',
};

function KpiCard({
  label,
  value,
  icon: Icon,
  tone,
  sub,
  loading,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: keyof typeof TONE;
  sub?: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-elevation-1">
      <div className="flex items-start justify-between gap-2">
        <span className="text-caption text-content-secondary">{label}</span>
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', TONE[tone])}>
          <Icon size={15} />
        </span>
      </div>
      {loading ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
      ) : (
        <p className="mt-2 truncate text-title font-semibold tabular-nums text-content" title={value}>
          {value}
        </p>
      )}
      {sub && !loading && <p className="mt-0.5 text-helper text-content-muted">{sub}</p>}
    </div>
  );
}

const tooltipStyle = {
  borderRadius: 8,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  fontSize: 12,
} as const;

function ChartSkeleton() {
  return <div className="h-[240px] w-full animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800" />;
}
function ListSkeleton() {
  return (
    <div className="space-y-3 py-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-3 flex-1 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      ))}
    </div>
  );
}
function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-[240px] items-center justify-center text-center text-caption text-content-muted">
      {label}
    </div>
  );
}
