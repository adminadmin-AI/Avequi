'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { Reminder } from './inbox-types';

/**
 * "Meus lembretes" no topo do inbox (F3.5-C5 #555): pendentes do vendedor com
 * destaque pros vencidos; toast in-app quando um lembrete vence com a tela
 * aberta (o cron do backend cobre o sino de alertas p/ quem não está no inbox).
 */
export function RemindersStrip({ onOpenLead }: { onOpenLead: (leadId: string) => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const notified = useRef<Set<string>>(new Set());

  const { data: reminders = [] } = useQuery<Reminder[]>({
    queryKey: ['crm-my-reminders'],
    queryFn: async () => (await apiClient.get('/crm/reminders')).data,
    refetchInterval: 60_000,
  });

  const now = Date.now();
  const due = reminders.filter((r) => new Date(r.dueAt).getTime() <= now);

  // notificação in-app: toast 1x por lembrete que venceu nesta sessão
  useEffect(() => {
    for (const r of due) {
      if (notified.current.has(r.id)) continue;
      notified.current.add(r.id);
      const lead = r.lead?.name ?? r.lead?.phone ?? 'lead';
      toast.info(`⏰ Lembrete: ${r.text} · ${lead}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due.map((r) => r.id).join(',')]);

  const done = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/crm/reminders/${id}/done`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['crm-my-reminders'] }),
  });

  if (reminders.length === 0) return null;

  return (
    <div className="border-b">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-neutral-500/[0.05]"
        onClick={() => setOpen((v) => !v)}
      >
        <AlarmClock className={`h-3.5 w-3.5 ${due.length > 0 ? 'text-danger' : 'text-content-muted'}`} />
        <span className="flex-1">
          Meus lembretes
          {due.length > 0 && (
            <Badge variant="warning" className="ml-2 text-[10px]">
              {due.length} vencido{due.length > 1 ? 's' : ''}
            </Badge>
          )}
        </span>
        <span className="text-content-muted">{reminders.length}</span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <ul className="max-h-48 divide-y overflow-y-auto border-t bg-neutral-500/[0.05]">
          {reminders.map((r) => {
            const overdue = new Date(r.dueAt).getTime() <= now;
            return (
              <li key={r.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onOpenLead(r.leadId)}
                  title="Abrir conversa"
                >
                  <p className="truncate">{r.text}</p>
                  <p className={overdue ? 'text-danger' : 'text-content-muted'}>
                    {new Date(r.dueAt).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {' · '}
                    {r.lead?.name ?? r.lead?.phone ?? 'lead'}
                  </p>
                </button>
                <button
                  className="shrink-0 rounded p-1 text-content-muted hover:bg-neutral-500/[0.06]"
                  aria-label="Concluir lembrete"
                  title="Concluir"
                  onClick={() => done.mutate(r.id)}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
