'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatBRL } from '@/lib/format';
import { chartGridProps, chartTickFill, chartTooltipProps } from '@/lib/chart-theme';

/**
 * Gráficos do Workspace (ex-dashboard-charts.tsx, F7.1 #323).
 *
 * Mantidos num módulo próprio para serem carregados via next/dynamic: o
 * recharts (~100kb gz) sai do chunk inicial da rota "/app".
 *
 * Look premium (Fase 3 do "workspace vivo"): linha suave + área com gradiente
 * discreto (fade para transparente), grid quase invisível, tooltip elegante do
 * tema e animação de desenho. Nada de aparência recharts padrão.
 */

export function RevenueLineChart({ data }: { data: { period: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="rev-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...chartGridProps} strokeDasharray="3 4" />
        <XAxis
          dataKey="period"
          tick={{ fontSize: 11, fill: chartTickFill }}
          tickLine={false}
          axisLine={false}
          dy={4}
        />
        <YAxis
          tick={{ fontSize: 11, fill: chartTickFill }}
          tickLine={false}
          axisLine={false}
          width={64}
          tickFormatter={(v) => formatBRL(v).replace('R$', '').trim()}
        />
        <Tooltip {...chartTooltipProps} formatter={(v) => [formatBRL(Number(v)), 'Faturamento']} />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--chart-1)"
          strokeWidth={2.5}
          fill="url(#rev-fill)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--bg-elevated)', fill: 'var(--chart-1)' }}
          animationDuration={750}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
