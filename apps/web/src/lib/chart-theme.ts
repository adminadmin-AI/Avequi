import type { CSSProperties } from 'react';

/**
 * Tema compartilhado dos gráficos (Recharts) — dark-mode aware via CSS vars.
 *
 * ⚠️ Recharts pinta o TEXTO dos itens do tooltip com a cor da série por
 * padrão (indigo sobre fundo escuro = ilegível). `itemStyle`/`labelStyle`
 * são obrigatórios junto do `contentStyle` — espalhe `chartTooltipProps`
 * em TODO <Tooltip> sem renderer customizado:
 *
 *   <Tooltip {...chartTooltipProps} formatter={...} />
 */
export const chartTooltipProps = {
  contentStyle: {
    borderRadius: 10,
    border: '1px solid var(--border-default)',
    background: 'var(--bg-elevated)',
    boxShadow: '0 4px 12px -2px rgb(15 23 42 / 0.10)',
    fontSize: 12,
  } as CSSProperties,
  itemStyle: { color: 'var(--text-primary)' } as CSSProperties,
  labelStyle: { color: 'var(--text-muted)', marginBottom: 2 } as CSSProperties,
  cursor: { fill: 'rgb(148 163 184 / 0.08)' },
} as const;

/** Grid horizontal quase invisível, ciente do tema. Espalhe no <CartesianGrid>. */
export const chartGridProps = { stroke: 'var(--border-default)', vertical: false } as const;

/** Cor de tick de eixo ciente do tema (use em tick={{ fontSize: N, fill: chartTickFill }}). */
export const chartTickFill = 'var(--text-muted)';
