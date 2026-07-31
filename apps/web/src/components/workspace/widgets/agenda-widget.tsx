'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck2, ChevronDown } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { WidgetComponentProps } from '../types';
import { EmptyState, ListSkeleton, WidgetFrame } from '../widget-frame';
import { summarizeAgenda, type AgendaKind } from '../agenda-summary';

/**
 * Agenda da semana — F1, zona de trabalho. Visão PROSPECTIVA (próximos 7
 * dias) sobre datas que já existem espalhadas pelo sistema — vencimentos
 * financeiros, términos de OP, lembretes de CRM — unificadas pelo backend
 * (GET /workspace/agenda) e curadas por permissão.
 *
 * Expansão inteligente (auditoria UX 30/07): com muitos compromissos, o
 * widget abre COMPACTO — uma linha-resumo por tipo, com o recorte de hoje —
 * e a lista completa fica atrás de "Mostrar detalhes". Semana curta (até 4
 * itens) mostra a lista direto: colapsar 2 linhas seria cerimônia.
 */

export interface AgendaItem {
  id: string;
  date: string; // ISO yyyy-mm-dd
  kind: AgendaKind;
  title: string;
  href: string;
  tone?: 'danger' | 'warning' | 'neutral';
}

const COMPACT_THRESHOLD = 4;

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
  const [expanded, setExpanded] = useState(false);
  const agendaQ = useQuery({
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryKey: ['/workspace/agenda'],
    queryFn: async () => (await apiClient.get<AgendaItem[]>('/workspace/agenda')).data,
  });

  const items = useMemo(() => agendaQ.data ?? [], [agendaQ.data]);
  const todayIso = new Date().toISOString().slice(0, 10);

  const summary = useMemo(() => summarizeAgenda(items, todayIso), [items, todayIso]);

  const byDay = useMemo(() => {
    const groups = new Map<string, AgendaItem[]>();
    for (const item of items) {
      const list = groups.get(item.date) ?? [];
      list.push(item);
      groups.set(item.date, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const collapsible = items.length > COMPACT_THRESHOLD;
  const showList = !collapsible || expanded;

  return (
    <WidgetFrame title="Agenda da semana" badge={items.length}>
      {agendaQ.isLoading ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={CalendarCheck2}
          tone="success"
          title="Semana livre"
          hint="Nenhum vencimento ou compromisso nos próximos 7 dias."
        />
      ) : (
        <div className="space-y-3">
          {!showList && (
            <ul className="space-y-1">
              {summary.map((s) => (
                <li key={s.kind} className="flex items-center gap-2.5 py-1.5">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      s.hasDanger ? 'bg-danger' : 'bg-neutral-400 dark:bg-neutral-600',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-content">{s.label}</span>
                  {s.today > 0 && (
                    <span className="shrink-0 text-caption font-medium text-content-secondary">
                      {s.today} hoje
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {showList && (
            <div className="space-y-3">
              {byDay.map(([date, dayItems]) => (
                <div key={date}>
                  <p className="mb-1 text-helper font-medium uppercase tracking-wide text-content-muted">
                    {dayLabel(date, todayIso)}
                  </p>
                  <ul className="-mx-2">
                    {dayItems.map((item) => (
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

          {collapsible && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="flex items-center gap-1.5 text-caption font-medium text-content-secondary transition-colors duration-micro hover:text-content"
            >
              <ChevronDown
                size={14}
                className={cn('transition-transform duration-fast ease-flow', expanded && 'rotate-180')}
              />
              {expanded ? 'Ocultar detalhes' : 'Mostrar detalhes'}
            </button>
          )}
        </div>
      )}
    </WidgetFrame>
  );
}
