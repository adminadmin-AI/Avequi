/**
 * Modelo do calendário da agenda — módulo PURO (sem React) para spec em node.
 *
 * Tudo opera sobre datas ISO (yyyy-mm-dd) com meio-dia fixo para não escorregar
 * de dia por fuso. Duas projeções:
 *  - semana rolante: hoje → +6 (a janela natural dos dados prospectivos);
 *  - grid de mês: semanas completas (dom→sáb) cobrindo o mês corrente,
 *    estilo Apple Calendar — dias fora do mês aparecem esmaecidos.
 */

export type AgendaKind = 'finance-due' | 'production-end' | 'crm-reminder';

export interface CalendarItem {
  id: string;
  date: string; // ISO yyyy-mm-dd
  kind: AgendaKind;
  title: string;
  href: string;
  tone?: 'danger' | 'warning' | 'neutral';
}

const MAX_WINDOW_DAYS = 42; // espelho do cap do backend (AgendaQueryDto)

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

/** Semana rolante: hoje e os 6 dias seguintes. */
export function rollingWeek(todayIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(todayIso, i));
}

export interface MonthGrid {
  /** "julho de 2026" */
  label: string;
  /** Semanas completas dom→sáb; cada célula é um ISO. */
  weeks: string[][];
}

export function monthGrid(todayIso: string): MonthGrid {
  const today = toDate(todayIso);
  const first = new Date(today.getFullYear(), today.getMonth(), 1, 12);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0, 12);
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

  const label = today.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return { label, weeks };
}

/** Dias de janela a pedir ao backend para cobrir o grid do mês a partir de hoje. */
export function monthWindowDays(todayIso: string): number {
  const { weeks } = monthGrid(todayIso);
  const lastCell = weeks[weeks.length - 1][6];
  const diff =
    Math.round((toDate(lastCell).getTime() - toDate(todayIso).getTime()) / 86_400_000) + 1;
  return Math.min(Math.max(diff, 7), MAX_WINDOW_DAYS);
}

export function groupByDate<T extends { date: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(item.date) ?? [];
    list.push(item);
    map.set(item.date, list);
  }
  return map;
}

/**
 * Dia selecionado ao abrir: hoje se tiver compromissos; senão o primeiro dia
 * futuro com algo; senão hoje mesmo (a lista mostra "dia livre").
 */
export function defaultSelectedDay(byDate: Map<string, unknown[]>, todayIso: string): string {
  if ((byDate.get(todayIso)?.length ?? 0) > 0) return todayIso;
  const future = [...byDate.keys()].filter((d) => d >= todayIso).sort();
  return future[0] ?? todayIso;
}
