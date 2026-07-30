'use client';

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
import { formatBRL } from '@/lib/format';
import { colors } from '@/lib/design-tokens';
import { chartTooltipProps } from '@/lib/chart-theme';

/**
 * Gráficos do dashboard — F7.1 (#323).
 *
 * Extraídos da page.tsx para serem carregados via next/dynamic: o recharts
 * (~100kb gz) sai do chunk inicial da rota "/app" e só chega depois do
 * primeiro paint, atrás de um ChartSkeleton.
 */



export function RevenueLineChart({ data }: { data: { period: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid stroke="var(--border-default)" vertical={false} />
        <XAxis dataKey="period" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} />
        <YAxis
          tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
          tickLine={false}
          axisLine={false}
          width={64}
          tickFormatter={(v) => formatBRL(v).replace('R$', '').trim()}
        />
        <Tooltip {...chartTooltipProps} formatter={(v) => [formatBRL(Number(v)), 'Faturamento']} />
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--bg-primary)', fill: 'var(--chart-1)' }}
          animationDuration={600}
          animationEasing="ease-out"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ProductionBarChart({ data }: { data: { status: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid stroke="var(--border-default)" vertical={false} />
        <XAxis dataKey="status" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
        <Tooltip {...chartTooltipProps} formatter={(v) => [Number(v), 'OPs']} />
        <Bar dataKey="count" radius={[6, 6, 0, 0]} animationDuration={600} animationEasing="ease-out" maxBarSize={44}>
          {data.map((_, i) => (
            <Cell key={i} fill="var(--chart-1)" />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
