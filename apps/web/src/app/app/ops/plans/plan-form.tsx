'use client';

import { useState } from 'react';
import type { EntitlementDef, EntitlementValue, Plan } from '@/types/api';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MaskedInput } from '@/components/ui/masked-input';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';

/**
 * Formulário de criação/edição de plano — OPS WP4 (#911).
 * As perguntas de entitlements são geradas DINAMICAMENTE a partir do
 * `catalog` (fonte da verdade no backend) — nenhuma key fica hardcoded aqui.
 */

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,30}$/;

export interface PlanFormValues {
  code: string;
  name: string;
  description?: string;
  priceCents?: number;
  active: boolean;
  entitlements: Record<string, EntitlementValue>;
}

/** Preenche todas as keys do catálogo — key ausente no plano existente ganha default. */
function defaultEntitlements(
  catalog: EntitlementDef[],
  existing?: Record<string, EntitlementValue>,
): Record<string, EntitlementValue> {
  const out: Record<string, EntitlementValue> = {};
  for (const def of catalog) {
    const v = existing?.[def.key];
    out[def.key] = v !== undefined ? v : def.type === 'bool' ? false : 0;
  }
  return out;
}

function EntitlementField({
  def,
  value,
  onChange,
}: {
  def: EntitlementDef;
  value: EntitlementValue;
  onChange: (v: EntitlementValue) => void;
}) {
  if (def.type === 'bool') {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-content">{def.name}</p>
          {def.description && (
            <p className="mt-0.5 text-xs text-content-muted">{def.description}</p>
          )}
        </div>
        <Toggle checked={value === true} onCheckedChange={(v) => onChange(v)} />
      </div>
    );
  }

  const unlimited = value === null;
  return (
    <div className="rounded-lg border border-line px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-content">{def.name}</p>
          {def.description && (
            <p className="mt-0.5 text-xs text-content-muted">{def.description}</p>
          )}
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-content-secondary">
          <input
            type="checkbox"
            checked={unlimited}
            onChange={(e) => onChange(e.target.checked ? null : 0)}
            className="h-3.5 w-3.5 rounded border-line accent-brand-600"
          />
          Ilimitado
        </label>
      </div>
      {!unlimited && (
        <Input
          type="number"
          min={0}
          step={1}
          inputSize="sm"
          className="mt-2"
          value={typeof value === 'number' ? value : 0}
          onChange={(e) => onChange(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
        />
      )}
    </div>
  );
}

export function PlanForm({
  formId,
  isEdit,
  catalog,
  plan,
  onSubmit,
}: {
  formId: string;
  isEdit: boolean;
  catalog: EntitlementDef[];
  /** Plano sendo editado (undefined na criação). */
  plan?: Plan;
  onSubmit: (values: PlanFormValues) => void;
}) {
  const [code, setCode] = useState(plan?.code ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [priceCents, setPriceCents] = useState<number | undefined>(plan?.priceCents ?? undefined);
  const [active, setActive] = useState(plan?.active ?? true);
  const [entitlements, setEntitlements] = useState<Record<string, EntitlementValue>>(() =>
    defaultEntitlements(catalog, plan?.entitlements),
  );
  const [touched, setTouched] = useState(false);

  const codeError = touched && !CODE_PATTERN.test(code) ? 'Código deve ser MAIÚSCULO (A-Z, 0-9, _), 2 a 31 caracteres' : undefined;
  const nameError = touched && name.trim().length < 2 ? 'Mínimo de 2 caracteres' : undefined;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!CODE_PATTERN.test(code) || name.trim().length < 2) return;
    onSubmit({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      description: description.trim() || undefined,
      priceCents,
      active,
      entitlements,
    });
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-4 py-1">
      {isEdit && plan && (
        <Alert
          variant="warning"
          title="Alterações afetam todas as contas neste plano"
          description={
            plan._count.companies > 0
              ? `Entram em vigor imediatamente para as ${plan._count.companies} conta(s) vinculada(s) a este plano (efeito em até 60s).`
              : 'Nenhuma conta está neste plano no momento — as alterações valem para as próximas atribuições.'
          }
        />
      )}

      <Field label="Código" required error={codeError}>
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          disabled={isEdit}
          error={!!codeError}
          placeholder="Ex.: PROFISSIONAL"
        />
      </Field>

      <Field label="Nome" required error={nameError}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={!!nameError}
          placeholder="Ex.: Profissional"
        />
      </Field>

      <Field label="Descrição">
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="O que este plano inclui."
        />
      </Field>

      <Field label="Preço de tabela (R$/mês)">
        <MaskedInput
          mask="currency"
          defaultValue={priceCents != null ? String(priceCents) : ''}
          placeholder="R$ 0,00"
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '');
            setPriceCents(digits ? Number(digits) : undefined);
          }}
        />
      </Field>

      {isEdit && <Toggle checked={active} onCheckedChange={setActive} label="Plano ativo" />}

      <div>
        <Label>Entitlements</Label>
        <div className="mt-2 space-y-2">
          {catalog.map((def) => (
            <EntitlementField
              key={def.key}
              def={def}
              value={entitlements[def.key]}
              onChange={(v) => setEntitlements((prev) => ({ ...prev, [def.key]: v }))}
            />
          ))}
        </div>
      </div>
    </form>
  );
}
