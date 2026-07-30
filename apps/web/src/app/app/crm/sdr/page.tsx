'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot, Power, RotateCcw } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';

interface Overview {
  attended: number;
  inProgress: number;
  handoffs: number;
  handoffRate: number;
  discards: number;
  discardRate: number;
  qualified: number;
  avgScore: number | null;
  avgMinutesToQualify: number | null;
  apiTurns: number;
  costUsd: number;
  cacheHitRate: number;
}

interface Discard {
  id: string;
  name: string | null;
  phone: string | null;
  source: string;
  lostReason: string | null;
  updatedAt: string;
}

interface Incident {
  id: string;
  happensAt: string;
  properties: Record<string, unknown> | null;
  lead: { id: string; name: string | null; phone: string | null };
}

/**
 * Painel de supervisão do SDR IA (F4.4 #524): o gerente enxerga e controla
 * tudo — métricas, custo, fila de revisão de descartes e incidentes.
 */
export default function SdrPanelPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [days, setDays] = useState(7);

  const { data: settings } = useQuery<{ sdrEnabled: boolean }>({
    queryKey: ['crm-settings'],
    queryFn: async () => (await apiClient.get('/crm/settings')).data,
  });
  const { data: overview } = useQuery<Overview>({
    queryKey: ['sdr-overview', days],
    queryFn: async () => (await apiClient.get('/crm/sdr/overview', { params: { days } })).data,
    refetchInterval: 30_000,
  });
  const { data: discards = [] } = useQuery<Discard[]>({
    queryKey: ['sdr-discards'],
    queryFn: async () => (await apiClient.get('/crm/sdr/discards')).data,
  });
  const { data: incidents = [] } = useQuery<Incident[]>({
    queryKey: ['sdr-incidents', days],
    queryFn: async () => (await apiClient.get('/crm/sdr/incidents', { params: { days } })).data,
  });

  // kill switch em 1 clique (#523/#524)
  const toggleSdr = useMutation({
    mutationFn: (enabled: boolean) => apiClient.patch('/crm/settings', { sdrEnabled: enabled }),
    onSuccess: (_, enabled) => {
      queryClient.invalidateQueries({ queryKey: ['crm-settings'] });
      toast.success(enabled ? 'SDR IA LIGADO' : 'SDR IA DESLIGADO — tudo volta ao fluxo humano');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Falha no kill switch'),
  });

  const revert = useMutation({
    mutationFn: (leadId: string) => apiClient.post(`/crm/sdr/discards/${leadId}/revert`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sdr-discards'] });
      toast.success('Descarte revertido — lead voltou pro funil (feedback registrado)');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Falha ao reverter'),
  });

  const enabled = settings?.sdrEnabled ?? false;
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="space-y-4">
      <PageHeader title="SDR IA" description="Supervisão do atendente de IA: métricas, custo, descartes e incidentes" />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={enabled ? 'danger' : 'primary'}
          onClick={() => toggleSdr.mutate(!enabled)}
          disabled={toggleSdr.isPending}
        >
          <Power className="mr-2 h-4 w-4" />
          {enabled ? 'Desligar SDR (kill switch)' : 'Ligar SDR IA'}
        </Button>
        <Badge variant={enabled ? 'success' : 'neutral'}>{enabled ? 'ATIVO' : 'DESLIGADO'}</Badge>
        <div className="ml-auto flex gap-1">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-full px-3 py-1 text-xs ${
                days === d ? 'bg-brand-600 text-white' : 'bg-neutral-500/[0.08] text-content-muted'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Métricas (#524): responde "quantos atendeu e quantos passou?" em < 5s */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Leads atendidos" value={overview?.attended ?? '—'} />
        <Metric
          label="Handoff (quente)"
          value={overview ? `${overview.handoffs} (${pct(overview.handoffRate)})` : '—'}
        />
        <Metric
          label="Descartes"
          value={overview ? `${overview.discards} (${pct(overview.discardRate)})` : '—'}
        />
        <Metric
          label="Score médio"
          value={overview?.avgScore != null ? Math.round(overview.avgScore) : '—'}
        />
        <Metric
          label="Tempo p/ qualificar"
          value={
            overview?.avgMinutesToQualify != null
              ? `${Math.round(overview.avgMinutesToQualify)} min`
              : '—'
          }
        />
        <Metric
          label={`Custo API (${days}d)`}
          value={overview ? `US$ ${overview.costUsd.toFixed(2)}` : '—'}
          hint={overview ? `${overview.apiTurns} turnos · cache ${pct(overview.cacheHitRate)}` : undefined}
        />
      </div>

      {/* Fila de revisão de descartes (#524) — auditoria < 5 min/dia */}
      <section className="surface-sheen rounded-xl bg-surface shadow-soft">
        <h2 className="flex items-center gap-2 border-b p-3 text-sm font-medium">
          <Bot className="h-4 w-4" />
          Descartes da IA — últimos 7 dias ({discards.length})
        </h2>
        {discards.length === 0 ? (
          <p className="p-4 text-sm text-content-muted">Nenhum descarte pra revisar. 👌</p>
        ) : (
          <ul className="divide-y">
            {discards.map((d) => (
              <li key={d.id} className="flex items-center gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{d.name ?? d.phone ?? 'Lead'}</p>
                  <p className="truncate text-xs text-content-muted">
                    {d.lostReason ?? 'sem motivo'} ·{' '}
                    {new Date(d.updatedAt).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={revert.isPending}
                  onClick={() => revert.mutate(d.id)}
                >
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />
                  Reverter
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Incidentes de guardrail (#523) */}
      <section className="surface-sheen rounded-xl bg-surface shadow-soft">
        <h2 className="flex items-center gap-2 border-b p-3 text-sm font-medium">
          <AlertTriangle className="h-4 w-4" />
          Incidentes de guardrail ({incidents.length})
        </h2>
        {incidents.length === 0 ? (
          <p className="p-4 text-sm text-content-muted">
            Nenhum bloqueio no período — a IA não tentou inventar preço.
          </p>
        ) : (
          <ul className="divide-y">
            {incidents.map((i) => (
              <li key={i.id} className="p-3 text-sm">
                <p className="font-medium">
                  {i.lead.name ?? i.lead.phone ?? 'Lead'}{' '}
                  <span className="text-xs text-content-muted">
                    {new Date(i.happensAt).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </p>
                <p className="mt-1 text-xs text-content-muted">
                  Resposta bloqueada: “{String((i.properties as any)?.blockedText ?? '').slice(0, 160)}”
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!enabled && (
        <EmptyState
          icon={Bot}
          title="SDR IA desligado"
          description="Configure modelo, trocas máximas e horário em Config CRM; ligue aqui quando quiser. Requer ANTHROPIC_API_KEY no servidor."
        />
      )}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-caption text-content-muted">{label}</p>
      <p className="mt-1 text-[22px] font-semibold leading-7 tracking-[-0.02em] tabular-nums text-content">{value}</p>
      {hint && <p className="mt-0.5 text-helper text-content-muted">{hint}</p>}
    </div>
  );
}
