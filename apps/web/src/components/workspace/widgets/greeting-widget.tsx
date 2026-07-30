'use client';

import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import type { WidgetComponentProps } from '../types';
import { ChromelessWidget } from '../widget-frame';
import { useWorkspacePeriod } from '../workspace-context';

const PERIODS = [
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
] as const;

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

/**
 * Saudação + seletor de período — zona de orientação, sem superfície.
 * O seletor mexe no período do WORKSPACE (contexto), não só desta seção.
 */
export function GreetingWidget(_: WidgetComponentProps) {
  const user = useAuthStore((s) => s.user);
  const firstName = user?.name?.split(' ')[0] ?? '';
  const { periodDays, setPeriodDays } = useWorkspacePeriod();

  return (
    <ChromelessWidget>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-heading text-content">
            {greeting()}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-body text-content-secondary">Visão geral da operação.</p>
        </div>
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              onClick={() => setPeriodDays(p.days)}
              className={cn(
                'rounded-md px-3 py-1.5 text-caption font-medium transition-colors',
                periodDays === p.days
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-300'
                  : 'text-content-secondary hover:text-content',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </ChromelessWidget>
  );
}
