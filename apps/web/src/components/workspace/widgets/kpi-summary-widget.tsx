'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CreditCard,
  Factory,
  TrendingDown,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { formatBRL, formatNumber } from '@/lib/format';
import { usePermission } from '@/hooks/use-permission';
import { cn } from '@/lib/utils';
import type { BankAccount, FinancialEntry, ProductionOrder, StockBalance } from '@/types/api';
import type { WidgetComponentProps } from '../types';
import { ChromelessWidget } from '../widget-frame';
import { isoDaysAgo, num, useWorkspacePeriod } from '../workspace-context';

/**
 * KPIs de-boxed — zona de orientação, tipografia sobre o canvas (padrão F2
 * do refinamento visual). O template escolhe QUAIS métricas via
 * props.metrics; cada métrica ainda gateia a si mesma por permissão
 * (regra de ouro: o code do endpoint que ela consome) — template compõe,
 * permissão apara.
 */

interface SalesCubeRow {
  period: string;
  totalRevenue: number;
}

export type MetricKey =
  | 'revenue'
  | 'cash'
  | 'overdue-receivable'
  | 'payable-upcoming'
  | 'active-ops'
  | 'stock-below-min';

const METRIC_PERMISSION: Record<MetricKey, string[]> = {
  revenue: ['analytics.dashboards.view'], // GET /analytics/sales-cube
  cash: ['finance.bank-accounts.view'], // GET /finance/bank-accounts
  'overdue-receivable': ['finance.entries.view'], // GET /finance?type=RECEIVABLE
  'payable-upcoming': ['finance.entries.view'], // GET /finance?type=PAYABLE
  'active-ops': ['production.orders.view'], // GET /production
  'stock-below-min': ['stock.balances.view'], // GET /stock/balances
};

/** Métricas que falam mais alto (escala 30px, à esquerda). */
const PRIMARY: ReadonlySet<MetricKey> = new Set(['revenue', 'cash']);

const COMMON = { retry: false, staleTime: 5 * 60 * 1000 } as const;

export function KpiSummaryWidget({ instance }: WidgetComponentProps) {
  const { canAny, isLoading: permsLoading } = usePermission();
  const { periodDays } = useWorkspacePeriod();

  const requested = (instance.props?.metrics as MetricKey[] | undefined) ?? [];
  const metrics = requested.filter(
    (m) => METRIC_PERMISSION[m] && !permsLoading && canAny(METRIC_PERMISSION[m]),
  );
  const want = (m: MetricKey) => metrics.includes(m);

  const startDate = isoDaysAgo(periodDays);
  const endDate = isoDaysAgo(0);

  // Hooks incondicionais (regra do React); `enabled` liga só o que o template
  // pede E a permissão deixa. queryKeys idênticas às dos gráficos → dedupe.
  const salesQ = useQuery({
    ...COMMON,
    enabled: want('revenue'),
    queryKey: ['/analytics/sales-cube', startDate, endDate],
    queryFn: async () =>
      (await apiClient.get<SalesCubeRow[]>('/analytics/sales-cube', { params: { startDate, endDate } }))
        .data,
  });
  const cashAccountsQ = useQuery({
    ...COMMON,
    enabled: want('cash'),
    queryKey: ['/finance/bank-accounts'],
    queryFn: async () => (await apiClient.get<BankAccount[]>('/finance/bank-accounts')).data,
  });
  const receivablesQ = useQuery({
    ...COMMON,
    enabled: want('overdue-receivable'),
    queryKey: ['/finance', 'RECEIVABLE'],
    queryFn: async () =>
      (await apiClient.get<FinancialEntry[]>('/finance', { params: { type: 'RECEIVABLE' } })).data,
  });
  const payablesQ = useQuery({
    ...COMMON,
    enabled: want('payable-upcoming'),
    queryKey: ['/finance', 'PAYABLE'],
    queryFn: async () =>
      (await apiClient.get<FinancialEntry[]>('/finance', { params: { type: 'PAYABLE' } })).data,
  });
  const productionQ = useQuery({
    ...COMMON,
    enabled: want('active-ops'),
    queryKey: ['/production'],
    queryFn: async () => (await apiClient.get<ProductionOrder[]>('/production')).data,
  });
  const stockQ = useQuery({
    ...COMMON,
    enabled: want('stock-below-min'),
    queryKey: ['/stock/balances'],
    queryFn: async () => (await apiClient.get<StockBalance[]>('/stock/balances')).data,
  });

  // ─── Derivações (mesma semântica da Home antiga) ───
  const revenue = useMemo(
    () => (salesQ.data ?? []).reduce((s, r) => s + num(r.totalRevenue), 0),
    [salesQ.data],
  );
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
      (productionQ.data ?? []).filter((o) => o.status === 'IN_PROGRESS' || o.status === 'RELEASED')
        .length,
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

  const CARDS: Record<
    MetricKey,
    { label: string; value: string; icon: LucideIcon; tone: Tone; sub?: string; loading: boolean }
  > = {
    revenue: {
      label: 'Faturamento',
      value: formatBRL(revenue),
      icon: TrendingUp,
      tone: 'brand',
      sub: `Últimos ${periodDays}d`,
      loading: salesQ.isLoading,
    },
    cash: {
      label: 'Saldo de caixa',
      value: formatBRL(cashBalance),
      icon: Wallet,
      tone: cashBalance >= 0 ? 'success' : 'danger',
      loading: cashAccountsQ.isLoading,
    },
    'overdue-receivable': {
      label: 'Recebíveis em atraso',
      value: formatBRL(overdueReceivable),
      icon: TrendingDown,
      tone: overdueReceivable > 0 ? 'danger' : 'success',
      loading: receivablesQ.isLoading,
    },
    'payable-upcoming': {
      label: `A pagar (${periodDays}d)`,
      value: formatBRL(payableUpcoming),
      icon: CreditCard,
      tone: payableUpcoming > 0 ? 'warning' : 'neutral',
      sub: 'A vencer no período',
      loading: payablesQ.isLoading,
    },
    'active-ops': {
      label: 'OPs ativas',
      value: formatNumber(activeOps),
      icon: Factory,
      tone: 'info',
      loading: productionQ.isLoading,
    },
    'stock-below-min': {
      label: 'Estoque abaixo do mín.',
      value: formatNumber(belowMin),
      icon: AlertTriangle,
      tone: belowMin > 0 ? 'warning' : 'success',
      sub: belowMin > 0 ? 'itens críticos' : 'tudo ok',
      loading: stockQ.isLoading,
    },
  };

  const primaries = metrics.filter((m) => PRIMARY.has(m));
  const secondaries = metrics.filter((m) => !PRIMARY.has(m));

  if (metrics.length === 0) return null;

  return (
    <ChromelessWidget>
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:gap-14">
        {primaries.length > 0 && (
          <div className="flex flex-wrap gap-x-12 gap-y-5">
            {primaries.map((m) => (
              <KpiCard key={m} primary {...CARDS[m]} />
            ))}
          </div>
        )}
        {secondaries.length > 0 && (
          <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            {secondaries.map((m) => (
              <KpiCard key={m} {...CARDS[m]} />
            ))}
          </div>
        )}
      </div>
    </ChromelessWidget>
  );
}

// De-box: o KPI é TIPOGRAFIA sobre o canvas, não uma caixa. A cor semântica
// só aparece quando é alarme de verdade (danger/warning) — e só no ícone.
const TONE = {
  brand: 'text-content-muted',
  success: 'text-content-muted',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-content-muted',
  neutral: 'text-content-muted',
} as const;

type Tone = keyof typeof TONE;

function KpiCard({
  label,
  value,
  icon: Icon,
  tone,
  sub,
  loading,
  primary,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: Tone;
  sub?: string;
  loading?: boolean;
  primary?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <Icon size={primary ? 14 : 13} className={cn('shrink-0', TONE[tone])} />
        <span className="truncate text-caption text-content-muted">{label}</span>
      </div>
      {loading ? (
        <div
          className={cn(
            'mt-1.5 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700',
            primary ? 'h-9 w-32' : 'h-7 w-20',
          )}
        />
      ) : (
        <p
          className={cn(
            'mt-1 truncate font-semibold tracking-[-0.02em] tabular-nums text-content',
            primary ? 'text-[30px] leading-9' : 'text-[19px] leading-7',
          )}
          title={value}
        >
          {value}
        </p>
      )}
      {sub && !loading && <p className="mt-0.5 text-helper text-content-muted">{sub}</p>}
    </div>
  );
}
