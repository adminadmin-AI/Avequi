'use client';

import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';
import { chartTooltipProps } from '@/lib/chart-theme';

/**
 * Sparkline compacta do painel de contas (OPS WP3 #910) — módulo separado
 * para o recharts continuar fora do chunk inicial da rota (next/dynamic,
 * mesmo padrão de components/workspace/widgets/charts.tsx).
 *
 * Sem eixos: é indicador de tendência, não gráfico de leitura fina — o
 * tooltip no hover cobre o caso de "quanto foi exatamente".
 */
export function UsageSparkline({
  data,
  color,
  label,
  formatter = (v) => String(v),
}: {
  data: { date: string; value: number }[];
  /** cor da linha/preenchimento — hex ou var(--token) */
  color: string;
  /** nome da série no tooltip */
  label: string;
  formatter?: (value: number) => string;
}) {
  const gradId = `ops-usage-spark-${label.replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <ResponsiveContainer width="100%" height={72}>
      <AreaChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Tooltip
          {...chartTooltipProps}
          labelFormatter={(d) => new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR')}
          formatter={(v) => [formatter(Number(v)), label]}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradId})`}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 2, stroke: 'var(--bg-elevated)', fill: color }}
          animationDuration={600}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
