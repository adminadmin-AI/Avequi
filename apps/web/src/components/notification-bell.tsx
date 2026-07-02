'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  ALERT_SEVERITY,
  ALERT_TYPE_LABEL,
  alertLink,
  type Alert,
} from '@/app/app/alerts/alert-meta';

/** Timestamp relativo curto em pt-BR ("há 5 min", "há 2 h", "há 3 d"). */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `há ${d} d`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

/**
 * Sino de notificações no header (#139).
 *
 * O backend NÃO possui módulo de notificações (`/notifications`). As
 * notificações são alimentadas pelo sistema de **alertas** existente
 * (`/alerts`): alertas ativos = não lidos; "marcar como lida" = resolver
 * o alerta (PATCH /alerts/:id/resolve).
 */
export function NotificationBell() {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: alerts = [] } = useQuery({
    queryKey: ['/alerts'],
    queryFn: async () => (await apiClient.get<Alert[]>('/alerts')).data,
    refetchInterval: 60_000,
  });

  // Fecha ao clicar fora.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['/alerts'] });
    qc.invalidateQueries({ queryKey: ['/alerts/all'] });
    qc.invalidateQueries({ queryKey: ['/alerts/active-count'] });
  }

  const markRead = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/alerts/${id}/resolve`, {}),
    onSuccess: invalidate,
  });
  const markAll = useMutation({
    mutationFn: async () => {
      await Promise.all(alerts.map((a) => apiClient.patch(`/alerts/${a.id}/resolve`, {})));
    },
    onSuccess: invalidate,
  });

  const recent = alerts.slice(0, 20);
  const count = alerts.length;

  function handleClick(a: Alert) {
    const link = alertLink(a);
    markRead.mutate(a.id);
    setOpen(false);
    if (link) router.push(link);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Notificações"
        className="relative rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
      >
        <Bell size={18} />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-30 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-800">Notificações</p>
            {count > 0 && (
              <button
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending}
                className="flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 disabled:opacity-50"
              >
                <CheckCheck size={13} /> Marcar todas
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {recent.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-400">Nenhuma notificação nova. 🎉</p>
            ) : (
              recent.map((a) => (
                <div
                  key={a.id}
                  className="group flex items-start gap-2 border-b border-slate-50 px-4 py-3 last:border-0 hover:bg-slate-50"
                >
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', {
                    'bg-danger': a.severity === 'CRITICAL',
                    'bg-warning': a.severity === 'WARNING',
                    'bg-info': a.severity === 'INFO',
                  })} />
                  <button onClick={() => handleClick(a)} className="flex-1 text-left">
                    <p className="text-xs font-medium text-slate-500">{ALERT_TYPE_LABEL[a.type] ?? a.type}</p>
                    <p className="text-sm text-slate-800">{a.title}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {ALERT_SEVERITY[a.severity].label} · {relativeTime(a.createdAt)}
                    </p>
                  </button>
                  <button
                    onClick={() => markRead.mutate(a.id)}
                    title="Marcar como lida"
                    className="mt-0.5 rounded-md p-1 text-slate-300 opacity-0 transition-opacity hover:bg-slate-100 hover:text-success group-hover:opacity-100"
                  >
                    <Check size={14} />
                  </button>
                </div>
              ))
            )}
          </div>

          <button
            onClick={() => { setOpen(false); router.push('/app/alerts'); }}
            className="block w-full border-t border-slate-100 py-2.5 text-center text-xs font-medium text-brand-600 dark:text-brand-400 hover:bg-slate-50"
          >
            Ver todos os alertas
          </button>
        </div>
      )}
    </div>
  );
}
