'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarCheck2, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { formatBRL } from '@/lib/format';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/lib/utils';
import type { WidgetComponentProps } from '../types';
import { ChartSkeleton, EmptyState, WidgetFrame } from '../widget-frame';
import {
  compactBRL,
  groupByDate,
  groupOf,
  monthFitsWindow,
  monthGrid,
  monthWindowDays,
  rollingWeek,
  summarizeDay,
  toIso,
  weekFitsWindow,
  weekWindowDays,
  type CalendarItem,
  type DayGroup,
} from '../agenda-calendar';

/**
 * Agenda — F1, zona de trabalho, como CALENDÁRIO (rodadas 2–4 do refinamento
 * UX, direção Apple Calendar): grid com hairlines, "hoje" em disco da marca,
 * fim de semana esmaecido, e navegação ‹ Hoje › dentro da janela prospectiva
 * de 42 dias do backend.
 *
 * Rollup executivo (rodada 4): dia denso NÃO vira pilha de chips truncados —
 * agrega por grupo com soma ("18 pagamentos · R$ 132 mil"). O detalhe mora
 * no popover ancorado na célula: total do dia no header e atalhos por
 * domínio no rodapé (as linhas são leitura; navegação honesta é o rodapé,
 * já que o backend ainda não dá deep-link por lançamento).
 *
 * Dados prospectivos e curados por permissão no backend (GET
 * /workspace/agenda?days) — dias passados aparecem vazios de propósito.
 */

export type AgendaItem = CalendarItem;

type ViewMode = 'week' | 'month';

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/**
 * Linguagem de calendário (Apple): chip = tint + texto na cor do GRUPO.
 * A pagar âmbar · a receber verde · produção azul · CRM indigo; danger sobrepõe.
 */
const GROUP_STYLE: Record<DayGroup, { chip: string; dot: string; label: string }> = {
  payable: {
    chip: 'bg-warning/15 text-warning-800 dark:bg-warning/20 dark:text-warning-300',
    dot: 'bg-warning',
    label: 'a pagar',
  },
  receivable: {
    chip: 'bg-success/15 text-success-800 dark:bg-success/20 dark:text-success-300',
    dot: 'bg-success',
    label: 'a receber',
  },
  production: {
    chip: 'bg-info/15 text-info-800 dark:bg-info/20 dark:text-info-300',
    dot: 'bg-info',
    label: 'produção',
  },
  crm: {
    chip: 'bg-brand-500/15 text-brand-700 dark:bg-brand-500/25 dark:text-brand-300',
    dot: 'bg-brand-500',
    label: 'CRM',
  },
};

const DANGER_CHIP = 'bg-danger/15 text-danger-700 dark:bg-danger/20 dark:text-danger-300';

const GROUP_LINK: Record<DayGroup, { href: string; label: string }> = {
  payable: { href: '/app/finance/payables', label: 'Contas a pagar' },
  receivable: { href: '/app/finance/receivables', label: 'Contas a receber' },
  production: { href: '/app/production', label: 'Produção' },
  crm: { href: '/app/crm/leads', label: 'CRM' },
};

function rollupLabel(group: DayGroup, count: number): string {
  switch (group) {
    case 'payable':
      return count === 1 ? '1 pagamento' : `${count} pagamentos`;
    case 'receivable':
      return count === 1 ? '1 recebimento' : `${count} recebimentos`;
    case 'production':
      return count === 1 ? '1 OP termina' : `${count} OPs terminam`;
    case 'crm':
      return count === 1 ? '1 lembrete' : `${count} lembretes`;
  }
}

function itemChip(item: CalendarItem): string {
  return item.tone === 'danger' ? DANGER_CHIP : GROUP_STYLE[groupOf(item)].chip;
}

function itemDot(item: CalendarItem): string {
  return item.tone === 'danger' ? 'bg-danger' : GROUP_STYLE[groupOf(item)].dot;
}

function isWeekend(iso: string): boolean {
  const dow = new Date(`${iso}T12:00:00`).getDay();
  return dow === 0 || dow === 6;
}

function dayTitle(iso: string, todayIso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const long = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  if (iso === todayIso) return `Hoje · ${long}`;
  return long.charAt(0).toUpperCase() + long.slice(1);
}

function shortDay(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'short',
  });
}

export function AgendaWidget({ instance }: WidgetComponentProps) {
  const [view, setView] = useState<ViewMode>('week');
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const dense = (instance.size ?? 'full') === 'half';
  // Em meia largura o grid de mês fica ilegível — o widget se fixa na semana.
  const mode: ViewMode = dense ? 'week' : view;

  const todayIso = toIso(new Date());
  const windowDays =
    mode === 'month' ? monthWindowDays(todayIso, monthOffset) : weekWindowDays(weekOffset);

  const agendaQ = useQuery({
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryKey: ['/workspace/agenda', windowDays],
    // Janela nova mantém a anterior na tela enquanto carrega — a troca de
    // visão/offset nunca derruba o grid para um skeleton.
    placeholderData: (prev) => prev,
    queryFn: async () =>
      (
        await apiClient.get<AgendaItem[]>('/workspace/agenda', {
          params: windowDays === 7 ? undefined : { days: windowDays },
        })
      ).data,
  });

  const items = useMemo(() => agendaQ.data ?? [], [agendaQ.data]);
  const byDate = useMemo(() => groupByDate(items), [items]);
  const grid = useMemo(() => monthGrid(todayIso, monthOffset), [todayIso, monthOffset]);
  const weekDays = useMemo(() => rollingWeek(todayIso, weekOffset), [todayIso, weekOffset]);
  const refreshing = agendaQ.isFetching && !agendaQ.isLoading;

  const offset = mode === 'month' ? monthOffset : weekOffset;
  const canPrev = offset > 0;
  const canNext =
    mode === 'month' ? monthFitsWindow(todayIso, monthOffset + 1) : weekFitsWindow(weekOffset + 1);
  const nav = (delta: number) =>
    mode === 'month'
      ? setMonthOffset((o) => Math.max(0, o + delta))
      : setWeekOffset((o) => Math.max(0, o + delta));
  const goToday = () => (mode === 'month' ? setMonthOffset(0) : setWeekOffset(0));

  const rangeLabel =
    mode === 'month'
      ? grid.label.charAt(0).toUpperCase() + grid.label.slice(1)
      : `${shortDay(weekDays[0])} – ${shortDay(weekDays[6])}`;

  const maxChips = dense ? 0 : mode === 'week' ? 4 : 2;

  // Badge e legenda contam o PERÍODO VISÍVEL, não a janela inteira do fetch —
  // navegar de semana não deve mudar o número do que está na tela.
  const visibleItems = useMemo(() => {
    const days = new Set(mode === 'week' ? weekDays : grid.weeks.flat());
    return items.filter((i) => days.has(i.date));
  }, [items, mode, weekDays, grid.weeks]);
  const legendGroups = useMemo(() => {
    const present = new Set(visibleItems.map(groupOf));
    return (Object.keys(GROUP_STYLE) as DayGroup[]).filter((g) => present.has(g));
  }, [visibleItems]);

  /** Detalhe do dia — flutua ancorado na célula, estilo Apple. */
  const dayPopover = (iso: string, dayItems: CalendarItem[]) => {
    const total = dayItems.reduce((s, i) => s + (i.amount ?? 0), 0);
    const links = summarizeDay(dayItems).map((r) => GROUP_LINK[r.group]);
    return (
      <PopoverContent align="center" className="w-80 overflow-hidden p-0">
        <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5">
          <p className="min-w-0 truncate text-sm font-semibold text-content">
            {dayTitle(iso, todayIso)}
          </p>
          <p className="shrink-0 text-helper tabular-nums text-content-muted">
            {dayItems.length} {dayItems.length === 1 ? 'item' : 'itens'}
            {total > 0 && ` · ${formatBRL(total)}`}
          </p>
        </div>
        <ul className="max-h-60 overflow-y-auto p-1.5">
          {dayItems.map((item) => (
            <li key={item.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', itemDot(item))} />
              <span className="min-w-0 flex-1 truncate text-sm text-content">{item.title}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2.5">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-center gap-1 text-caption font-medium text-brand-600 transition-colors duration-micro hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
            >
              {label}
              <ArrowRight
                size={12}
                className="transition-transform duration-micro group-hover:translate-x-0.5"
              />
            </Link>
          ))}
        </div>
      </PopoverContent>
    );
  };

  const cellBody = (dayItems: CalendarItem[]) => {
    if (maxChips === 0) {
      return (
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
      );
    }

    const chipClass = (extra: string) =>
      cn(
        'block min-w-0 truncate rounded-[5px] px-1.5 py-[3px] text-[11px] font-medium leading-4',
        extra,
      );

    // Dia denso: rollup por grupo com soma — 18 boletos são UMA história.
    if (dayItems.length > 3) {
      const rollups = summarizeDay(dayItems);
      const shown = rollups.slice(0, maxChips);
      const hiddenCount = rollups
        .slice(maxChips)
        .reduce((s, r) => s + r.count, 0);
      return (
        <span className="flex w-full min-w-0 flex-col gap-[3px]">
          {shown.map((r) => (
            <span
              key={r.group}
              className={chipClass(r.hasDanger ? DANGER_CHIP : GROUP_STYLE[r.group].chip)}
              title={rollupLabel(r.group, r.count)}
            >
              {rollupLabel(r.group, r.count)}
              {r.amount != null && r.amount > 0 && ` · ${compactBRL(r.amount)}`}
            </span>
          ))}
          {hiddenCount > 0 && (
            <span className="px-1.5 text-helper font-medium tabular-nums text-content-muted">
              +{hiddenCount} mais
            </span>
          )}
        </span>
      );
    }

    return (
      <span className="flex w-full min-w-0 flex-col gap-[3px]">
        {dayItems.slice(0, maxChips).map((i) => (
          <span key={i.id} className={chipClass(itemChip(i))} title={i.title}>
            {i.title}
          </span>
        ))}
      </span>
    );
  };

  /** Célula de eventos: com itens vira trigger de popover; vazia é inerte. */
  const eventCell = (iso: string, opts: { outside?: boolean; past?: boolean }) => {
    const dayItems = byDate.get(iso) ?? [];
    const isToday = iso === todayIso;
    const day = Number(iso.slice(8, 10));

    const cellClass = cn(
      'flex w-full flex-col gap-1 p-1.5 text-left',
      mode === 'week' ? 'min-h-[108px]' : dense ? 'min-h-[52px]' : 'min-h-[76px]',
      isWeekend(iso) && !isToday && 'bg-neutral-500/[0.03]',
      isToday && 'bg-brand-500/[0.04]',
      opts.past && !isToday && 'opacity-40',
    );

    // Número do dia dentro da célula — só no mês (na semana ele mora no header)
    const dayNumber = mode === 'month' && (
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
            aria-label={`${dayTitle(iso, todayIso)}, ${dayItems.length} ${
              dayItems.length === 1 ? 'compromisso' : 'compromissos'
            }`}
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
      badge={visibleItems.length}
      action={
        !dense && (
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
        )
      }
    >
      {agendaQ.isLoading ? (
        <ChartSkeleton />
      ) : items.length === 0 && offset === 0 ? (
        <EmptyState
          icon={CalendarCheck2}
          tone="success"
          title={mode === 'week' ? 'Semana livre' : 'Mês livre'}
          hint="Nenhum vencimento ou compromisso na janela."
        />
      ) : (
        <div className="space-y-2.5">
          {/* Período + navegação — a agenda é prospectiva: só hoje → +42d */}
          <div className="flex items-center justify-between gap-2 px-0.5">
            <p className="flex items-baseline gap-2 text-sm font-semibold text-content">
              {rangeLabel}
              {refreshing && (
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
              )}
            </p>
            <span className="flex items-center gap-0.5">
              {offset > 0 && (
                <button
                  onClick={goToday}
                  className="mr-1 rounded-md border border-line px-2 py-0.5 text-helper font-medium text-content-secondary transition-colors duration-micro hover:text-content"
                >
                  Hoje
                </button>
              )}
              <button
                onClick={() => nav(-1)}
                disabled={!canPrev}
                aria-label={mode === 'month' ? 'Mês anterior' : 'Semana anterior'}
                className="rounded-md p-1 text-content-muted transition-colors duration-micro hover:text-content disabled:opacity-30 disabled:hover:text-content-muted"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                onClick={() => nav(1)}
                disabled={!canNext}
                aria-label={mode === 'month' ? 'Próximo mês' : 'Próxima semana'}
                className="rounded-md p-1 text-content-muted transition-colors duration-micro hover:text-content disabled:opacity-30 disabled:hover:text-content-muted"
              >
                <ChevronRight size={15} />
              </button>
            </span>
          </div>

          <div
            key={`${mode}-${offset}`}
            className="overflow-hidden rounded-lg border border-line animate-in fade-in duration-fast"
          >
            {/* Cabeçalho de colunas — fora das células, como um calendário de verdade */}
            <div className="grid grid-cols-7 divide-x divide-line border-b border-line bg-neutral-500/[0.03]">
              {mode === 'week'
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

            {mode === 'week' ? (
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
                      outside: !iso.startsWith(grid.month),
                      past: iso < todayIso,
                    }),
                  )}
                </div>
              ))
            )}
          </div>

          {/* Legenda mínima — só os grupos presentes na janela */}
          {!dense && legendGroups.length > 1 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5">
              {legendGroups.map((g) => (
                <span key={g} className="flex items-center gap-1.5 text-helper text-content-muted">
                  <span className={cn('h-1.5 w-1.5 rounded-full', GROUP_STYLE[g].dot)} />
                  {GROUP_STYLE[g].label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </WidgetFrame>
  );
}
