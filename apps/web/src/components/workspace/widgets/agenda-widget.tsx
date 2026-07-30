'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { WidgetComponentProps } from '../types';
import { ListSkeleton, WidgetFrame } from '../widget-frame';

/**
 * Agenda da semana — F1, zona de trabalho. Visão PROSPECTIVA (próximos 7
 * dias) sobre datas que já existem espalhadas pelo sistema — vencimentos
 * financeiros, términos de OP, lembretes de CRM — unificadas pelo backend
 * (GET /workspace/agenda) e curadas por permissão.
 */

export interface AgendaItem {
  id: string;
  date: string; // ISO yyyy-mm-dd
  kind: 'finance-due' | 'production-end' | 'crm-reminder';
  title: string;
  href: string;
  tone?: 'danger' | 'warning' | 'neutral';
}

const WEEKDAY = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function dayLabel(iso: string, todayIso: string): string {
  if (iso === todayIso) return 'Hoje';
  const d = new Date(`${iso}T12:00:00`);
  const today = new Date(`${todayIso}T12:00:00`);
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff === 1) return 'Amanhã';
  return `${WEEKDAY[d.getDay()]} · ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
}

export function AgendaWidget(_: WidgetComponentProps) {
  const agendaQ = useQuery({
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryKey: ['/workspace/agenda'],
    queryFn: async () => (await apiClient.get<AgendaItem[]>('/workspace/agenda')).data,
  });

  const todayIso = new Date().toISOString().slice(0, 10);

  const byDay = useMemo(() => {
    const groups = new Map<string, AgendaItem[]>();
    for (const item of agendaQ.data ?? []) {
      const list = groups.get(item.date) ?? [];
      list.push(item);
      groups.set(item.date, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [agendaQ.data]);

  return (
    <WidgetFrame title="Agenda da semana">
      {agendaQ.isLoading ? (
        <ListSkeleton />
      ) : byDay.length === 0 ? (
        <p className="py-2 text-caption text-content-muted">
          Semana livre de vencimentos e compromissos.
        </p>
      ) : (
        <div className="space-y-3">
          {byDay.map(([date, items]) => (
            <div key={date}>
              <p className="mb-1 text-helper font-medium uppercase tracking-wide text-content-muted">
                {dayLabel(date, todayIso)}
              </p>
              <ul className="-mx-2">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors duration-micro hover:bg-neutral-500/[0.05]"
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 shrink-0 rounded-full',
                          item.tone === 'danger'
                            ? 'bg-danger'
                            : item.tone === 'warning'
                              ? 'bg-warning'
                              : 'bg-neutral-400 dark:bg-neutral-600',
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-content">
                        {item.title}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </WidgetFrame>
  );
}
