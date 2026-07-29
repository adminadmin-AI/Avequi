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
  borderRadius: 8,
  border: `1px solid ${colors.neutral[200]}`,
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
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4 }}
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
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={colors.brand[500]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
