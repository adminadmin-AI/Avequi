'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { erroDeAcao } from '@/lib/feedback';

/**
 * F1.6 (#512) — registro manual de lead (telefone tocou / cliente no balcão)
 * em ≤ 15s. Dedup on-type: ao digitar um telefone que já existe, avisa e
 * oferece abrir o lead atual em vez de duplicar.
 */
export function NewLeadDialog({
  open,
  onOpenChange,
  onOpenLead,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onOpenLead: (leadId: string) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [interest, setInterest] = useState('');
  const [dupLeadId, setDupLeadId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName('');
      setPhone('');
      setInterest('');
      setDupLeadId(null);
    }
  }, [open]);

  // dedup on-type: busca conversa/lead pelo telefone digitado (debounce)
  useEffect(() => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) {
      setDupLeadId(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const { data } = await apiClient.get('/crm/conversations', { params: { search: digits } });
        setDupLeadId(data[0]?.leadId ?? null);
      } catch {
        setDupLeadId(null);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [phone]);

  const create = useMutation({
    mutationFn: () =>
      apiClient.post('/crm/leads', {
        name: name.trim() || undefined,
        phone,
        source: 'TELEFONE',
        interest: interest.trim() || undefined,
      }),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
      toast.success(data?.created ? 'Lead criado' : 'Contato registrado no lead existente');
      onOpenChange(false);
      if (data?.lead?.id) onOpenLead(data.lead.id);
    },
    onError: (e: any) => toast.error(erroDeAcao('criar o lead', e)),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.replace(/\D/g, '')) {
      toast.error('Informe o telefone');
      return;
    }
    create.mutate();
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Novo lead"
      description="Registro manual (telefone / balcão)"
      formId="new-lead-form"
      submitLabel="Criar"
      loading={create.isPending}
    >
      <form id="new-lead-form" onSubmit={handleSubmit} className="space-y-3">
        <Field label="Telefone *">
          <input
            className="w-full rounded-md border bg-surface px-2 py-2 text-sm"
            placeholder="(45) 99999-8888"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoFocus
          />
        </Field>
        {dupLeadId && (
          <div className="rounded-md border border-amber-400/50 bg-amber-50 p-2 text-xs dark:bg-amber-950/30">
            Já existe um lead com esse telefone.{' '}
            <button
              type="button"
              className="font-medium underline"
              onClick={() => {
                onOpenChange(false);
                onOpenLead(dupLeadId);
              }}
            >
              Abrir lead existente
            </button>
          </div>
        )}
        <Field label="Nome">
          <input
            className="w-full rounded-md border bg-surface px-2 py-2 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Interesse">
          <input
            className="w-full rounded-md border bg-surface px-2 py-2 text-sm"
            placeholder="modelo de reboque..."
            value={interest}
            onChange={(e) => setInterest(e.target.value)}
          />
        </Field>
      </form>
    </FormDialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-content-muted">{label}</span>
      {children}
    </label>
  );
}
