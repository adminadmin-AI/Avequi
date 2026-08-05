'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { apiClient } from '@/lib/api-client';
import type { FinancialForecast, QuarterForecast, ApiError } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { formatBRL } from '@/lib/format';
import { cn } from '@/lib/utils';
import { chartTooltipProps, chartGridProps, chartTickFill } from '@/lib/chart-theme';

// Cores do brandbook v2.0 (hex p/ recharts): brand 600, danger 600, accent 500.
const C = { revenue: '#3D2CE6', expenses: '#DC2626', result: '#00C2A8' };

function apiMessage(err: unknown): string | null {
  const e = err as AxiosError<ApiError>;
  const msg = e?.response?.data?.message;
  return Array.isArray(msg) ? msg.join(', ') : (msg ?? null);
}

const compact = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return `${v}`;
};

export default function ForecastPage() {
  const [quarters, setQuarters] = useState<'4' | '8' | '12'>('4');

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<FinancialForecast>({
    queryKey: ['forecast-financial', quarters],
    queryFn: async () =>
      (await apiClient.get<FinancialForecast>('/forecast/financial', { params: { quarters } })).data,
    retry: false,
  });

  const chartData = useMemo(
    () =>
      (data?.quarters ?? []).map((q) => ({
        label: q.quarter,
        Receita: q.revenue,
        Despesa: q.expenses,
        Resultado: q.result,
      })),
    [data],
  );

  const totals = useMemo(() => {
    const qs = data?.quarters ?? [];
    return {
      revenue: qs.reduce((s, q) => s + q.revenue, 0),
      expenses: qs.reduce((s, q) => s + q.expenses, 0),
      result: qs.reduce((s, q) => s + q.result, 0),
    };
  }, [data]);

  const columns: Column<QuarterForecast>[] = [
    { key: 'quarter', header: 'Trimestre' },
    { key: 'revenue', header: 'Receita', align: 'right', cell: (r) => formatBRL(r.revenue) },
    { key: 'expenses', header: 'Despesa', align: 'right', cell: (r) => formatBRL(r.expenses) },
    {
      key: 'result',
      header: 'Resultado',
      align: 'right',
      cell: (r) => <span className={cn(r.result >= 0 ? 'text-success' : 'text-danger')}>{formatBRL(r.result)}</span>,
    },
    { key: 'budgeted', header: 'Orçado', align: 'right', cell: (r) => (r.budgeted != null ? formatBRL(r.budgeted) : '—') },
    {
      key: 'realized',
      header: 'Realizado (result.)',
      align: 'right',
      cell: (r) =>
        r.realized ? (
          <span className="inline-flex items-center gap-1.5">
            <span className={cn(r.realized.result >= 0 ? 'text-success' : 'text-danger')}>
              {formatBRL(r.realized.result)}
            </span>
            {r.realized.partial && <Badge variant="warning">parcial</Badge>}
          </span>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projeção financeira"
        description="Projeção trimestral rolante: receita (demanda × preço) e despesa (tendência), vs orçado e realizado"
        actions={
          <SegmentedControl
            aria-label="Trimestres à frente"
            value={quarters}
            onValueChange={(v) => setQuarters(v as '4' | '8' | '12')}
            options={[
              { value: '4', label: '4T' },
              { value: '8', label: '8T' },
              { value: '12', label: '12T' },
            ]}
          />
        }
      />

      {isError && !isFetching ? (
        <Card>
          <CardContent className="py-8">
            <ErrorState
              title="Não foi possível carregar o forecast"
              description={apiMessage(error) ?? 'Erro ao gerar a projeção. Tente novamente.'}
              onRetry={() => refetch()}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPIs projetados */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard label="Receita projetada" value={totals.revenue} loading={isLoading} tone="brand" />
            <KpiCard label="Despesa projetada" value={totals.expenses} loading={isLoading} tone="danger" />
            <KpiCard label="Resultado projetado" value={totals.result} loading={isLoading} tone="result" />
          </div>

          {/* Gráfico */}
          <Card>
            <CardHeader>
              <CardTitle>Receita × Despesa × Resultado</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-[320px] w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid {...chartGridProps} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: chartTickFill }} />
                    <YAxis tick={{ fontSize: 12, fill: chartTickFill }} tickFormatter={compact} width={56} />
                    <Tooltip {...chartTooltipProps} formatter={(v) => formatBRL(Number(v))} />
                    <Legend />
                    <Bar dataKey="Receita" fill={C.revenue} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Despesa" fill={C.expenses} radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="Resultado" stroke={C.result} strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Tabela por trimestre */}
          <Card>
            <CardHeader>
              <CardTitle>Detalhe por trimestre</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                data={data?.quarters ?? []}
                columns={columns}
                rowKey={(r) => r.quarter}
                loading={isLoading}
                searchable={false}
                pageSize={12}
                emptyMessage="Sem trimestres projetados."
              />
            </CardContent>
          </Card>

          {data && (
            <p className="text-helper text-content-muted">
              Preço: {data.assumptions.priceSource} · tendência de despesa sobre {data.assumptions.expenseTrend.monthsBase} meses ·
              gerado em {new Date(data.assumptions.generatedAt).toLocaleString('pt-BR')}.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  loading,
  tone,
}: {
  label: string;
  value: number;
  loading: boolean;
  tone: 'brand' | 'danger' | 'result';
}) {
  const toneClass =
    tone === 'brand'
      ? 'text-brand-600 dark:text-brand-400'
      : tone === 'danger'
        ? 'text-danger'
        : value >= 0
          ? 'text-success'
          : 'text-danger';
  return (
    <Card>
      <CardContent className="space-y-1 py-5">
        <p className="text-caption text-content-muted">{label}</p>
        {loading ? <Skeleton className="h-8 w-32" /> : <p className={cn('text-heading', toneClass)}>{formatBRL(value)}</p>}
      </CardContent>
    </Card>
  );
}
