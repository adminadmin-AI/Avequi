import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

/**
 * StatGroup — números como TIPOGRAFIA sobre o canvas (F3 Convergência).
 *
 * O padrão de-boxed do dashboard vira o jeito único de mostrar indicadores
 * acima de listagens: sem caixa, sem borda — o número respira no canvas e a
 * tabela/conteúdo abaixo fica com o protagonismo de superfície. A cor
 * semântica só aparece quando é alarme de verdade (danger/warning).
 *
 * Escala idêntica aos KPIs secundários do dashboard (19px) para o produto
 * inteiro falar a mesma língua.
 */

const ICON_TONE: Record<string, string> = {
  neutral: 'text-content-muted',
  brand: 'text-content-muted',
  success: 'text-content-muted',
  info: 'text-content-muted',
  warning: 'text-warning',
  danger: 'text-danger',
};

export interface StatItem {
  label: string;
  value: string;
  icon?: LucideIcon;
  tone?: keyof typeof ICON_TONE;
  sub?: string;
}

export function StatGroup({
  stats,
  loading,
  className,
}: {
  stats: StatItem[];
  loading?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap gap-x-10 gap-y-4', className)}>
      {stats.map((s) => (
        <Stat key={s.label} {...s} loading={loading} />
      ))}
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  sub,
  loading,
}: StatItem & { loading?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon size={13} className={cn('shrink-0', ICON_TONE[tone])} />}
        <span className="truncate text-caption text-content-muted">{label}</span>
      </div>
      {loading ? (
        <div className="mt-1.5 h-7 w-20 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
      ) : (
        <p
          className={cn(
            'mt-1 truncate text-[19px] font-semibold leading-7 tracking-[-0.02em] tabular-nums',
            tone === 'danger' ? 'text-danger' : 'text-content',
          )}
          title={value}
        >
          {value}
        </p>
      )}
      {sub && !loading && <p className="mt-0.5 text-helper text-content-muted">{sub}</p>}
    </div>
  );
}
