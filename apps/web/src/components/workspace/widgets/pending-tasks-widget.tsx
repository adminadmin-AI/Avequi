'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BadgeCheck, Bell, CheckCircle2, ClipboardCheck, type LucideIcon } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import type { WidgetComponentProps } from '../types';
import { EmptyState, ListSkeleton, WidgetFrame } from '../widget-frame';
import { relativeTime } from '../workspace-context';

/**
 * Minhas Pendências — F1, zona de atenção. Agregador cross-módulo do
 * "trabalho esperando por MIM": aprovações na minha alçada, follow-ups de
 * CRM e inspeções de qualidade (as 3 fontes fortes da F1; mais fontes
 * entram no backend sem mexer aqui).
 */

export interface WorkspaceTask {
  id: string;
  type: 'approval' | 'crm-reminder' | 'quality-inspection';
  title: string;
  subtitle?: string;
  href: string;
  dueAt?: string;
  createdAt?: string;
}

const TYPE_ICON: Record<WorkspaceTask['type'], LucideIcon> = {
  approval: BadgeCheck,
  'crm-reminder': Bell,
  'quality-inspection': ClipboardCheck,
};

export function PendingTasksWidget(_: WidgetComponentProps) {
  const tasksQ = useQuery({
    retry: false,
    staleTime: 60 * 1000,
    queryKey: ['/workspace/tasks'],
    queryFn: async () => (await apiClient.get<WorkspaceTask[]>('/workspace/tasks')).data,
  });

  const tasks = (tasksQ.data ?? []).slice(0, 8);

  return (
    <WidgetFrame title="Minhas Pendências" badge={tasks.length}>
      {tasksQ.isLoading ? (
        <ListSkeleton />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          tone="success"
          title="Nenhuma pendência encontrada"
          hint="Excelente trabalho — nada esperando por você."
        />
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {tasks.map((t) => {
            const Icon = TYPE_ICON[t.type] ?? BadgeCheck;
            const when = t.dueAt ?? t.createdAt;
            return (
              <li key={t.id}>
                <Link
                  href={t.href}
                  className="group flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors duration-micro hover:bg-neutral-500/[0.05]"
                >
                  <Icon size={15} className="mt-0.5 shrink-0 text-content-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-content">{t.title}</span>
                    {(t.subtitle || when) && (
                      <span className="block truncate text-caption text-content-muted">
                        {[t.subtitle, when ? relativeTime(when) : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                  </span>
                  <ArrowRight
                    size={14}
                    className="mt-1 shrink-0 text-content-muted opacity-0 transition-opacity duration-micro group-hover:opacity-60"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetFrame>
  );
}
