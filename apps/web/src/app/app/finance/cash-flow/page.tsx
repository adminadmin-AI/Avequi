'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { Wallet, ArrowDownCircle, ArrowUpCircle, TrendingUp, type LucideIcon } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type { BankAccount, FinancialEntryType, FinancialEntryStatus } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { formatBRL, formatDate } from '@/lib/format';

interface CashFlowEntry {
  id: string;
  type: FinancialEntryType;
  status: FinancialEntryStatus;
  amount: number;
  dueDate: string;
  description: string | null;
}
interface CashFlowResponse {
  totalReceivable: number;
  totalPayable: number;
  netBalance: number;
  entries: CashFlowEntry[];
}

const PERIODS = [
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
];

const STATUS_META: Record<string, { label: string; variant: any }> = {
  OPEN: { label: 'Em aberto', variant: 'info' },
  OVERDUE: { label: 'Vencido', variant: 'danger' },
  PARTIALLY_PAID: { label: 'Parcial', variant: 'warning' },
  PAID: { label: 'Pago', variant: 'success' },
  CANCELLED: { label: 'Cancelado', variant: 'neutral' },
};

/** Início da semana (segunda-feira) de uma data, em ISO yyyy-mm-dd. */
function weekStart(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // 0 = segunda
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

function KpiCard({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone?: 'neutral' | 'success' | 'danger' | 'brand';
}) {
  const toneCls = {
    neutral: 'bg-slate-100 text-slate-600',
    success: 'bg-green-50 text-success',
    danger: 'bg-red-50 text-danger',
    brand: 'bg-brand-50 text-brand-600',
  }[tone];
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', toneCls)}>
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
          <p
            className={cn(
              'text-xl font-semibold tracking-tight',
              value < 0 ? 'text-danger' : 'text-slate-900',
            )}
          >
            {formatBRL(value)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CashFlowPage() {
  const [days, setDays] = useState(30);

  const range = useMemo(() => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + days);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }, [days]);

  const { data: cashflow, isLoading } = useQuery<CashFlowResponse>({
    queryKey: ['/finance/cashflow', range],
    queryFn: async () => {
      const { data } = await apiClient.get<CashFlowResponse>('/finance/cashflow', {
        params: { from: range.from, to: range.to },
      });
      return data;
    },
  });

  const { data: accounts = [] } = useList<BankAccount>('/finance/bank-accounts');
  const totalBalance = useMemo(
    () => accounts.reduce((s, a) => s + Number(a.balance ?? 0), 0),
    [accounts],
  );

  const entries = cashflow?.entries ?? [];

  // ── Série semanal para o gráfico ──
  const chartData = useMemo(() => {
    const map = new Map<string, { week: string; entradas: number; saidas: number }>();
    for (const e of entries) {
      const wk = weekStart(new Date(e.dueDate));
      if (!map.has(wk)) map.set(wk, { week: wk, entradas: 0, saidas: 0 });
      const bucket = map.get(wk)!;
      if (e.type === 'RECEIVABLE') bucket.entradas += e.amount;
      else bucket.saidas += e.amount;
    }
    return Array.from(map.values())
      .sort((a, b) => a.week.localeCompare(b.week))
      .map((b) => ({
        ...b,
        label: new Date(b.week + 'T00:00:00').toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
        }),
      }));
  }, [entries]);

  const columns: Column<CashFlowEntry>[] = [
    {
      key: 'dueDate',
      header: 'Vencimento',
      sortable: true,
      accessor: (e) => e.dueDate,
      cell: (e) => formatDate(e.dueDate),
    },
    {
      key: 'type',
      header: 'Tipo',
      align: 'center',
      cell: (e) => (
        <Badge variant={e.type === 'RECEIVABLE' ? 'success' : 'danger'}>
          {e.type === 'RECEIVABLE' ? 'Entrada' : 'Saída'}
        </Badge>
      ),
    },
    { key: 'description', header: 'Descrição', cell: (e) => e.description || '—' },
    {
      key: 'amount',
      header: 'Valor',
      align: 'right',
      sortable: true,
      accessor: (e) => e.amount,
      cell: (e) => (
        <span
          className={cn(
            'font-medium tabular-nums',
            e.type === 'RECEIVABLE' ? 'text-success' : 'text-danger',
          )}
        >
          {e.type === 'RECEIVABLE' ? '+' : '−'} {formatBRL(e.amount)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      cell: (e) => {
        const meta = STATUS_META[e.status] ?? { label: e.status, variant: 'neutral' };
        return <Badge variant={meta.variant}>{meta.label}</Badge>;
      },
    },
  ];

  const projectedAfter = totalBalance + (cashflow?.netBalance ?? 0);

  return (
    <div>
      <PageHeader
        title="Fluxo de Caixa"
        description="Projeção de entradas e saídas previstas (em aberto e vencidas)."
        actions={
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                onClick={() => setDays(p.days)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  days === p.days ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      {/* KPIs */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Saldo disponível" value={totalBalance} icon={Wallet} tone="brand" />
        <KpiCard
          label="Recebíveis a vencer"
          value={cashflow?.totalReceivable ?? 0}
          icon={ArrowUpCircle}
          tone="success"
        />
        <KpiCard
          label="Pagáveis a vencer"
          value={cashflow?.totalPayable ?? 0}
          icon={ArrowDownCircle}
          tone="danger"
        />
        <KpiCard
          label="Saldo líquido projetado"
          value={cashflow?.netBalance ?? 0}
          icon={TrendingUp}
          tone="neutral"
        />
      </div>

      {/* Gráfico */}
      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="text-base">Entradas × Saídas por semana</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-72 items-center justify-center">
              <Spinner size="lg" />
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex h-72 items-center justify-center text-sm text-slate-400">
              Nenhum lançamento previsto no período.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  tickFormatter={(v) => formatBRL(Number(v)).replace('R$', '').trim()}
                  width={70}
                />
                <Tooltip
                  formatter={(v) => formatBRL(Number(v))}
                  labelFormatter={(l) => `Semana de ${l}`}
                />
                <Legend />
                <Bar dataKey="entradas" name="Entradas" fill="#16a34a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="saidas" name="Saídas" fill="#dc2626" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Tabela detalhada */}
        <div className="lg:col-span-2">
          <DataTable
            data={entries}
            columns={columns}
            loading={isLoading}
            searchPlaceholder="Buscar por descrição..."
            emptyMessage="Nenhum lançamento previsto no período."
          />
        </div>

        {/* Posição por conta */}
        <Card className="h-fit">
          <CardHeader className="flex items-center justify-between">
            <CardTitle className="text-base">Posição por conta</CardTitle>
            <span className="text-sm font-semibold tabular-nums text-slate-900">
              {formatBRL(totalBalance)}
            </span>
          </CardHeader>
          <CardContent className="space-y-2">
            {accounts.length === 0 ? (
              <p className="py-2 text-sm text-slate-400">Nenhuma conta cadastrada.</p>
            ) : (
              accounts.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 border-b border-slate-50 pb-2 last:border-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-700">{a.name}</p>
                    {a.bank && <p className="truncate text-xs text-slate-400">{a.bank}</p>}
                  </div>
                  <span className="text-sm font-medium tabular-nums text-slate-900">
                    {formatBRL(Number(a.balance ?? 0))}
                  </span>
                </div>
              ))
            )}
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <span className="text-sm font-medium text-slate-700">Projetado no período</span>
              <span
                className={cn(
                  'text-sm font-semibold tabular-nums',
                  projectedAfter < 0 ? 'text-danger' : 'text-slate-900',
                )}
              >
                {formatBRL(projectedAfter)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
