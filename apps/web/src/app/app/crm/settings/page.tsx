'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { usePermission } from '@/hooks/use-permission';
import { ErrorState } from '@/components/ui/error-state';
import { ehNegativaDeAcesso, mensagemDoErro } from '@/lib/api-error';
import { PushSettings } from './push-settings';
import { buildSettingsPayload } from './settings-payload';

interface Settings {
  slaFirstResponseMin: number;
  slaEscalationEnabled: boolean;
  slaEscalationFactor: number;
  coolingHours: number;
  reopenLostDays: number;
  autoFollowupEnabled: boolean;
  autoFollowupStageId: string | null;
  autoFollowupHours: number;
  autoFollowupTemplate: string | null;
  leadRetentionDays: number;
  sdrEnabled: boolean;
  sdrModel: string;
  sdrMaxTurns: number;
  sdrSchedule: '24_7' | 'OFF_HOURS';
  waPhoneNumberId: string | null;
}
interface Seller {
  id: string;
  name: string;
  role: string;
  crmAvailable: boolean;
}

/** Configuração do CRM (F3.5-C1 #551) — gerente ajusta sem tocar no banco. */
export default function CrmSettingsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Partial<Settings>>({});
  // Bloco F (#624, D5): a retenção LGPD comanda o expurgo diário IRREVERSÍVEL —
  // o backend recusa a requisição INTEIRA (403) se leadRetentionDays vier no
  // payload sem crm.lgpd.retention-update. Sem a permissão, o campo fica
  // desabilitado e é OMITIDO do payload (as demais configs salvam normalmente).
  const { can } = usePermission();
  const canEditRetention = can('crm.lgpd.retention-update');

  // #739: 403 não se resolve tentando de novo (é permissão, não instabilidade)
  // — sem isto o react-query repete 3x e o usuário espera o triplo para ver
  // a mesma negativa.
  const semRetryEmNegativa = (falhas: number, erro: any) =>
    !ehNegativaDeAcesso(erro) && falhas < 2;

  const settingsQ = useQuery<Settings>({
    queryKey: ['crm-settings'],
    queryFn: async () => (await apiClient.get('/crm/settings')).data,
    retry: semRetryEmNegativa,
  });
  const sellersQ = useQuery<Seller[]>({
    queryKey: ['crm-sellers'],
    queryFn: async () => (await apiClient.get('/crm/settings/sellers')).data,
    retry: semRetryEmNegativa,
  });
  const settings = settingsQ.data;
  const sellers = sellersQ.data ?? [];

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const save = useMutation({
    mutationFn: () =>
      apiClient.patch('/crm/settings', buildSettingsPayload(form, canEditRetention)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-settings'] });
      toast.success('Configuração salva');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Falha ao salvar'),
  });

  const syncTemplates = useMutation({
    mutationFn: () => apiClient.post('/crm/templates/sync'),
    onSuccess: ({ data }) => toast.success(`${data.synced} template(s) sincronizado(s)`),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Falha ao sincronizar'),
  });

  const toggleSeller = useMutation({
    mutationFn: (v: { userId: string; available: boolean }) =>
      apiClient.patch(`/crm/settings/sellers/${v.userId}/availability`, { available: v.available }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['crm-sellers'] }),
  });

  // #739: antes era `if (!settings)` — que também é verdade quando a consulta
  // FALHA. Com 403 (usuário sem crm.settings.view, caso real da #738) a tela
  // girava o spinner para sempre, sem mensagem nenhuma. Agora carregar e
  // falhar são estados distintos.
  if (settingsQ.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (settingsQ.isError || !settings) {
    const negado = ehNegativaDeAcesso(settingsQ.error);
    return (
      <ErrorState
        title={negado ? 'Acesso negado' : 'Não foi possível carregar as configurações'}
        description={
          negado
            ? 'Você não tem permissão para ver as configurações do CRM. Fale com um administrador se precisar desse acesso.'
            : mensagemDoErro(settingsQ.error) ??
              'Houve uma falha ao buscar as configurações. Tente novamente em instantes.'
        }
        // Retentar uma negativa de permissão só repetiria o 403.
        onRetry={negado ? undefined : () => settingsQ.refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Ajustes do CRM" description="SLA, rodízio, WhatsApp e follow-up" />

      <PushSettings />

      <section className="surface-sheen grid gap-4 rounded-xl bg-surface p-4 shadow-soft sm:grid-cols-2">
        <Field label="SLA de 1ª resposta (min)">
          <NumInput value={form.slaFirstResponseMin} onChange={(v) => setForm({ ...form, slaFirstResponseMin: v })} />
        </Field>
        <Field label="Esfriando após (horas)">
          <NumInput value={form.coolingHours} onChange={(v) => setForm({ ...form, coolingHours: v })} />
        </Field>
        <Field label="Reabrir perdido em até (dias)">
          <NumInput value={form.reopenLostDays} onChange={(v) => setForm({ ...form, reopenLostDays: v })} />
        </Field>
        <Field label="Número WhatsApp da loja (phone_number_id)">
          <input
            className="w-full rounded-md border bg-surface px-2 py-2 text-sm"
            value={form.waPhoneNumberId ?? ''}
            onChange={(e) => setForm({ ...form, waPhoneNumberId: e.target.value })}
          />
        </Field>
        <Field label="LGPD: anonimizar perdidos após (dias, 0 = desligado)">
          <input
            type="number"
            min={0}
            disabled={!canEditRetention}
            title={
              canEditRetention
                ? undefined
                : 'Alterar a retenção LGPD é restrito à alta gestão (crm.lgpd.retention-update)'
            }
            className="w-full rounded-md border bg-surface px-2 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            value={form.leadRetentionDays ?? 0}
            onChange={(e) => setForm({ ...form, leadRetentionDays: parseInt(e.target.value, 10) || 0 })}
          />
          {!canEditRetention && (
            <span className="mt-1 block text-xs text-content-muted">
              🔒 Restrito à alta gestão — o expurgo por retenção é irreversível.
            </span>
          )}
        </Field>
      </section>

      {/* #569 — escalonamento automático: avisa no SLA x1, realoca no x{factor} */}
      <section className="surface-sheen space-y-3 rounded-xl bg-surface p-4 shadow-soft">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">🚨 Escalonamento de SLA</h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!form.slaEscalationEnabled}
              onChange={(e) => setForm({ ...form, slaEscalationEnabled: e.target.checked })}
            />
            Ligado
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Realocar no rodízio após (× o SLA)">
            <input
              type="number"
              min={2}
              className="w-full rounded-md border bg-surface px-2 py-2 text-sm"
              value={form.slaEscalationFactor ?? 2}
              onChange={(e) => setForm({ ...form, slaEscalationFactor: parseInt(e.target.value, 10) || 2 })}
            />
          </Field>
        </div>
        <p className="text-xs text-content-muted">
          Estourou o SLA → vendedor recebe push + alerta (1x). Continuou sem resposta até{' '}
          {form.slaEscalationFactor ?? 2}× o SLA → o lead troca de vendedor pelo rodízio e o
          gerente é avisado. Não vale para leads com a IA atendendo nem para a triagem da matriz.
        </p>
      </section>

      <section className="surface-sheen space-y-3 rounded-xl bg-surface p-4 shadow-soft">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Follow-up automático</h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!form.autoFollowupEnabled}
              onChange={(e) => setForm({ ...form, autoFollowupEnabled: e.target.checked })}
            />
            Ligado
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Disparar após (horas parado)">
            <NumInput value={form.autoFollowupHours} onChange={(v) => setForm({ ...form, autoFollowupHours: v })} />
          </Field>
          <Field label="Template (fora da janela 24h)">
            <input
              className="w-full rounded-md border bg-surface px-2 py-2 text-sm"
              placeholder="nome do template aprovado"
              value={form.autoFollowupTemplate ?? ''}
              onChange={(e) => setForm({ ...form, autoFollowupTemplate: e.target.value })}
            />
          </Field>
        </div>
      </section>

      {/* SDR IA (F4 #524): kill switch, modelo A/B, trocas e horário */}
      <section className="surface-sheen space-y-3 rounded-xl bg-surface p-4 shadow-soft">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">🤖 SDR IA (atendente automático)</h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!form.sdrEnabled}
              onChange={(e) => setForm({ ...form, sdrEnabled: e.target.checked })}
            />
            Ligado
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Modelo (A/B)">
            <select
              className="w-full rounded-md border bg-surface px-2 py-2 text-sm"
              value={form.sdrModel ?? 'claude-opus-4-8'}
              onChange={(e) => setForm({ ...form, sdrModel: e.target.value })}
            >
              <option value="claude-opus-4-8">Opus 4.8 (qualidade)</option>
              <option value="claude-sonnet-5">Sonnet 5 (equilíbrio)</option>
              <option value="claude-haiku-4-5">Haiku 4.5 (custo)</option>
            </select>
          </Field>
          <Field label="Handoff após (trocas da IA)">
            <NumInput value={form.sdrMaxTurns} onChange={(v) => setForm({ ...form, sdrMaxTurns: v })} />
          </Field>
          <Field label="Horário de atuação">
            <select
              className="w-full rounded-md border bg-surface px-2 py-2 text-sm"
              value={form.sdrSchedule ?? '24_7'}
              onChange={(e) => setForm({ ...form, sdrSchedule: e.target.value as Settings['sdrSchedule'] })}
            >
              <option value="24_7">24/7 (sempre)</option>
              <option value="OFF_HOURS">Só fora do expediente</option>
            </select>
          </Field>
        </div>
        <p className="text-xs text-content-muted">
          Requer ANTHROPIC_API_KEY no servidor. Métricas e fila de revisão no painel SDR IA.
        </p>
      </section>

      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Salvar
        </Button>
        <Button variant="secondary" onClick={() => syncTemplates.mutate()} disabled={syncTemplates.isPending}>
          <RefreshCw className={`mr-2 h-4 w-4 ${syncTemplates.isPending ? 'animate-spin' : ''}`} />
          Sincronizar templates
        </Button>
      </div>

      <section className="surface-sheen rounded-xl bg-surface shadow-soft">
        <h2 className="border-b p-3 text-sm font-medium">Disponibilidade dos vendedores (rodízio)</h2>
        {/* #739: a lista falha SOZINHA sem derrubar a tela — mas também não
            pode fingir "nenhum vendedor" quando na verdade não carregou. */}
        {sellersQ.isError && (
          <p className="border-b p-3 text-caption text-content-secondary">
            {ehNegativaDeAcesso(sellersQ.error)
              ? 'Você não tem permissão para ver a lista de vendedores.'
              : 'Não foi possível carregar os vendedores.'}{' '}
            {!ehNegativaDeAcesso(sellersQ.error) && (
              <button
                onClick={() => sellersQ.refetch()}
                className="font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                Tentar de novo
              </button>
            )}
          </p>
        )}
        <ul className="divide-y">
          {sellers.map((s) => (
            <li key={s.id} className="flex items-center justify-between p-3 text-sm">
              <span>
                {s.name} <span className="text-xs text-content-muted">({s.role})</span>
              </span>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={s.crmAvailable}
                  onChange={(e) => toggleSeller.mutate({ userId: s.id, available: e.target.checked })}
                />
                {s.crmAvailable ? 'Recebendo leads' : 'Fora do rodízio'}
              </label>
            </li>
          ))}
        </ul>
      </section>
    </div>
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
function NumInput({ value, onChange }: { value?: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      min={1}
      className="w-full rounded-md border bg-surface px-2 py-2 text-sm"
      value={value ?? ''}
      onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
    />
  );
}
