'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Percent, ShieldAlert, Info } from 'lucide-react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { apiClient } from '@/lib/api-client';
import { useList, useUpdate } from '@/hooks/use-resource';
import { usePermission } from '@/hooks/use-permission';
import { erroDeAcao } from '@/lib/feedback';
import { formatPercent } from '@/lib/format';
import { USER_ROLE_LABELS } from '@/lib/enums';
import type { DiscountPolicy } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

/**
 * Alçadas de desconto (#391 · #1004, IAM C5).
 *
 * O teto é POR PERFIL v2 (DiscountPolicy.roleId → Role): a tabela mostra o
 * NOME do perfil, nunca o enum legado. Quem pode vender ACIMA do teto não é
 * configurado aqui: é a permissão `sales.discount.override` do perfil, na
 * tela Perfis e permissões (#947) — por isso o teto máximo editável é 99,99%.
 */

const RESOURCE = '/sales/discount-policies';

// z.number (com valueAsNumber no register), NUNCA z.coerce: coerce transforma
// campo vazio em 0 e salvaria teto 0% sem o usuário digitar nada.
const schema = z.object({
  maxDiscountPct: z
    .number({ invalid_type_error: 'Informe o teto em porcentagem' })
    .min(0, 'O teto não pode ser negativo')
    .max(99.99, 'Teto de 100% não é uma alçada. Para desconto sem limite, conceda a permissão de ultrapassar a alçada ao perfil, em Perfis e permissões.'),
});

type FormValues = z.infer<typeof schema>;

export default function DiscountPoliciesPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = usePermission();
  const canView = can('sales.discount-policies.view');
  const canConfigure = can('sales.discount-policies.configure');

  const { data: policies = [], isLoading } = useList<DiscountPolicy>(RESOURCE, undefined, {
    enabled: canView,
  });
  const update = useUpdate<DiscountPolicy, { maxDiscountPct?: number; isActive?: boolean }>(RESOURCE);

  const [editing, setEditing] = useState<DiscountPolicy | null>(null);

  const seed = useMutation({
    mutationFn: async () => (await apiClient.post(`${RESOURCE}/seed-defaults`)).data,
    onSuccess: (r: { created: number }) => {
      qc.invalidateQueries({ queryKey: [RESOURCE] });
      toast.success(
        r.created > 0 ? `${r.created} alçadas padrão criadas` : 'As alçadas padrão já existiam',
      );
    },
    onError: (e) => toast.error(erroDeAcao('criar as alçadas padrão', e)),
  });

  function handleSubmit(values: FormValues) {
    if (!editing) return;
    // Linha inativa: salvar REATIVA junto com o novo teto. Sem isso, uma
    // alçada desativada (ex.: as de 100% que a migration da #1004 desligou)
    // ficaria num beco: a API recusa reativar mantendo 100%, e a tela não
    // oferecia como reativar corrigindo o teto.
    const reativando = !editing.isActive;
    update.mutate(
      {
        id: editing.id,
        data: { maxDiscountPct: values.maxDiscountPct, ...(reativando ? { isActive: true } : {}) },
      },
      {
        onSuccess: () => {
          toast.success(
            reativando
              ? `Alçada de ${nomeDoPerfil(editing)} reativada com teto de ${values.maxDiscountPct}%`
              : `Teto de ${nomeDoPerfil(editing)} atualizado`,
          );
          setEditing(null);
        },
        onError: (e) => toast.error(erroDeAcao('atualizar a alçada', e)),
      },
    );
  }

  const columns: Column<DiscountPolicy>[] = [
    {
      key: 'role',
      header: 'Perfil',
      sortable: true,
      accessor: (p) => nomeDoPerfil(p),
      cell: (p) => (
        <div>
          <span className="font-medium">{nomeDoPerfil(p)}</span>
          {p.roleRef && (
            <span className="ml-2 font-mono text-[11px] text-content-muted">{p.roleRef.code}</span>
          )}
        </div>
      ),
    },
    {
      key: 'maxDiscountPct',
      header: 'Teto de desconto',
      align: 'right',
      sortable: true,
      accessor: (p) => Number(p.maxDiscountPct),
      cell: (p) => (
        <span className="font-medium tabular-nums">{formatPercent(p.maxDiscountPct)}</span>
      ),
    },
    {
      key: 'isActive',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (p) => (p.isActive ? 1 : 0),
      cell: (p) => (
        <Badge variant={p.isActive ? 'success' : 'neutral'}>
          {p.isActive ? 'Ativa' : 'Inativa'}
        </Badge>
      ),
    },
    ...(canConfigure
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right',
            cell: (p) => (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(p);
                }}
                title={p.isActive ? 'Editar teto' : 'Reativar com novo teto'}
                className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400"
              >
                <Pencil size={15} />
              </button>
            ),
          } satisfies Column<DiscountPolicy>,
        ]
      : []),
  ];

  if (!canView) {
    return (
      <div>
        <PageHeader
          title="Alçadas de desconto"
          description="Teto de desconto por perfil na criação do pedido de venda."
        />
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-line bg-surface py-16 text-center">
          <ShieldAlert className="text-content-muted" size={40} />
          <div>
            <p className="text-sm font-medium text-content-secondary">Acesso restrito</p>
            <p className="text-xs text-content-muted">
              Você precisa da permissão de ver alçadas de desconto.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Alçadas de desconto"
        description="Teto de desconto por perfil na criação do pedido de venda."
        actions={
          canConfigure && !isLoading && policies.length === 0 ? (
            <Button onClick={() => seed.mutate()} disabled={seed.isPending}>
              <Percent size={16} />
              Criar alçadas padrão
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-surface-secondary px-3 py-2 text-xs text-content-muted">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          O teto vale para quem tem o perfil. Com mais de um perfil, vale a maior alçada; sem
          nenhum perfil com alçada, vale o teto padrão de 10%. Para permitir desconto acima de
          qualquer teto, conceda a permissão de ultrapassar a alçada ao perfil, em Perfis e
          permissões.
        </span>
      </div>

      <DataTable
        data={policies}
        columns={columns}
        loading={isLoading}
        onRowClick={canConfigure ? (p) => setEditing(p) : undefined}
        searchPlaceholder="Buscar por perfil..."
        emptyMessage="Nenhuma alçada cadastrada. Crie as alçadas padrão para começar."
      />

      <FormDialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing && !editing.isActive ? 'Reativar alçada' : 'Editar alçada'}
        description={
          editing
            ? editing.isActive
              ? `Teto de desconto do perfil ${nomeDoPerfil(editing)}.`
              : `Esta alçada está inativa. Ao salvar, ela volta a valer para o perfil ${nomeDoPerfil(editing)} com o teto informado.`
            : ''
        }
        formId="discount-policy-form"
        loading={update.isPending}
      >
        {editing && (
          <PolicyForm
            key={editing.id}
            formId="discount-policy-form"
            defaultValue={Number(editing.maxDiscountPct)}
            onSubmit={handleSubmit}
          />
        )}
      </FormDialog>
    </div>
  );
}

function nomeDoPerfil(p: DiscountPolicy): string {
  // roleRef null só em linha legada não convertida (não deve existir após a
  // migration da #1004). Fallback pelo rótulo humano do enum, nunca o enum
  // cru ("COMMERCIAL") na tela.
  if (p.roleRef?.name) return p.roleRef.name;
  if (p.role) return USER_ROLE_LABELS[p.role as keyof typeof USER_ROLE_LABELS] ?? p.role;
  return 'Perfil desconhecido';
}

function PolicyForm({
  formId,
  defaultValue,
  onSubmit,
}: {
  formId: string;
  defaultValue: number;
  onSubmit: (values: FormValues) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { maxDiscountPct: defaultValue },
  });

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      <Field label="Teto de desconto (%)" required error={errors.maxDiscountPct?.message}>
        <Input
          {...register('maxDiscountPct', { valueAsNumber: true })}
          error={!!errors.maxDiscountPct}
          type="number"
          step="0.01"
          min="0"
          max="99.99"
          inputMode="decimal"
        />
      </Field>
    </form>
  );
}
