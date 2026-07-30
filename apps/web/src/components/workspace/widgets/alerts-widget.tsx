'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { ALERT_TYPE_LABEL } from '@/app/app/alerts/alert-meta';
import type { WidgetComponentProps } from '../types';
import { EmptyContent, ListSkeleton, WidgetFrame } from '../widget-frame';

/**
 * Pendências & Alertas — zona de atenção. Consome GET /alerts (o hub central
 * de 17 tipos de alerta) e responde "o que precisa de mim agora?".
 * Na F1 este bloco evolui para o Resumo do Dia (insights da Antonella).
 */

interface Alert {
  id: string;
  type: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  body: string;
  entityId: string | null;
  entityType: string | null;
  createdAt: string;
}

export function AlertsWidget(_: WidgetComponentProps) {
  const router = useRouter();
  const alertsQ = useQuery({
    retry: false,
    staleTime: 60 * 1000,
    queryKey: ['/alerts'],
    queryFn: async () => (await apiClient.get<Alert[]>('/alerts')).data,
  });

  const pendencias = useMemo(() => {
    const order = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
    const all = [...(alertsQ.data ?? [])].sort((a, b) => order[a.severity] - order[b.severity]);
    // De-box: 3+ alertas do MESMO tipo viram UMA linha-resumo — nove dots
    // vermelhos idênticos são textura, não informação. O detalhe mora em /alerts.
    const byType = new Map<string, Alert[]>();
    for (const a of all) {
      const list = byType.get(a.type) ?? [];
      list.push(a);
      byType.set(a.type, list);
    }
    const rows: Alert[] = [];
    const summarized = new Set<string>();
    for (const a of all) {
      if (summarized.has(a.type)) continue;
      const group = byType.get(a.type)!;
      if (group.length >= 3) {
        summarized.add(a.type);
        rows.push({
          ...a,
          id: `group-${a.type}`,
          title: `${group.length}× ${ALERT_TYPE_LABEL[a.type as keyof typeof ALERT_TYPE_LABEL] ?? a.title}`,
          body: 'Toque para ver todos em Alertas.',
        });
      } else {
        rows.push(a);
      }
    }
    return rows.slice(0, 8);
  }, [alertsQ.data]);

  return (
    <WidgetFrame
      title={'Pendências & Alertas'}
      action={
        <Link
          href="/app/alerts"
          className="text-caption font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
        >
          ver todos
        </Link>
      }
    >
      {alertsQ.isLoading ? (
        <ListSkeleton />
      ) : pendencias.length === 0 ? (
        <EmptyContent label="Nenhuma pendência. Tudo em dia! 🎉" />
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {pendencias.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => router.push('/app/alerts')}
                className="group flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors duration-micro hover:bg-neutral-500/[0.05]"
              >
                <span
                  className={cn(
                    'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                    a.severity === 'CRITICAL'
                      ? 'bg-danger'
                      : a.severity === 'WARNING'
                        ? 'bg-warning'
                        : 'bg-info',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-content">{a.title}</span>
                  <span className="block truncate text-caption text-content-muted">{a.body}</span>
                </span>
                <ArrowRight
                  size={14}
                  className="mt-1 shrink-0 text-content-muted opacity-0 transition-opacity duration-micro group-hover:opacity-60"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </WidgetFrame>
  );
}
