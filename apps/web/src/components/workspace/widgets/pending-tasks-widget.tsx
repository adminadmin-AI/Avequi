'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BadgeCheck, Bell, Check, CheckCircle2, CircleDollarSign, ClipboardCheck, type LucideIcon } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { WidgetComponentProps } from '../types';
import { EmptyState, ListSkeleton, WidgetFrame } from '../widget-frame';
import { relativeTime } from '../workspace-context';

/**
 * Minhas Pendências — F1, zona de atenção. Agregador cross-módulo do
 * "trabalho esperando por MIM": aprovações na minha alçada, follow-ups de
 * CRM e inspeções de qualidade.
 *
 * "Concluir com prazer" (rodada UX 31/07): pendências CONCLUÍVEIS num clique
 * (hoje: lembretes de CRM, que trazem `complete.url` do backend) ganham um
 * círculo de check à esquerda. Ao marcar, a linha risca, o check enche de
 * verde e a linha DESLIZA pra fora colapsando — o resto sobe suave. É o
 * momento de satisfação de tirar algo da lista. Aprovações e inspeções não
 * têm check (só se resolvem na tela do domínio — marcar aqui seria mentira).
 */

export interface WorkspaceTask {
  id: string;
  type: 'approval' | 'crm-reminder' | 'quality-inspection' | 'overdue-receivable';
  title: string;
  subtitle?: string;
  href: string;
  dueAt?: string;
  createdAt?: string;
  priority?: 'critical' | 'warning' | 'info';
  /** Só quando a pendência pode ser concluída num clique direto daqui. */
  complete?: { url: string };
}

const TYPE_ICON: Record<WorkspaceTask['type'], LucideIcon> = {
  approval: BadgeCheck,
  'crm-reminder': Bell,
  'quality-inspection': ClipboardCheck,
  'overdue-receivable': CircleDollarSign,
};

/** Cor do ícone/trilho por prioridade — dinheiro vencido grita, follow-up sussurra. */
const PRIORITY_ICON: Record<NonNullable<WorkspaceTask['priority']>, string> = {
  critical: 'text-danger',
  warning: 'text-warning',
  info: 'text-content-muted',
};
const PRIORITY_RAIL: Record<NonNullable<WorkspaceTask['priority']>, string> = {
  critical: 'border-l-2 border-l-danger bg-danger/[0.04]',
  warning: 'border-l-2 border-l-warning bg-warning/[0.03]',
  info: '',
};

// Espera a animação de saída terminar antes de disparar o done no backend.
const EXIT_MS = 340;

export function PendingTasksWidget(_: WidgetComponentProps) {
  const qc = useQueryClient();
  const [completing, setCompleting] = useState<Set<string>>(new Set());

  const tasksQ = useQuery({
    retry: false,
    staleTime: 60 * 1000,
    queryKey: ['/workspace/tasks'],
    queryFn: async () => (await apiClient.get<WorkspaceTask[]>('/workspace/tasks')).data,
  });

  const doneM = useMutation({
    mutationFn: (url: string) => apiClient.patch(url),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/workspace/tasks'] }),
  });

  const tasks = (tasksQ.data ?? []).slice(0, 8);

  function handleComplete(task: WorkspaceTask) {
    if (!task.complete || completing.has(task.id)) return;
    setCompleting((prev) => new Set(prev).add(task.id));
    // Anima a saída; só então conclui no backend (o refetch remove a linha).
    window.setTimeout(() => doneM.mutate(task.complete!.url), EXIT_MS);
  }

  return (
    <WidgetFrame title="Minha Mesa" badge={tasks.length}>
      {tasksQ.isLoading ? (
        <ListSkeleton />
      ) : tasks.length === 0 ? (
        <div className="animate-in fade-in zoom-in-95 duration-deliberate ease-flow">
          <EmptyState
            icon={CheckCircle2}
            tone="success"
            title="Nenhuma pendência encontrada"
            hint="Excelente trabalho — nada esperando por você."
          />
        </div>
      ) : (
        <ul className="-mx-2">
          {tasks.map((t) => {
            const Icon = TYPE_ICON[t.type] ?? BadgeCheck;
            const when = t.dueAt ?? t.createdAt;
            const isCompleting = completing.has(t.id);
            const canComplete = !!t.complete;

            return (
              <li
                key={t.id}
                className={cn(
                  'overflow-hidden transition-all ease-flow',
                  isCompleting
                    ? 'max-h-0 -translate-x-3 opacity-0 duration-[340ms]'
                    : 'max-h-24 opacity-100 duration-flow',
                )}
              >
                <div
                  className={cn(
                    'flex items-start gap-2.5 rounded-lg px-2 py-2.5',
                    t.priority && PRIORITY_RAIL[t.priority],
                  )}
                >
                  {canComplete ? (
                    <button
                      onClick={() => handleComplete(t)}
                      aria-label={`Concluir: ${t.title}`}
                      className={cn(
                        'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-all duration-fast ease-orbital',
                        isCompleting
                          ? 'scale-110 border-success bg-success text-white'
                          : 'border-line text-transparent hover:border-success hover:text-success/40',
                      )}
                    >
                      <Check size={12} strokeWidth={3} />
                    </button>
                  ) : (
                    <Icon
                      size={15}
                      className={cn('mt-0.5 shrink-0', t.priority ? PRIORITY_ICON[t.priority] : 'text-content-muted')}
                    />
                  )}

                  <Link
                    href={t.href}
                    className="group flex min-w-0 flex-1 items-start gap-2"
                    tabIndex={isCompleting ? -1 : 0}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate text-sm text-content transition-colors duration-fast',
                          isCompleting && 'text-content-muted line-through',
                        )}
                      >
                        {t.title}
                      </span>
                      {(t.subtitle || when) && (
                        <span className="block truncate text-caption text-content-muted">
                          {[t.subtitle, when ? relativeTime(when) : null].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </span>
                    <ArrowRight
                      size={14}
                      className="mt-1 shrink-0 text-content-muted opacity-0 transition-opacity duration-micro group-hover:opacity-60"
                    />
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetFrame>
  );
}
