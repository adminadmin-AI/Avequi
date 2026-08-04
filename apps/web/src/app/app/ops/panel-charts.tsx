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
import type { BilledPeriod } from '@/types/api';
import { periodLongLabel, periodShortLabel } from './panel-format';

/**
 * Gráficos do Painel da Operadora (#957) — módulo separado para o recharts
 * (~100kb gz) continuar fora do chunk inicial da rota, carregado via
 * `next/dynamic` (mesmo padrão de `ops/[id]/usage-charts.tsx` e de
 * `components/workspace/widgets/charts.tsx`).
 *
 * Look premium do refinamento v1.24: linha suave + área com gradiente que
 * some no fundo, grid quase invisível, tooltip do tema (dark/light) e
 * animação de desenho.
 */
export function FaturamentoAreaChart({ data }: { data: BilledPeriod[] }) {
  // Centavos ficam no back; o gráfico trabalha em reais para os eixos e o
  // tooltip usarem os mesmos formatadores do resto do app.
  const pontos = data.map((p) => ({
    period: p.period,
    label: periodShortLabel(p.period),
    value: p.amountCents / 100,
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={pontos} margin={{ top: 10, right: 12, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="ops-faturamento-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...chartGridProps} strokeDasharray="3 4" />
        <XAxis
          dataKey="label"
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
        <Tooltip
          {...chartTooltipProps}
          labelFormatter={(_, payload) =>
            periodLongLabel(String(payload?.[0]?.payload?.period ?? ''))
          }
          formatter={(v) => [formatBRL(Number(v)), 'Faturado']}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--chart-1)"
          strokeWidth={2.5}
          fill="url(#ops-faturamento-fill)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--bg-elevated)', fill: 'var(--chart-1)' }}
          animationDuration={750}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
