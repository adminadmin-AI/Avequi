'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { MaintenanceOrder } from '@/types/api';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { MAINTENANCE_ORDER_STATUS } from './maintenance-meta';

/** Cor do "dot" por status (verde = aberta, azul = em andamento). */
const DOT_COLOR: Record<MaintenanceOrder['status'], string> = {
  OPEN: 'bg-success',
  IN_PROGRESS: 'bg-brand-500',
  DONE: 'bg-neutral-400',
  CANCELLED: 'bg-danger',
};

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/**
 * Calendário mensal de OMs agendadas (campo `scheduledAt`).
 * Grid CSS puro, sem bibliotecas externas. Agrupa por data ISO (YYYY-MM-DD)
 * para evitar deslocamento de fuso horário.
 */
export function MaintenanceCalendar({
  orders,
  onSelect,
}: {
  orders: MaintenanceOrder[];
  onSelect: (o: MaintenanceOrder) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const byDay = useMemo(() => {
    const map = new Map<string, MaintenanceOrder[]>();
    for (const o of orders) {
      if (!o.scheduledAt) continue;
      const key = o.scheduledAt.slice(0, 10);
      const arr = map.get(key) ?? [];
      arr.push(o);
      map.set(key, arr);
    }
    return map;
  }, [orders]);

  const cells = useMemo(() => {
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const out: (number | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(d);
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [year, month]);

  const today = new Date();
  const isToday = (d: number) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;

  const monthLabel = cursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const scheduledCount = Array.from(byDay.values()).reduce((acc, arr) => acc + arr.length, 0);

  return (
    <Card>
      <CardContent className="py-5">
        {/* Header de navegação */}
        <div className="mb-4 flex items-center justify-between">
          <button
            onClick={() => setCursor(new Date(year, month - 1, 1))}
            className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-content-secondary"
            title="Mês anterior"
          >
            <ChevronLeft size={18} />
          </button>
          <p className="text-sm font-semibold capitalize text-content">{monthLabel}</p>
          <button
            onClick={() => setCursor(new Date(year, month + 1, 1))}
            className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-content-secondary"
            title="Próximo mês"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Cabeçalho dos dias da semana */}
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-content-muted">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-1">{w}</div>
          ))}
        </div>

        {/* Grade de dias */}
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (d == null) return <div key={i} className="min-h-[72px] rounded-lg" />;
            const key = `${year}-${pad(month + 1)}-${pad(d)}`;
            const dayOrders = byDay.get(key) ?? [];
            return (
              <div
                key={i}
                className={cn(
                  'min-h-[72px] rounded-lg border p-1.5',
                  isToday(d) ? 'border-brand-300 bg-brand-50/40' : 'border-line',
                )}
              >
                <div className={cn('mb-1 text-xs font-medium', isToday(d) ? 'text-brand-700 dark:text-brand-300' : 'text-content-muted')}>
                  {d}
                </div>
                <div className="space-y-0.5">
                  {dayOrders.slice(0, 3).map((o) => (
                    <button
                      key={o.id}
                      onClick={() => onSelect(o)}
                      title={`${o.equipment ? o.equipment.code + ' — ' : ''}${o.title} (${MAINTENANCE_ORDER_STATUS[o.status].label})`}
                      className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] text-content-secondary hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT_COLOR[o.status])} />
                      <span className="truncate">{o.equipment?.code ?? o.title}</span>
                    </button>
                  ))}
                  {dayOrders.length > 3 && (
                    <button
                      onClick={() => onSelect(dayOrders[3])}
                      className="px-1 text-[11px] text-content-muted hover:text-content-secondary"
                    >
                      +{dayOrders.length - 3} mais
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legenda */}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-content-muted">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" /> Aberta</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-500" /> Em andamento</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-neutral-400" /> Concluída</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-danger" /> Cancelada</span>
          <span className="ml-auto">{scheduledCount} OM(s) agendada(s) no mês</span>
        </div>
      </CardContent>
    </Card>
  );
}
