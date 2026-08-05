'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Send } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { erroDeAcao } from '@/lib/feedback';

interface Template {
  id: string;
  name: string;
  bodyText: string | null;
  variableCount: number;
}

/**
 * F3.2 (#518) — envio de template quando a janela de 24h expirou. Único ponto
 * do CRM com custo (mensagem template da Meta). A resposta do cliente reabre a
 * janela → conversa livre de novo.
 */
export function TemplateSender({ leadId }: { leadId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [templateName, setTemplateName] = useState('');
  const [variables, setVariables] = useState<string[]>([]);

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ['crm-templates'],
    queryFn: async () => (await apiClient.get('/crm/templates')).data,
    staleTime: 5 * 60_000,
  });

  const selected = useMemo(
    () => templates.find((t) => t.name === templateName),
    [templates, templateName],
  );

  const send = useMutation({
    mutationFn: () =>
      apiClient.post(`/crm/leads/${leadId}/template`, {
        templateName,
        variables: variables.slice(0, selected?.variableCount ?? 0),
      }),
    onSuccess: () => {
      setTemplateName('');
      setVariables([]);
      queryClient.invalidateQueries({ queryKey: ['crm-messages', leadId] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
      toast.success('Template enviado');
    },
    onError: (e: any) => toast.error(erroDeAcao('enviar o template', e)),
  });

  const preview = useMemo(() => {
    if (!selected?.bodyText) return null;
    return selected.bodyText.replace(/\{\{(\d+)\}\}/g, (_, n) => variables[Number(n) - 1] || `{{${n}}}`);
  }, [selected, variables]);

  if (templates.length === 0) {
    return (
      <p className="text-center text-xs text-content-muted">
        Janela de 24h expirada. Nenhum template aprovado. Sincronize no menu do funil (gerente).
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-center text-xs text-content-muted">
        Janela de 24h expirada. Reengaje com um template aprovado (custo Meta).
      </p>
      <select
        className="w-full rounded-md border bg-surface px-2 py-2 text-sm"
        value={templateName}
        onChange={(e) => {
          setTemplateName(e.target.value);
          setVariables([]);
        }}
      >
        <option value="">Escolha um template…</option>
        {templates.map((t) => (
          <option key={t.id} value={t.name}>
            {t.name}
          </option>
        ))}
      </select>

      {selected && selected.variableCount > 0 && (
        <div className="space-y-1">
          {Array.from({ length: selected.variableCount }).map((_, i) => (
            <input
              key={i}
              className="w-full rounded-md border bg-surface px-2 py-1.5 text-sm"
              placeholder={`Variável {{${i + 1}}}`}
              value={variables[i] ?? ''}
              onChange={(e) => {
                const next = [...variables];
                next[i] = e.target.value;
                setVariables(next);
              }}
            />
          ))}
        </div>
      )}

      {preview && (
        <p className="rounded-md bg-surface-secondary p-2 text-xs italic text-content-muted">{preview}</p>
      )}

      <Button
        className="w-full"
        size="sm"
        disabled={
          !selected ||
          send.isPending ||
          variables.slice(0, selected?.variableCount ?? 0).filter((v) => v?.trim()).length <
            (selected?.variableCount ?? 0)
        }
        onClick={() => send.mutate()}
      >
        {send.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Send className="mr-2 h-4 w-4" />
        )}
        Enviar template
      </Button>
    </div>
  );
}
