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

/**
 * Gráficos do dashboard — F7.1 (#323).
 *
 * Extraídos da page.tsx para serem carregados via next/dynamic: o recharts
 * (~100kb gz) sai do chunk inicial da rota "/app" e só chega depois do
 * primeiro paint, atrás de um ChartSkeleton.
 */

const tooltipStyle: React.CSSProperties = {
  borderRadius: 10,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  boxShadow: '0 4px 12px -2px rgb(15 23 42 / 0.10)',
  fontSize: 12,
};

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
        <Tooltip formatter={(v) => [formatBRL(Number(v)), 'Faturamento']} contentStyle={tooltipStyle} />
        <Line
          type="monotone"
          dataKey="value"
          stroke={colors.brand[600]}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--bg-primary)', fill: colors.brand[600] }}
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
        <Tooltip formatter={(v) => [Number(v), 'OPs']} contentStyle={tooltipStyle} cursor={{ fill: 'rgb(148 163 184 / 0.08)' }} />
        <Bar dataKey="count" radius={[6, 6, 0, 0]} animationDuration={600} animationEasing="ease-out" maxBarSize={44}>
          {data.map((_, i) => (
            <Cell key={i} fill={colors.brand[500]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
