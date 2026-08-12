'use client';

import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, ShieldAlert, Info } from 'lucide-react';
import { useList, useCreate, useUpdate, useDelete } from '@/hooks/use-resource';
import { usePermission } from '@/hooks/use-permission';
import { erroDeAcao } from '@/lib/feedback';
import { formatBRL } from '@/lib/format';
import type { ApprovalMatrixLevel, ApproverRoleOption } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';

/**
 * Alçadas de aprovação (#188 · #1005, IAM C6).
 *
 * A matriz define QUEM aprova cada documento, por nível e faixa de valor. Os
 * aprovadores são PERFIS v2 (Role.code) — quem tem um dos perfis do nível
 * aprova aquele nível. Sem nenhum nível configurado para o tipo de documento,
 * vale o portão único da permissão de aprovar (sem escada de níveis).
 */

const RESOURCE = '/approvals/matrix';

const TIPO_DOCUMENTO: Record<string, string> = {
  PO: 'Pedido de compra',
  PR: 'Requisição de compra',
};

const OPERADOR: Record<string, string> = {
  gte: 'A partir de',
  gt: 'Acima de',
  lte: 'Até',
  lt: 'Abaixo de',
};

function condicaoLegivel(m: ApprovalMatrixLevel): string {
  if (!m.conditionOp || !m.conditionValue) return 'Qualquer valor';
  return `${OPERADOR[m.conditionOp] ?? m.conditionOp} ${formatBRL(m.conditionValue)}`;
}

/** Corpo enviado ao POST/PATCH — op null limpa a condição no PATCH. */
interface MatrixInput {
  entityType?: string;
  level: number;
  approverRoles: string[];
  conditionOp?: string | null;
  conditionValue?: number;
}

interface FormState {
  entityType: string;
  level: string;
  conditionOp: string; // '' = sem condição
  conditionValue: string;
  approverRoles: string[];
}

const FORM_VAZIO: FormState = {
  entityType: 'PO',
  level: '1',
  conditionOp: '',
  conditionValue: '',
  approverRoles: [],
};

export default function ApprovalMatrixPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = usePermission();
  const canView = can('approvals.matrix.view');
  const canConfigure = can('approvals.matrix.configure');

  const { data: niveis = [], isLoading } = useList<ApprovalMatrixLevel>(RESOURCE, undefined, {
    enabled: canView,
  });
  const { data: perfis = [] } = useList<ApproverRoleOption>(`${RESOURCE}/role-options`, undefined, {
    enabled: canView,
  });
  const create = useCreate<ApprovalMatrixLevel, MatrixInput>(RESOURCE);
  const update = useUpdate<ApprovalMatrixLevel, MatrixInput>(RESOURCE);
  const remover = useDelete(RESOURCE);

  const nomeDoPerfil = useMemo(() => {
    const map = new Map(perfis.map((p) => [p.code, p.name]));
    return (code: string) => map.get(code) ?? code;
  }, [perfis]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ApprovalMatrixLevel | null>(null);
  const [form, setForm] = useState<FormState>(FORM_VAZIO);
  const [erro, setErro] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setForm(FORM_VAZIO);
    setErro(null);
    setDialogOpen(true);
  }

  function openEdit(m: ApprovalMatrixLevel) {
    if (!canConfigure) return;
    setEditing(m);
    setForm({
      entityType: m.entityType,
      level: String(m.level),
      conditionOp: m.conditionOp ?? '',
      conditionValue: m.conditionValue ?? '',
      approverRoles: m.approverRoles,
    });
    setErro(null);
    setDialogOpen(true);
  }

  function togglePerfil(code: string) {
    setForm((f) => ({
      ...f,
      approverRoles: f.approverRoles.includes(code)
        ? f.approverRoles.filter((c) => c !== code)
        : [...f.approverRoles, code],
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const level = Number(form.level);
    if (!Number.isInteger(level) || level < 1) {
      setErro('Informe o nível (1 é o primeiro a aprovar).');
      return;
    }
    // Zero é corte legítimo ("acima de zero" isenta documento de valor zero)
    // — o que se recusa é vazio, não numérico ou negativo.
    if (form.conditionOp) {
      const corte = Number(form.conditionValue);
      if (form.conditionValue.trim() === '' || Number.isNaN(corte) || corte < 0) {
        setErro('Informe o valor de corte da condição.');
        return;
      }
    }
    if (form.approverRoles.length === 0) {
      setErro('Selecione pelo menos um perfil aprovador.');
      return;
    }
    setErro(null);

    const condicao = form.conditionOp
      ? { conditionOp: form.conditionOp, conditionValue: Number(form.conditionValue) }
      : editing
        ? { conditionOp: null }
        : {};
    const payload: MatrixInput = { level, approverRoles: form.approverRoles, ...condicao };

    if (editing) {
      update.mutate(
        { id: editing.id, data: payload },
        {
          onSuccess: () => {
            toast.success(`Nível ${level} de ${TIPO_DOCUMENTO[editing.entityType]} atualizado`);
            setDialogOpen(false);
          },
          onError: (err) => toast.error(erroDeAcao('atualizar o nível de alçada', err)),
        },
      );
    } else {
      create.mutate({ entityType: form.entityType, ...payload }, {
        onSuccess: () => {
          toast.success(`Nível ${level} de ${TIPO_DOCUMENTO[form.entityType]} criado`);
          setDialogOpen(false);
        },
        onError: (err) => toast.error(erroDeAcao('criar o nível de alçada', err)),
      });
    }
  }

  async function handleDelete(m: ApprovalMatrixLevel) {
    const ok = await confirm({
      title: 'Excluir o nível de alçada?',
      description: `${TIPO_DOCUMENTO[m.entityType]}, nível ${m.level} (${condicaoLegivel(m).toLowerCase()}). Os documentos dessa faixa deixam de exigir esta aprovação.`,
      confirmLabel: 'Excluir',
      variant: 'danger',
    });
    if (!ok) return;
    remover.mutate(m.id, {
      onSuccess: () => toast.success(`Nível ${m.level} de ${TIPO_DOCUMENTO[m.entityType]} excluído`),
      onError: (err) => toast.error(erroDeAcao('excluir o nível de alçada', err)),
    });
  }

  const columns: Column<ApprovalMatrixLevel>[] = [
    {
      key: 'entityType',
      header: 'Documento',
      sortable: true,
      accessor: (m) => m.entityType,
      cell: (m) => <span className="font-medium">{TIPO_DOCUMENTO[m.entityType] ?? m.entityType}</span>,
    },
    {
      key: 'level',
      header: 'Nível',
      align: 'center',
      sortable: true,
      accessor: (m) => m.level,
      cell: (m) => <span className="tabular-nums">{m.level}</span>,
    },
    {
      key: 'condition',
      header: 'Condição de valor',
      cell: (m) => <span className="text-content-secondary">{condicaoLegivel(m)}</span>,
    },
    {
      key: 'approverRoles',
      header: 'Quem aprova',
      cell: (m) => (
        <div className="flex flex-wrap gap-1">
          {m.approverRoles.map((code) => (
            <Badge key={code} variant="neutral">
              {nomeDoPerfil(code)}
            </Badge>
          ))}
        </div>
      ),
    },
    ...(canConfigure
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right',
            cell: (m) => (
              <div className="flex items-center justify-end gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openEdit(m);
                  }}
                  title="Editar"
                  className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400"
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(m);
                  }}
                  title="Excluir"
                  className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-danger"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ),
          } satisfies Column<ApprovalMatrixLevel>,
        ]
      : []),
  ];

  if (!canView) {
    return (
      <div>
        <PageHeader
          title="Alçadas de aprovação"
          description="Quem aprova pedidos e requisições de compra, por nível e faixa de valor."
        />
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-line bg-surface py-16 text-center">
          <ShieldAlert className="text-content-muted" size={40} />
          <div>
            <p className="text-sm font-medium text-content-secondary">Acesso restrito</p>
            <p className="text-xs text-content-muted">
              Você precisa da permissão de ver alçadas de aprovação.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Alçadas de aprovação"
        description="Quem aprova pedidos e requisições de compra, por nível e faixa de valor."
        actions={
          canConfigure ? (
            <Button onClick={openCreate}>
              <Plus size={16} />
              Criar nível de alçada
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-surface-secondary px-3 py-2 text-xs text-content-muted">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          Cada nível é aprovado por quem tem um dos perfis dele. Um documento só é aprovado quando
          todos os níveis da faixa de valor forem aprovados, em ordem. Sem nenhum nível configurado
          para o tipo de documento, basta a permissão de aprovar.
        </span>
      </div>

      <DataTable
        data={niveis}
        columns={columns}
        loading={isLoading}
        onRowClick={canConfigure ? openEdit : undefined}
        searchPlaceholder="Buscar por documento ou perfil..."
        emptyMessage="Nenhum nível de alçada configurado. Sem a matriz, quem tem a permissão de aprovar aprova em nível único."
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? 'Editar nível de alçada' : 'Criar nível de alçada'}
        description={
          editing
            ? `${TIPO_DOCUMENTO[editing.entityType]}, nível ${editing.level}.`
            : 'Defina o documento, a faixa de valor e quem aprova.'
        }
        formId="approval-matrix-form"
        loading={create.isPending || update.isPending}
      >
        <form id="approval-matrix-form" onSubmit={handleSubmit} className="space-y-4 py-1">
          {!editing && (
            <Field label="Documento" required>
              <Select
                value={form.entityType}
                onChange={(e) => setForm((f) => ({ ...f, entityType: e.target.value }))}
              >
                <option value="PO">Pedido de compra</option>
                <option value="PR">Requisição de compra</option>
              </Select>
            </Field>
          )}

          <Field label="Nível" required>
            <Input
              type="number"
              min="1"
              step="1"
              value={form.level}
              onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
            />
            <p className="mt-1 text-xs text-content-muted">
              1 é o primeiro a aprovar; níveis maiores aprovam depois.
            </p>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Condição de valor">
              <Select
                value={form.conditionOp}
                onChange={(e) => setForm((f) => ({ ...f, conditionOp: e.target.value }))}
              >
                <option value="">Qualquer valor</option>
                <option value="gte">A partir de</option>
                <option value="gt">Acima de</option>
                <option value="lte">Até</option>
                <option value="lt">Abaixo de</option>
              </Select>
            </Field>
            <Field label="Valor (R$)">
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                disabled={!form.conditionOp}
                value={form.conditionValue}
                onChange={(e) => setForm((f) => ({ ...f, conditionValue: e.target.value }))}
              />
            </Field>
          </div>

          <Field label="Quem aprova" required error={erro ?? undefined}>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
              {perfis.map((p) => (
                <label
                  key={p.code}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <input
                    type="checkbox"
                    checked={form.approverRoles.includes(p.code)}
                    onChange={() => togglePerfil(p.code)}
                    className="h-4 w-4 rounded border-line accent-brand-600"
                  />
                  <span>{p.name}</span>
                  <span className="ml-auto font-mono text-[11px] text-content-muted">{p.code}</span>
                </label>
              ))}
              {perfis.length === 0 && (
                <p className="px-2 py-1.5 text-xs text-content-muted">
                  Nenhum perfil ativo encontrado. Verifique Perfis e permissões.
                </p>
              )}
            </div>
          </Field>
        </form>
      </FormDialog>
    </div>
  );
}
