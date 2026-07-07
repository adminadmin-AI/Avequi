'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Check, Loader2, StickyNote } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Reminder } from './inbox-types';

/**
 * Notas manuais + lembretes do lead (F3.5-C5 #555), no painel do inbox.
 * Nota vai pra timeline (LeadActivity NOTE); lembrete alerta no vencimento.
 */
export function LeadNotesReminders({ leadId }: { leadId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [reminderText, setReminderText] = useState('');
  const [reminderAt, setReminderAt] = useState('');

  const { data: reminders = [] } = useQuery<Reminder[]>({
    queryKey: ['crm-lead-reminders', leadId],
    queryFn: async () => (await apiClient.get(`/crm/leads/${leadId}/reminders`)).data,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['crm-lead-reminders', leadId] });
    queryClient.invalidateQueries({ queryKey: ['crm-my-reminders'] });
  };

  const addNote = useMutation({
    mutationFn: () => apiClient.post(`/crm/leads/${leadId}/notes`, { text: note.trim() }),
    onSuccess: () => {
      setNote('');
      queryClient.invalidateQueries({ queryKey: ['crm-lead', leadId] }); // timeline
      toast.success('Nota adicionada');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Falha ao salvar nota'),
  });

  const addReminder = useMutation({
    mutationFn: () =>
      apiClient.post(`/crm/leads/${leadId}/reminders`, {
        text: reminderText.trim(),
        dueAt: new Date(reminderAt).toISOString(),
      }),
    onSuccess: () => {
      setReminderText('');
      setReminderAt('');
      invalidate();
      toast.success('Lembrete agendado');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Falha ao agendar'),
  });

  const done = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/crm/reminders/${id}/done`),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Falha ao concluir'),
  });

  return (
    <div className="space-y-3">
      <div>
        <h3 className="mb-1 flex items-center gap-1 text-xs font-medium uppercase text-muted-foreground">
          <StickyNote className="h-3.5 w-3.5" />
          Nota manual
        </h3>
        <textarea
          className="w-full rounded-md border bg-background p-2 text-sm"
          rows={2}
          placeholder="ex: prefere basculante, orçamento até 15k..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button
          size="sm"
          variant="secondary"
          className="mt-1"
          disabled={!note.trim() || addNote.isPending}
          onClick={() => addNote.mutate()}
        >
          {addNote.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          Salvar na timeline
        </Button>
      </div>

      <div>
        <h3 className="mb-1 flex items-center gap-1 text-xs font-medium uppercase text-muted-foreground">
          <AlarmClock className="h-3.5 w-3.5" />
          Lembretes
        </h3>
        {reminders.length > 0 && (
          <ul className="mb-2 space-y-1">
            {reminders.map((r) => {
              const overdue = new Date(r.dueAt).getTime() < Date.now();
              return (
                <li
                  key={r.id}
                  className={`flex items-center gap-2 rounded-md border p-2 text-xs ${
                    overdue ? 'border-destructive/50' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{r.text}</p>
                    <p className={overdue ? 'text-destructive' : 'text-muted-foreground'}>
                      {new Date(r.dueAt).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {overdue && ' — vencido'}
                      {r.user && ` · ${r.user.name}`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Concluir lembrete"
                    title="Concluir"
                    onClick={() => done.mutate(r.id)}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="space-y-1">
          <input
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            placeholder='ex: "ligar amanhã 14h"'
            value={reminderText}
            onChange={(e) => setReminderText(e.target.value)}
          />
          <div className="flex gap-1">
            <input
              type="datetime-local"
              className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
              value={reminderAt}
              onChange={(e) => setReminderAt(e.target.value)}
            />
            <Button
              size="sm"
              disabled={!reminderText.trim() || !reminderAt || addReminder.isPending}
              onClick={() => addReminder.mutate()}
            >
              {addReminder.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                'Agendar'
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
