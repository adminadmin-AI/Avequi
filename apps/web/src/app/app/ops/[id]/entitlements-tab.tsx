'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { ehNegativaDeAcesso, mensagemDoErro } from '@/lib/api-error';
import { erroDeAcao } from '@/lib/feedback';
import { formatDateTime } from '@/lib/format';
import type {
  AssignTenantPlanInput,
  EntitlementDef,
  EntitlementValue,
  PlansCatalog,
  SetTenantOverrideInput,
  TenantEntitlementOverride,
  TenantEntitlements,
} from '@/types/api';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { FormDialog } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import { Can } from '@/components/can';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';

const RESOURCE = '/ops/tenants';

function InlineError({ message }: { message: string }) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-content-muted">
      <AlertTriangle size={14} />
      {message}
    </p>
  );
}

/** Rótulo pt-BR do valor efetivo, conforme o tipo do entitlement. */
function effectiveValueLabel(def: EntitlementDef, value: EntitlementValue): React.ReactNode {
  if (def.type === 'bool') {
    return value === true ? (
      <span className="inline-flex items-center gap-1 text-success">
        <Check size={15} /> Sim
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-content-muted">
        <X size={15} /> Não
      </span>
    );
  }
  return <span className="tabular-nums">{value === null || value === undefined ? 'Ilimitado' : value}</span>;
}

type Origin = 'Plano' | 'Exceção' | 'Legado';
const ORIGIN_VARIANT: Record<Origin, BadgeVariant> = {
  Plano: 'info',
  Exceção: 'warning',
  Legado: 'neutral',
};

// ─── Valor da exceção (form) ────────────────────────────────────────────────
function OverrideValueField({
  def,
  value,
  onChange,
}: {
  def: EntitlementDef;
  value: EntitlementValue;
  onChange: (v: EntitlementValue) => void;
}) {
  if (def.type === 'bool') {
    return <Toggle checked={value === true} onCheckedChange={onChange} label={value === true ? 'Ligado' : 'Desligado'} />;
  }
  const unlimited = value === null;
  return (
    <div>
      <label className="mb-1.5 flex cursor-pointer items-center gap-1.5 text-xs text-content-secondary">
        <input
          type="checkbox"
          checked={unlimited}
          onChange={(e) => onChange(e.target.checked ? null : 0)}
          className="h-3.5 w-3.5 rounded border-line accent-brand-600"
        />
        Ilimitado
      </label>
      {!unlimited && (
        <Input
          type="number"
          min={0}
          step={1}
          value={typeof value === 'number' ? value : 0}
          onChange={(e) => onChange(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
        />
      )}
    </div>
  );
}

// ─── Dialog de exceção (criar/editar) ───────────────────────────────────────
function OverrideDialog({
  open,
  onOpenChange,
  catalog,
  editing,
  loading,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  catalog: EntitlementDef[];
  /** exceção sendo editada (null = nova exceção). */
  editing: TenantEntitlementOverride | null;
  loading: boolean;
  onSubmit: (key: string, value: EntitlementValue, reason: string) => void;
}) {
  const [key, setKey] = useState(editing?.key ?? catalog[0]?.key ?? '');
  const def = catalog.find((d) => d.key === key);
  const [value, setValue] = useState<EntitlementValue>(
    editing ? editing.value : def?.type === 'bool' ? false : 0,
  );
  const [reason, setReason] = useState(editing?.reason ?? '');
  const [touched, setTouched] = useState(false);
  const reasonTooShort = reason.trim().length < 5;

  function handleKeyChange(nextKey: string) {
    setKey(nextKey);
    const nextDef = catalog.find((d) => d.key === nextKey);
    setValue(nextDef?.type === 'bool' ? false : 0);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!key || reasonTooShort) return;
    onSubmit(key, value, reason.trim());
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? `Editar exceção: ${editing.key}` : 'Nova exceção de entitlement'}
      description="Exceção do tenant: sobrepõe o valor do plano só para esta conta. Fica registrada com motivo e data."
      formId="override-form"
      loading={loading}
    >
      <form id="override-form" onSubmit={handleSubmit} className="space-y-4 py-1">
        <Field label="Entitlement" required>
          <Select value={key} onChange={(e) => handleKeyChange(e.target.value)} disabled={!!editing}>
            {catalog.map((d) => (
              <option key={d.key} value={d.key}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>

        {def && (
          <Field label="Valor da exceção">
            <OverrideValueField def={def} value={value} onChange={setValue} />
          </Field>
        )}

        <Field label="Motivo" required error={touched && reasonTooShort ? 'Informe pelo menos 5 caracteres.' : undefined}>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Por que esta conta precisa de um valor diferente do plano (obrigatório, mínimo 5 caracteres)"
            error={touched && reasonTooShort}
          />
        </Field>
      </form>
    </FormDialog>
  );
}

// ─── Plano atual + troca de plano ───────────────────────────────────────────
function CurrentPlanCard({
  tenantId,
  data,
}: {
  tenantId: string;
  data: TenantEntitlements;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const plansQuery = useQuery<PlansCatalog>({
    queryKey: ['/ops/plans'],
    queryFn: async () => (await apiClient.get<PlansCatalog>('/ops/plans')).data,
  });

  const [selected, setSelected] = useState(data.plan?.id ?? '');
  useEffect(() => setSelected(data.plan?.id ?? ''), [data.plan?.id]);

  const assignPlan = useMutation({
    mutationFn: (input: AssignTenantPlanInput) =>
      apiClient.patch(`${RESOURCE}/${tenantId}/plan`, input),
    onSuccess: () => {
      toast.success('Plano da conta atualizado');
      qc.invalidateQueries({ queryKey: [RESOURCE, tenantId, 'entitlements'] });
    },
    onError: (err) => {
      toast.error(erroDeAcao('trocar o plano', err));
      setSelected(data.plan?.id ?? '');
    },
  });

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const planId = e.target.value || null;
    const planName = plansQuery.data?.plans.find((p) => p.id === planId)?.name;
    setSelected(e.target.value);
    const ok = await confirm({
      title: planId ? `Trocar plano para "${planName}"?` : 'Voltar ao modo legado?',
      description: planId
        ? 'O acesso da conta muda para refletir o novo plano em até 60 segundos.'
        : 'A conta volta ao modo legado: tudo liberado, sem limites. O acesso muda em até 60 segundos.',
      confirmLabel: 'Confirmar troca',
    });
    if (!ok) {
      setSelected(data.plan?.id ?? '');
      return;
    }
    assignPlan.mutate({ planId });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Plano atual</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.resolved.legacy ? (
          <Badge variant="neutral">Legado: tudo liberado</Badge>
        ) : (
          <div>
            <p className="font-medium text-content">{data.plan?.name}</p>
            <p className="font-mono text-xs text-content-muted">{data.plan?.code}</p>
          </div>
        )}

        <Can permission="ops.tenants.manage">
          <Field label="Trocar plano">
            {plansQuery.isError ? (
              <InlineError message="Não foi possível carregar os planos disponíveis." />
            ) : (
              <Select
                value={selected}
                onChange={handleChange}
                disabled={plansQuery.isLoading || assignPlan.isPending}
              >
                <option value="">Legado (sem plano)</option>
                {(plansQuery.data?.plans ?? [])
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        </Can>
      </CardContent>
    </Card>
  );
}

// ─── Aba "Plano & Módulos" ───────────────────────────────────────────────────
export function EntitlementsTab({ tenantId }: { tenantId: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const entitlementsQuery = useQuery<TenantEntitlements>({
    queryKey: [RESOURCE, tenantId, 'entitlements'],
    queryFn: async () =>
      (await apiClient.get<TenantEntitlements>(`${RESOURCE}/${tenantId}/entitlements`)).data,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOverride, setEditingOverride] = useState<TenantEntitlementOverride | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: [RESOURCE, tenantId, 'entitlements'] });

  const setOverride = useMutation({
    mutationFn: ({ key, input }: { key: string; input: SetTenantOverrideInput }) =>
      apiClient.put(`${RESOURCE}/${tenantId}/entitlements/${key}`, input),
    onSuccess: () => {
      toast.success('Exceção salva');
      invalidate();
      setDialogOpen(false);
    },
    onError: (err) => toast.error(erroDeAcao('salvar a exceção', err)),
  });

  const removeOverride = useMutation({
    mutationFn: (key: string) => apiClient.delete(`${RESOURCE}/${tenantId}/entitlements/${key}`),
    onSuccess: () => {
      toast.success('Exceção removida. A conta volta ao valor do plano.');
      invalidate();
    },
    onError: (err) => toast.error(erroDeAcao('remover a exceção', err)),
  });

  function openCreate() {
    setEditingOverride(null);
    setDialogOpen(true);
  }

  function openEdit(o: TenantEntitlementOverride) {
    setEditingOverride(o);
    setDialogOpen(true);
  }

  async function handleRemove(o: TenantEntitlementOverride) {
    const ok = await confirm({
      title: 'Remover exceção?',
      description: `"${o.key}" volta a valer o que o plano define para esta conta.`,
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (ok) removeOverride.mutate(o.key);
  }

  if (entitlementsQuery.isError) {
    const negado = ehNegativaDeAcesso(entitlementsQuery.error);
    return (
      <InlineError
        message={
          negado
            ? (mensagemDoErro(entitlementsQuery.error) ?? 'Você não tem permissão para ver o plano desta conta.')
            : 'Não foi possível carregar o plano e os entitlements desta conta.'
        }
      />
    );
  }

  if (entitlementsQuery.isLoading || !entitlementsQuery.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  const data = entitlementsQuery.data;
  const overridesByKey = new Map(data.overrides.map((o) => [o.key, o]));

  function originFor(key: string): Origin {
    if (overridesByKey.has(key)) return 'Exceção';
    return data.resolved.legacy ? 'Legado' : 'Plano';
  }

  return (
    <div className="space-y-5">
      <CurrentPlanCard tenantId={tenantId} data={data} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mapa resolvido</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-content-muted">
                  <th className="py-2 pr-4 font-medium">Entitlement</th>
                  <th className="py-2 pr-4 font-medium">Valor efetivo</th>
                  <th className="py-2 pr-4 font-medium">Origem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.catalog.map((def) => {
                  const origin = originFor(def.key);
                  return (
                    <tr key={def.key}>
                      <td className="py-2.5 pr-4">
                        <p className="font-medium text-content">{def.name}</p>
                        {def.description && (
                          <p className="text-xs text-content-muted">{def.description}</p>
                        )}
                      </td>
                      <td className="py-2.5 pr-4">{effectiveValueLabel(def, data.resolved.values[def.key])}</td>
                      <td className="py-2.5 pr-4">
                        <Badge variant={ORIGIN_VARIANT[origin]}>{origin}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Can permission="ops.tenants.manage">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">Exceções</CardTitle>
            <Button size="sm" onClick={openCreate}>
              <Plus size={15} />
              Nova exceção
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {data.overrides.length === 0 ? (
              <EmptyState
                compact
                title="Nenhuma exceção cadastrada"
                description="Exceções sobrepõem o valor do plano só para esta conta. Sempre com motivo registrado."
              />
            ) : (
              <ul className="divide-y divide-line">
                {data.overrides.map((o) => {
                  const def = data.catalog.find((d) => d.key === o.key);
                  return (
                    <li key={o.key} className="flex items-start justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <p className="font-medium text-content">{def?.name ?? o.key}</p>
                        <p className="mt-0.5 text-content-secondary">{o.reason}</p>
                        <p className="mt-0.5 text-xs text-content-muted" title={formatDateTime(o.createdAt)}>
                          {formatDateTime(o.createdAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {def && effectiveValueLabel(def, o.value)}
                        <button
                          type="button"
                          onClick={() => openEdit(o)}
                          title="Editar exceção"
                          className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 hover:text-brand-600 dark:hover:bg-neutral-800 dark:hover:text-brand-400"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(o)}
                          title="Remover exceção"
                          className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 hover:text-danger dark:hover:bg-neutral-800"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <OverrideDialog
          key={editingOverride?.key ?? 'new'}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          catalog={data.catalog}
          editing={editingOverride}
          loading={setOverride.isPending}
          onSubmit={(key, value, reason) => setOverride.mutate({ key, input: { value, reason } })}
        />
      </Can>
    </div>
  );
}
