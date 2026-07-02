'use client';

import { useState } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import { ptBR } from 'react-day-picker/locale';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from './popover';
import { cn } from '@/lib/utils';

/**
 * DatePicker & DateRangePicker — F2.2 (#308)
 *
 * Calendário pt-BR (react-day-picker) no lugar do input type="date" nativo.
 *  - DatePicker: data única
 *  - DateRangePicker: período com presets (Hoje, Ontem, 7/30/90 dias, Este mês)
 *  - Popover modal (funciona dentro de Dialog — ver radix focus-scope dedupe)
 *  - Dark mode via tokens
 *
 * Contrato em Date; para telas com estado string use as helpers
 * dateToISO / isoToDate (YYYY-MM-DD).
 */

export function dateToISO(d: Date | undefined): string {
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isoToDate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

const fmt = new Intl.DateTimeFormat('pt-BR');

/** classes do DayPicker mapeadas para os tokens do design system */
const dayPickerClassNames = {
  months: 'relative flex flex-col gap-4 sm:flex-row',
  month: 'w-full',
  month_caption: 'flex h-9 items-center justify-center',
  caption_label: 'text-sm font-medium text-content capitalize',
  nav: 'absolute inset-x-2 top-0 flex h-9 items-center justify-between',
  button_previous:
    'inline-flex h-7 w-7 items-center justify-center rounded-md text-content-muted transition-colors hover:bg-neutral-100 hover:text-content dark:hover:bg-neutral-800',
  button_next:
    'inline-flex h-7 w-7 items-center justify-center rounded-md text-content-muted transition-colors hover:bg-neutral-100 hover:text-content dark:hover:bg-neutral-800',
  chevron: 'h-4 w-4 fill-current',
  month_grid: 'mt-2 w-full border-collapse',
  weekdays: 'flex',
  weekday: 'w-9 text-caption font-medium capitalize text-content-muted',
  week: 'mt-1 flex',
  day: 'p-0 text-center',
  day_button:
    'inline-flex h-9 w-9 items-center justify-center rounded-md text-sm text-content transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800',
  selected:
    '[&>button]:bg-brand-600 [&>button]:text-white [&>button]:hover:bg-brand-700 dark:[&>button]:bg-brand-500',
  today: '[&>button]:font-semibold [&>button]:text-brand-600 dark:[&>button]:text-brand-400',
  outside: '[&>button]:text-content-muted [&>button]:opacity-50',
  disabled: '[&>button]:pointer-events-none [&>button]:opacity-40',
  range_start:
    '[&>button]:bg-brand-600 [&>button]:text-white [&>button]:rounded-r-none dark:[&>button]:bg-brand-500',
  range_end:
    '[&>button]:bg-brand-600 [&>button]:text-white [&>button]:rounded-l-none dark:[&>button]:bg-brand-500',
  range_middle:
    '[&>button]:rounded-none [&>button]:bg-brand-600/10 [&>button]:text-brand-700 dark:[&>button]:bg-brand-500/20 dark:[&>button]:text-brand-300',
  hidden: 'invisible',
} as const;

const triggerClass = (error?: boolean, disabled?: boolean) =>
  cn(
    'flex h-10 w-full items-center gap-2 rounded-lg border bg-surface px-3 text-left text-sm',
    'transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
    error ? 'border-danger focus-visible:ring-danger' : 'border-line focus-visible:ring-brand-600',
    disabled && 'cursor-not-allowed bg-surface-secondary text-content-muted',
  );

// ─── DatePicker (data única) ──────────────────────────────────────────────────

export interface DatePickerProps {
  value?: Date;
  onValueChange: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  clearable?: boolean;
  className?: string;
}

export function DatePicker({
  value,
  onValueChange,
  placeholder = 'Selecionar data',
  disabled,
  error,
  clearable,
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} className={cn(triggerClass(error, disabled), className)}>
          <CalendarIcon className="h-4 w-4 shrink-0 text-content-muted" />
          <span className={cn('flex-1 truncate', !value && 'text-content-muted')}>
            {value ? fmt.format(value) : placeholder}
          </span>
          {clearable && value && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Limpar data"
              onClick={(e) => {
                e.stopPropagation();
                onValueChange(undefined);
              }}
              className="rounded text-content-muted transition-colors hover:text-content"
            >
              <X className="h-4 w-4" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <DayPicker
          mode="single"
          locale={ptBR}
          selected={value}
          defaultMonth={value}
          onSelect={(d) => {
            onValueChange(d ?? undefined);
            setOpen(false);
          }}
          classNames={dayPickerClassNames}
        />
      </PopoverContent>
    </Popover>
  );
}

// ─── DateRangePicker (período + presets) ──────────────────────────────────────

export type { DateRange };

interface Preset {
  label: string;
  range: () => DateRange;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysAgo = (n: number) => {
  const d = startOfDay(new Date());
  d.setDate(d.getDate() - n);
  return d;
};

const DEFAULT_PRESETS: Preset[] = [
  { label: 'Hoje', range: () => ({ from: daysAgo(0), to: daysAgo(0) }) },
  { label: 'Ontem', range: () => ({ from: daysAgo(1), to: daysAgo(1) }) },
  { label: 'Últimos 7 dias', range: () => ({ from: daysAgo(6), to: daysAgo(0) }) },
  { label: 'Últimos 30 dias', range: () => ({ from: daysAgo(29), to: daysAgo(0) }) },
  { label: 'Últimos 90 dias', range: () => ({ from: daysAgo(89), to: daysAgo(0) }) },
  {
    label: 'Este mês',
    range: () => {
      const now = new Date();
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: startOfDay(now) };
    },
  },
];

export interface DateRangePickerProps {
  value?: DateRange;
  onValueChange: (range: DateRange | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  clearable?: boolean;
  /** Presets exibidos na coluna lateral (default: Hoje/Ontem/7/30/90/Este mês). */
  presets?: Preset[];
  className?: string;
}

export function DateRangePicker({
  value,
  onValueChange,
  placeholder = 'Selecionar período',
  disabled,
  error,
  clearable,
  presets = DEFAULT_PRESETS,
  className,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);

  const label =
    value?.from && value?.to
      ? `${fmt.format(value.from)} – ${fmt.format(value.to)}`
      : value?.from
        ? `${fmt.format(value.from)} – ...`
        : placeholder;

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} className={cn(triggerClass(error, disabled), className)}>
          <CalendarIcon className="h-4 w-4 shrink-0 text-content-muted" />
          <span className={cn('flex-1 truncate', !value?.from && 'text-content-muted')}>
            {label}
          </span>
          {clearable && value?.from && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Limpar período"
              onClick={(e) => {
                e.stopPropagation();
                onValueChange(undefined);
              }}
              className="rounded text-content-muted transition-colors hover:text-content"
            >
              <X className="h-4 w-4" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-auto gap-3 p-3">
        {/* presets */}
        <div className="flex shrink-0 flex-col gap-0.5 border-r border-line pr-3">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                onValueChange(p.range());
                setOpen(false);
              }}
              className="rounded-md px-2.5 py-1.5 text-left text-sm text-content-secondary transition-colors hover:bg-neutral-100 hover:text-content dark:hover:bg-neutral-800"
            >
              {p.label}
            </button>
          ))}
        </div>
        <DayPicker
          mode="range"
          locale={ptBR}
          numberOfMonths={2}
          selected={value}
          defaultMonth={value?.from}
          onSelect={(r) => {
            onValueChange(r ?? undefined);
            // fecha quando o período está completo
            if (r?.from && r?.to) setOpen(false);
          }}
          classNames={dayPickerClassNames}
        />
      </PopoverContent>
    </Popover>
  );
}
