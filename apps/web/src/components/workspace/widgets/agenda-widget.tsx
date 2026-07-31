'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { WidgetComponentProps } from '../types';
import { ChartSkeleton, EmptyState, WidgetFrame } from '../widget-frame';
import {
  defaultSelectedDay,
  groupByDate,
  monthGrid,
  monthWindowDays,
  rollingWeek,
  toIso,
  type AgendaKind,
  type CalendarItem,
} from '../agenda-calendar';

/**
 * Agenda — F1, zona de trabalho, agora como CALENDÁRIO (rodada 2 do
 * refinamento UX, direção Apple Calendar): grid de dias com hairlines,
 * "hoje" em disco da marca, eventos como chips com tint por tipo e
 * "+N" quando estoura. Clicar num dia abre a lista completa dele ABAIXO
 * do grid — 18 pagamentos no mesmo dia viram 3 chips + "+15", nunca um
 * paredão de linhas.
 *
 * Duas projeções: Semana (rolante, hoje → +6, janela default do backend) e
 * Mês (grid do mês corrente; pede ?days ao backend só até o fim do grid).
 * Os dados continuam prospectivos e curados por permissão no backend
 * (GET /workspace/agenda) — dias passados aparecem vazios de propósito.
 */

export type AgendaItem = CalendarItem;

type ViewMode = 'week' | 'month';

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Cor do tipo (linguagem de calendário); tone danger do item sobrepõe. */
const KIND_STYLE: Record<AgendaKind, { chip: string; dot: string }> = {
  'finance-due': { chip: 'bg-warning/15', dot: 'bg-warning' },
  'production-end': { chip: 'bg-info/15', dot: 'bg-info' },
  'crm-reminder': { chip: 'bg-brand-500/15', dot: 'bg-brand-500' },
};

function itemDot(item: CalendarItem): string {
  return item.tone === 'danger' ? 'bg-danger' : KIND_STYLE[item.kind]?.dot ?? 'bg-neutral-400';
}

function itemChip(item: CalendarItem): string {
  return item.tone === 'danger' ? 'bg-danger/15' : KIND_STYLE[item.kind]?.chip ?? 'bg-neutral-500/10';
}

function selectedDayLabel(iso: string, todayIso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const ddmm = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  if (iso === todayIso) return `Hoje · ${ddmm}`;
  const diff = Math.round((d.getTime() - new Date(`${todayIso}T12:00:00`).getTime()) / 86_400_000);
  if (diff === 1) return `Amanhã · ${ddmm}`;
  return `${WEEKDAY_SHORT[d.getDay()]} · ${ddmm}`;
}

export function AgendaWidget({ instance }: WidgetComponentProps) {
  const [view, setView] = useState<ViewMode>('week');
  const [picked, setPicked] = useState<string | null>(null);
  const dense = (instance.size ?? 'full') === 'half';

  const todayIso = toIso(new Date());
  const windowDays = view === 'month' ? monthWindowDays(todayIso) : 7;

  const agendaQ = useQuery({
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryKey: ['/workspace/agenda', windowDays],
    queryFn: async () =>
      (
        await apiClient.get<AgendaItem[]>('/workspace/agenda', {
          params: windowDays === 7 ? undefined : { days: windowDays },
        })
      ).data,
  });

  const items = useMemo(() => agendaQ.data ?? [], [agendaQ.data]);
  const byDate = useMemo(() => groupByDate(items), [items]);
  const selected = picked ?? defaultSelectedDay(byDate, todayIso);
  const selectedItems = byDate.get(selected) ?? [];

  const grid = useMemo(() => monthGrid(todayIso), [todayIso]);
  const weekDays = useMemo(() => rollingWeek(todayIso), [todayIso]);

  // Chips por célula: semana respira mais que mês; denso vira só dots.
  const maxChips = dense ? 0 : view === 'week' ? 3 : 2;

  const renderCell = (iso: string, opts: { outside?: boolean; past?: boolean }) => {
    const dayItems = byDate.get(iso) ?? [];
    const isToday = iso === todayIso;
    const isSelected = iso === selected;
    const day = Number(iso.slice(8, 10));
    const clickable = !opts.past || dayItems.length > 0;

    return (
      <button
        key={iso}
        onClick={() => clickable && setPicked(iso)}
        disabled={!clickable}
        className={cn(
          'flex flex-col gap-1 p-1.5 text-left transition-colors duration-micro',
          view === 'week' ? 'min-h-[92px]' : dense ? 'min-h-[52px]' : 'min-h-[72px]',
          clickable && 'hover:bg-neutral-500/[0.04]',
          isSelected && 'bg-brand-500/[0.06]',
          opts.past && !isToday && 'opacity-45',
        )}
      >
        <span className="flex items-center justify-between">
          {view === 'week' && (
            <span className="text-helper uppercase tracking-wide text-content-muted">
              {WEEKDAY_SHORT[new Date(`${iso}T12:00:00`).getDay()]}
            </span>
          )}
          <span
            className={cn(
              'ml-auto flex h-6 w-6 items-center justify-center rounded-full text-caption tabular-nums',
              isToday
                ? 'bg-brand-600 font-semibold text-white'
                : opts.outside
                  ? 'text-content-muted'
                  : 'font-medium text-content-secondary',
            )}
          >
            {day}
          </span>
        </span>

        {dayItems.length > 0 &&
          (maxChips === 0 ? (
            <span className="mt-auto flex items-center gap-1">
              {dayItems.slice(0, 3).map((i) => (
                <span key={i.id} className={cn('h-1.5 w-1.5 rounded-full', itemDot(i))} />
              ))}
              {dayItems.length > 3 && (
                <span className="text-helper tabular-nums text-content-muted">
                  +{dayItems.length - 3}
                </span>
              )}
            </span>
          ) : (
            <span className="flex w-full min-w-0 flex-col gap-0.5">
              {dayItems.slice(0, maxChips).map((i) => (
                <span
                  key={i.id}
                  className={cn(
                    'flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] leading-4 text-content',
                    itemChip(i),
                  )}
                >
                  <span className={cn('h-1 w-1 shrink-0 rounded-full', itemDot(i))} />
                  <span className="min-w-0 truncate">{i.title}</span>
                </span>
              ))}
              {dayItems.length > maxChips && (
                <span className="px-1 text-helper tabular-nums text-content-muted">
                  +{dayItems.length - maxChips} mais
                </span>
              )}
            </span>
          ))}
      </button>
    );
  };

  return (
    <WidgetFrame
      title="Agenda"
      badge={items.length}
      action={
        <span className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {(
            [
              { mode: 'week', label: 'Semana' },
              { mode: 'month', label: 'Mês' },
            ] as const
          ).map(({ mode, label }) => (
            <button
              key={mode}
              onClick={() => {
                setView(mode);
                setPicked(null);
              }}
              className={cn(
                'rounded-md px-2.5 py-1 text-caption font-medium transition-colors duration-micro',
                view === mode
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-300'
                  : 'text-content-secondary hover:text-content',
              )}
            >
              {label}
            </button>
          ))}
        </span>
      }
    >
      {agendaQ.isLoading ? (
        <ChartSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={CalendarCheck2}
          tone="success"
          title={view === 'week' ? 'Semana livre' : 'Mês livre'}
          hint="Nenhum vencimento ou compromisso na janela."
        />
      ) : (
        <div className="space-y-3">
          {view === 'month' && (
            <p className="text-sm font-semibold text-content">
              {grid.label.charAt(0).toUpperCase() + grid.label.slice(1)}
            </p>
          )}

          <div className="overflow-hidden rounded-lg border border-line">
            {view === 'month' && (
              <div className="grid grid-cols-7 divide-x divide-line border-b border-line bg-neutral-500/[0.03]">
                {WEEKDAY_SHORT.map((w) => (
                  <span
                    key={w}
                    className="px-1.5 py-1 text-right text-helper uppercase tracking-wide text-content-muted"
                  >
                    {w}
                  </span>
                ))}
              </div>
            )}
            {view === 'week' ? (
              <div className="grid grid-cols-7 divide-x divide-line">
                {weekDays.map((iso) => renderCell(iso, {}))}
              </div>
            ) : (
              grid.weeks.map((week, wi) => (
                <div
                  key={week[0]}
                  className={cn(
                    'grid grid-cols-7 divide-x divide-line',
                    wi > 0 && 'border-t border-line',
                  )}
                >
                  {week.map((iso) =>
                    renderCell(iso, {
                      outside: iso.slice(0, 7) !== todayIso.slice(0, 7),
                      past: iso < todayIso,
                    }),
                  )}
                </div>
              ))
            )}
          </div>

          {/* Dia selecionado: o detalhe mora aqui, nunca espalhado no grid */}
          <div>
            <p className="mb-1 flex items-baseline justify-between text-helper font-medium uppercase tracking-wide text-content-muted">
              <span>{selectedDayLabel(selected, todayIso)}</span>
              {selectedItems.length > 0 && (
                <span className="tabular-nums">
                  {selectedItems.length} {selectedItems.length === 1 ? 'item' : 'itens'}
                </span>
              )}
            </p>
            {selectedItems.length === 0 ? (
              <p className="py-1.5 text-caption text-content-muted">
                Nenhum compromisso neste dia.
              </p>
            ) : (
              <ul className="-mx-2 max-h-56 overflow-y-auto">
                {selectedItems.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors duration-micro hover:bg-neutral-500/[0.05]"
                    >
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', itemDot(item))} />
                      <span className="min-w-0 flex-1 truncate text-sm text-content">
                        {item.title}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </WidgetFrame>
  );
}
