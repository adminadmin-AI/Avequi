'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatBRL } from '@/lib/format';
import { chartTooltipProps } from '@/lib/chart-theme';
import type { CashFlowWeek } from './cashflow-widget';

/**
 * Sparkline do fluxo 13 semanas — módulo separado para o recharts continuar
 * fora do chunk inicial (next/dynamic, padrão #323).
 */
export function CashFlowSparkline({ data }: { data: CashFlowWeek[] }) {
  const series = data.map((w) => ({
    week: new Date(`${w.weekStart}T12:00:00`).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
    }),
    saldo: w.projectedBalance,
  }));
  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
        <CartesianGrid stroke="var(--border-default)" vertical={false} />
        <XAxis
          dataKey="week"
          tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v) => formatBRL(v).replace('R$', '').trim()}
        />
        <Tooltip {...chartTooltipProps} formatter={(v) => [formatBRL(Number(v)), 'Saldo projetado']} />
        <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="4 4" />
        <Area
          type="monotone"
          dataKey="saldo"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="var(--chart-1)"
          fillOpacity={0.08}
          animationDuration={600}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
