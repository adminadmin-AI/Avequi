'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

interface Settings {
  slaFirstResponseMin: number;
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

  const { data: settings } = useQuery<Settings>({
    queryKey: ['crm-settings'],
    queryFn: async () => (await apiClient.get('/crm/settings')).data,
  });
  const { data: sellers = [] } = useQuery<Seller[]>({
    queryKey: ['crm-sellers'],
    queryFn: async () => (await apiClient.get('/crm/settings/sellers')).data,
  });

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const save = useMutation({
    mutationFn: () => apiClient.patch('/crm/settings', form),
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

  if (!settings) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <PageHeader title="Configuração do CRM" description="SLA, rodízio, WhatsApp e follow-up" />

      <section className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
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
            className="w-full rounded-md border bg-background px-2 py-2 text-sm"
            value={form.waPhoneNumberId ?? ''}
            onChange={(e) => setForm({ ...form, waPhoneNumberId: e.target.value })}
          />
        </Field>
        <Field label="LGPD: anonimizar perdidos após (dias, 0 = desligado)">
          <input
            type="number"
            min={0}
            className="w-full rounded-md border bg-background px-2 py-2 text-sm"
            value={form.leadRetentionDays ?? 0}
            onChange={(e) => setForm({ ...form, leadRetentionDays: parseInt(e.target.value, 10) || 0 })}
          />
        </Field>
      </section>

      <section className="space-y-3 rounded-lg border p-4">
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
              className="w-full rounded-md border bg-background px-2 py-2 text-sm"
              placeholder="nome do template aprovado"
              value={form.autoFollowupTemplate ?? ''}
              onChange={(e) => setForm({ ...form, autoFollowupTemplate: e.target.value })}
            />
          </Field>
        </div>
      </section>

      {/* SDR IA (F4 #524): kill switch, modelo A/B, trocas e horário */}
      <section className="space-y-3 rounded-lg border p-4">
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
              className="w-full rounded-md border bg-background px-2 py-2 text-sm"
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
              className="w-full rounded-md border bg-background px-2 py-2 text-sm"
              value={form.sdrSchedule ?? '24_7'}
              onChange={(e) => setForm({ ...form, sdrSchedule: e.target.value as Settings['sdrSchedule'] })}
            >
              <option value="24_7">24/7 (sempre)</option>
              <option value="OFF_HOURS">Só fora do expediente</option>
            </select>
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
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

      <section className="rounded-lg border">
        <h2 className="border-b p-3 text-sm font-medium">Disponibilidade dos vendedores (rodízio)</h2>
        <ul className="divide-y">
          {sellers.map((s) => (
            <li key={s.id} className="flex items-center justify-between p-3 text-sm">
              <span>
                {s.name} <span className="text-xs text-muted-foreground">({s.role})</span>
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
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
function NumInput({ value, onChange }: { value?: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      min={1}
      className="w-full rounded-md border bg-background px-2 py-2 text-sm"
      value={value ?? ''}
      onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
    />
  );
}
