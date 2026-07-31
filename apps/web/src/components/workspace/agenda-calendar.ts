/**
 * Modelo do calendário da agenda — módulo PURO (sem React) para spec em node.
 *
 * Tudo opera sobre datas ISO (yyyy-mm-dd) com meio-dia fixo para não escorregar
 * de dia por fuso. Três responsabilidades:
 *  - projeções: semana rolante (com offset de navegação) e grid de mês
 *    (semanas completas dom→sáb, estilo Apple Calendar);
 *  - janela: quantos dias pedir ao backend para cobrir cada projeção,
 *    respeitando o cap de 42 dias do endpoint (AgendaQueryDto);
 *  - rollup: dias densos agregam por GRUPO (a pagar / a receber / produção /
 *    CRM) com soma de valores — 18 boletos são UMA história, não 18 chips.
 */

export type AgendaKind = 'finance-due' | 'production-end' | 'crm-reminder';

export interface CalendarItem {
  id: string;
  date: string; // ISO yyyy-mm-dd
  kind: AgendaKind;
  title: string;
  href: string;
  tone?: 'danger' | 'warning' | 'neutral';
  /** Valor estruturado (itens financeiros) vindo do backend. */
  amount?: number;
}

/** Cap do backend (AgendaQueryDto) — espelhado aqui para limitar a navegação. */
export const MAX_WINDOW_DAYS = 42;

function toDate(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

export function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDaysIso(iso: string, days: number): string {
  const d = toDate(iso);
  d.setDate(d.getDate() + days);
  return toIso(d);
}

// ─── Semana ──────────────────────────────────────────────────────────────────

/** Semana rolante: hoje + offset semanas → 7 dias. */
export function rollingWeek(todayIso: string, weekOffset = 0): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(todayIso, weekOffset * 7 + i));
}

/** Dias de janela para cobrir a semana no offset dado. */
export function weekWindowDays(weekOffset: number): number {
  return Math.min((weekOffset + 1) * 7, MAX_WINDOW_DAYS);
}

/** A agenda é prospectiva e o backend corta em 42 dias — 6 semanas no máximo. */
export function weekFitsWindow(weekOffset: number): boolean {
  return weekOffset >= 0 && (weekOffset + 1) * 7 <= MAX_WINDOW_DAYS;
}

// ─── Mês ─────────────────────────────────────────────────────────────────────

export interface MonthGrid {
  /** "julho de 2026" */
  label: string;
  /** Prefixo ISO do mês âncora ("2026-07") — células fora dele são "outside". */
  month: string;
  /** Semanas completas dom→sáb; cada célula é um ISO. */
  weeks: string[][];
}

export function monthGrid(todayIso: string, monthOffset = 0): MonthGrid {
  const today = toDate(todayIso);
  const first = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1, 12);
  const last = new Date(today.getFullYear(), today.getMonth() + monthOffset + 1, 0, 12);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay()); // volta ao domingo
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - last.getDay())); // avança ao sábado

  const weeks: string[][] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      const cell = new Date(d);
      cell.setDate(d.getDate() + i);
      week.push(toIso(cell));
    }
    weeks.push(week);
  }

  const label = first.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return { label, month: toIso(first).slice(0, 7), weeks };
}

function daysUntilGridEnd(todayIso: string, monthOffset: number): number {
  const { weeks } = monthGrid(todayIso, monthOffset);
  const lastCell = weeks[weeks.length - 1][6];
  return Math.round((toDate(lastCell).getTime() - toDate(todayIso).getTime()) / 86_400_000) + 1;
}

/** Dias de janela a pedir ao backend para cobrir o grid do mês a partir de hoje. */
export function monthWindowDays(todayIso: string, monthOffset = 0): number {
  return Math.min(Math.max(daysUntilGridEnd(todayIso, monthOffset), 7), MAX_WINDOW_DAYS);
}

/** O mês seguinte só é navegável se o grid dele couber inteiro na janela de 42d. */
export function monthFitsWindow(todayIso: string, monthOffset: number): boolean {
  if (monthOffset < 0) return false;
  if (monthOffset === 0) return true;
  return daysUntilGridEnd(todayIso, monthOffset) <= MAX_WINDOW_DAYS;
}

// ─── Agrupamento e rollup ────────────────────────────────────────────────────

export function groupByDate<T extends { date: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(item.date) ?? [];
    list.push(item);
    map.set(item.date, list);
  }
  return map;
}

/** Grupos do rollup — direção financeira inferida do destino do item. */
export type DayGroup = 'payable' | 'receivable' | 'production' | 'crm';

const GROUP_ORDER: readonly DayGroup[] = ['payable', 'receivable', 'production', 'crm'];

export function groupOf(item: Pick<CalendarItem, 'kind' | 'href'>): DayGroup {
  if (item.kind === 'production-end') return 'production';
  if (item.kind === 'crm-reminder') return 'crm';
  return item.href.includes('receivables') ? 'receivable' : 'payable';
}

export interface DayRollup {
  group: DayGroup;
  count: number;
  /** Soma dos amounts presentes; null quando nenhum item do grupo tem valor. */
  amount: number | null;
  hasDanger: boolean;
}

/** Rollup do dia na ordem fixa a pagar → a receber → produção → CRM. */
export function summarizeDay(items: CalendarItem[]): DayRollup[] {
  return GROUP_ORDER.flatMap((group) => {
    const ofGroup = items.filter((i) => groupOf(i) === group);
    if (ofGroup.length === 0) return [];
    const amounts = ofGroup.filter((i) => i.amount != null);
    return [
      {
        group,
        count: ofGroup.length,
        amount: amounts.length > 0 ? amounts.reduce((s, i) => s + (i.amount ?? 0), 0) : null,
        hasDanger: ofGroup.some((i) => i.tone === 'danger'),
      },
    ];
  });
}

/** "R$ 132 mil" / "R$ 1,2 mi" — leitura executiva dentro de um chip. */
export function compactBRL(value: number): string {
  const compact = new Intl.NumberFormat('pt-BR', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
  // Intl usa NBSP entre número e sufixo ("132,5 mil") — normaliza para espaço
  // comum: saída estável para specs e sem viúva estranha dentro do chip.
  return `R$ ${compact}`.replace(/ /g, ' ');
}
