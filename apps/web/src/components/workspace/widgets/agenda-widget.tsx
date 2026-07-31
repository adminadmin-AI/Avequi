'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/lib/utils';
import type { WidgetComponentProps } from '../types';
import { ChartSkeleton, EmptyState, WidgetFrame } from '../widget-frame';
import {
  groupByDate,
  monthGrid,
  monthWindowDays,
  rollingWeek,
  toIso,
  type AgendaKind,
  type CalendarItem,
} from '../agenda-calendar';

/**
 * Agenda — F1, zona de trabalho, como CALENDÁRIO (rodadas 2–3 do refinamento
 * UX, direção Apple Calendar): grid com hairlines, "hoje" em disco da marca,
 * eventos como chips com tint + texto na cor do tipo, e o DETALHE DO DIA num
 * popover ancorado na célula — nenhuma lista fixa ocupando o widget; 18
 * pagamentos no mesmo dia viram chips + "+15" e a lista flutua sob demanda.
 *
 * Duas projeções: Semana (rolante, hoje → +6, janela default do backend) e
 * Mês (grid do mês corrente; pede ?days ao backend só até o fim do grid).
 * Os dados continuam prospectivos e curados por permissão no backend
 * (GET /workspace/agenda) — dias passados aparecem vazios de propósito.
 */

export type AgendaItem = CalendarItem;

type ViewMode = 'week' | 'month';

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/**
 * Linguagem de calendário (Apple): chip = tint do tipo + texto na MESMA cor.
 * Financeiro âmbar · produção azul · CRM indigo; tone danger do item sobrepõe.
 */
const KIND_STYLE: Record<AgendaKind, { chip: string; dot: string }> = {
  'finance-due': {
    chip: 'bg-warning/15 text-warning-800 dark:bg-warning/20 dark:text-warning-300',
    dot: 'bg-warning',
  },
  'production-end': {
    chip: 'bg-info/15 text-info-800 dark:bg-info/20 dark:text-info-300',
    dot: 'bg-info',
  },
  'crm-reminder': {
    chip: 'bg-brand-500/15 text-brand-700 dark:bg-brand-500/25 dark:text-brand-300',
    dot: 'bg-brand-500',
  },
};

const DANGER_CHIP = 'bg-danger/15 text-danger-700 dark:bg-danger/20 dark:text-danger-300';

function itemChip(item: CalendarItem): string {
  return item.tone === 'danger' ? DANGER_CHIP : KIND_STYLE[item.kind]?.chip ?? 'bg-neutral-500/10';
}

function itemDot(item: CalendarItem): string {
  return item.tone === 'danger' ? 'bg-danger' : KIND_STYLE[item.kind]?.dot ?? 'bg-neutral-400';
}

function dayTitle(iso: string, todayIso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const long = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  if (iso === todayIso) return `Hoje · ${long}`;
  return long.charAt(0).toUpperCase() + long.slice(1);
}

export function AgendaWidget({ instance }: WidgetComponentProps) {
  const [view, setView] = useState<ViewMode>('week');
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
  const grid = useMemo(() => monthGrid(todayIso), [todayIso]);
  const weekDays = useMemo(() => rollingWeek(todayIso), [todayIso]);

  const maxChips = dense ? 0 : view === 'week' ? 4 : 2;

  /** Detalhe do dia — flutua ancorado na célula, estilo Apple. */
  const dayPopover = (iso: string, dayItems: CalendarItem[]) => (
    <PopoverContent align="center" className="w-80 overflow-hidden p-0">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5">
        <p className="text-sm font-semibold text-content">{dayTitle(iso, todayIso)}</p>
        <p className="shrink-0 text-helper tabular-nums text-content-muted">
          {dayItems.length} {dayItems.length === 1 ? 'item' : 'itens'}
        </p>
      </div>
      <ul className="max-h-64 overflow-y-auto p-1.5">
        {dayItems.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors duration-micro hover:bg-neutral-500/[0.05]"
            >
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', itemDot(item))} />
              <span className="min-w-0 flex-1 truncate text-sm text-content">{item.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </PopoverContent>
  );

  const cellBody = (dayItems: CalendarItem[]) =>
    maxChips === 0 ? (
      <span className="mt-auto flex items-center gap-1 px-0.5 pb-0.5">
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
      <span className="flex w-full min-w-0 flex-col gap-[3px]">
        {dayItems.slice(0, maxChips).map((i) => (
          <span
            key={i.id}
            className={cn(
              'block min-w-0 truncate rounded-[5px] px-1.5 py-[3px] text-[11px] font-medium leading-4',
              itemChip(i),
            )}
          >
            {i.title}
          </span>
        ))}
        {dayItems.length > maxChips && (
          <span className="px-1.5 text-helper font-medium tabular-nums text-content-muted">
            +{dayItems.length - maxChips} mais
          </span>
        )}
      </span>
    );

  /** Célula de eventos: com itens vira trigger de popover; vazia é inerte. */
  const eventCell = (iso: string, opts: { outside?: boolean; past?: boolean }) => {
    const dayItems = byDate.get(iso) ?? [];
    const isToday = iso === todayIso;
    const day = Number(iso.slice(8, 10));

    const cellClass = cn(
      'flex w-full flex-col gap-1 p-1.5 text-left',
      view === 'week' ? 'min-h-[108px]' : dense ? 'min-h-[52px]' : 'min-h-[76px]',
      isToday && 'bg-brand-500/[0.04]',
      opts.past && !isToday && 'opacity-40',
    );

    // Número do dia dentro da célula — só no mês (na semana ele mora no header)
    const dayNumber = view === 'month' && (
      <span className="flex justify-end">
        <span
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full text-caption tabular-nums',
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
    );

    if (dayItems.length === 0) {
      return (
        <div key={iso} className={cellClass}>
          {dayNumber}
        </div>
      );
    }

    return (
      <Popover key={iso}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              cellClass,
              'cursor-pointer transition-colors duration-micro hover:bg-neutral-500/[0.04]',
              'data-[state=open]:bg-brand-500/[0.06]',
            )}
          >
            {dayNumber}
            {cellBody(dayItems)}
          </button>
        </PopoverTrigger>
        {dayPopover(iso, dayItems)}
      </Popover>
    );
  };

  return (
    <WidgetFrame
      title="Agenda"
      badge={items.length}
      action={
        <SegmentedControl
          size="sm"
          aria-label="Projeção da agenda"
          value={view}
          onValueChange={(v) => setView(v)}
          options={[
            { value: 'week', label: 'Semana' },
            { value: 'month', label: 'Mês' },
          ]}
        />
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
        <div className="space-y-2.5">
          {view === 'month' && (
            <p className="px-0.5 text-sm font-semibold text-content">
              {grid.label.charAt(0).toUpperCase() + grid.label.slice(1)}
            </p>
          )}

          <div className="overflow-hidden rounded-lg border border-line">
            {/* Cabeçalho de colunas — fora das células, como um calendário de verdade */}
            <div className="grid grid-cols-7 divide-x divide-line border-b border-line bg-neutral-500/[0.03]">
              {view === 'week'
                ? weekDays.map((iso) => {
                    const isToday = iso === todayIso;
                    return (
                      <span
                        key={iso}
                        className={cn(
                          'flex flex-col items-center gap-1 py-2',
                          isToday && 'bg-brand-500/[0.04]',
                        )}
                      >
                        <span className="text-helper uppercase tracking-wide text-content-muted">
                          {WEEKDAY_SHORT[new Date(`${iso}T12:00:00`).getDay()]}
                        </span>
                        <span
                          className={cn(
                            'flex h-6 w-6 items-center justify-center rounded-full text-caption tabular-nums',
                            isToday
                              ? 'bg-brand-600 font-semibold text-white'
                              : 'font-medium text-content-secondary',
                          )}
                        >
                          {Number(iso.slice(8, 10))}
                        </span>
                      </span>
                    );
                  })
                : WEEKDAY_SHORT.map((w) => (
                    <span
                      key={w}
                      className="px-1.5 py-1.5 text-right text-helper uppercase tracking-wide text-content-muted"
                    >
                      {w}
                    </span>
                  ))}
            </div>

            {view === 'week' ? (
              <div className="grid grid-cols-7 divide-x divide-line">
                {weekDays.map((iso) => eventCell(iso, {}))}
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
                    eventCell(iso, {
                      outside: iso.slice(0, 7) !== todayIso.slice(0, 7),
                      past: iso < todayIso,
                    }),
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </WidgetFrame>
  );
}
