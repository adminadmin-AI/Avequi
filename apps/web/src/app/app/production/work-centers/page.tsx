'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Power, PowerOff } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import type { WorkCenter } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatNumber } from '@/lib/format';

const RESOURCE = '/capacity/work-centers';

interface WorkCenterStats {
  total: number;
  active: number;
  inactive: number;
  avgEfficiencyPct: number;
  avgCapacityHoursPerDay: number;
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-content-muted">{label}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight text-content">{value}</p>
      </CardContent>
    </Card>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <Label required={required}>{label}</Label>
      {children}
    </div>
  );
}

export default function WorkCentersPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const companyId = useAuthStore((s) => s.user?.companyId ?? '');

  const [showInactive, setShowInactive] = useState(false);

  const listQ = useQuery({
    queryKey: [RESOURCE, showInactive],
    queryFn: async () =>
      (await apiClient.get<WorkCenter[]>(RESOURCE, { params: { includeInactive: showInactive } })).data,
  });
  const statsQ = useQuery({
    queryKey: [`${RESOURCE}/stats`],
    queryFn: async () => (await apiClient.get<WorkCenterStats>(`${RESOURCE}/stats`)).data,
  });

  const list = listQ.data ?? [];
  const stats = statsQ.data;

  function refetch() {
    qc.invalidateQueries({ queryKey: [RESOURCE] });
    qc.invalidateQueries({ queryKey: [`${RESOURCE}/stats`] });
  }

  const create = useMutation({
    mutationFn: (payload: any) => apiClient.post(RESOURCE, payload),
    onSuccess: refetch,
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiClient.patch(`${RESOURCE}/${id}`, data),
    onSuccess: refetch,
  });

  const [open, setOpen] = useState(false);
  const [editWc, setEditWc] = useState<WorkCenter | null>(null);
  const [form, setForm] = useState({
    code: '',
    name: '',
    description: '',
    capacityHoursPerDay: '8',
    operatorsCount: '1',
    efficiencyPct: '85',
  });

  function openNew() {
    setEditWc(null);
    setForm({ code: '', name: '', description: '', capacityHoursPerDay: '8', operatorsCount: '1', efficiencyPct: '85' });
    setOpen(true);
  }
  function openEdit(w: WorkCenter) {
    setEditWc(w);
    setForm({
      code: w.code,
      name: w.name,
      description: w.description ?? '',
      capacityHoursPerDay: String(w.capacityHoursPerDay ?? 8),
      operatorsCount: String(w.operatorsCount ?? 1),
      efficiencyPct: String(w.efficiencyPct ?? 85),
    });
    setOpen(true);
  }
  function submit() {
    if (!form.code.trim() || !form.name.trim()) return toast.error('Informe código e nome');
    const base = {
      name: form.name.trim(),
      description: form.description || undefined,
      capacityHoursPerDay: Number(form.capacityHoursPerDay) || 8,
      operatorsCount: Number(form.operatorsCount) || 1,
      efficiencyPct: Number(form.efficiencyPct) || 85,
    };
    const opts = {
      onSuccess: () => {
        toast.success(editWc ? 'Centro atualizado' : 'Centro criado');
        setOpen(false);
      },
      onError: () => toast.error('Erro ao salvar centro de trabalho'),
    };
    if (editWc) {
      update.mutate({ id: editWc.id, data: base }, opts);
    } else {
      create.mutate({ companyId, code: form.code.trim().toUpperCase(), ...base }, opts);
    }
  }
  function toggleActive(w: WorkCenter) {
    const next = !w.isActive;
    confirm({
      title: next ? 'Reativar centro de trabalho?' : 'Desativar centro de trabalho?',
      description: next ? `"${w.name}" voltará a ficar ativo.` : `"${w.name}" ficará inativo (não aparece no planejamento de capacidade).`,
      confirmLabel: next ? 'Reativar' : 'Desativar',
      variant: next ? 'primary' : 'danger',
    }).then(
      (ok) =>
        ok &&
        update.mutate(
          { id: w.id, data: { isActive: next } },
          {
            onSuccess: () => toast.success(next ? 'Centro reativado' : 'Centro desativado'),
            onError: () => toast.error('Erro ao alterar status'),
          },
        ),
    );
  }

  const columns: Column<WorkCenter>[] = [
    { key: 'code', header: 'Código', sortable: true, accessor: (w) => w.code, cell: (w) => <span className="font-mono text-xs font-medium">{w.code}</span> },
    { key: 'name', header: 'Nome', cell: (w) => w.name },
    { key: 'description', header: 'Descrição', cell: (w) => w.description || '—' },
    { key: 'capacity', header: 'Capacidade (h/dia)', align: 'right', cell: (w) => formatNumber(Number(w.capacityHoursPerDay ?? 0)) },
    { key: 'operators', header: 'Operadores', align: 'right', cell: (w) => w.operatorsCount ?? 0 },
    { key: 'efficiency', header: 'Eficiência', align: 'right', cell: (w) => `${formatNumber(Number(w.efficiencyPct ?? 0))}%` },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (w) => (w.isActive ? 'Ativo' : 'Inativo'),
      cell: (w) => <Badge variant={w.isActive ? 'success' : 'neutral'}>{w.isActive ? 'Ativo' : 'Inativo'}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (w) => (
        <div className="flex items-center justify-end gap-1">
          <button onClick={() => openEdit(w)} title="Editar" className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400">
            <Pencil size={15} />
          </button>
          {w.isActive ? (
            <button onClick={() => toggleActive(w)} title="Desativar" className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-danger">
              <PowerOff size={15} />
            </button>
          ) : (
            <button onClick={() => toggleActive(w)} title="Reativar" className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-success">
              <Power size={15} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Centros de Trabalho"
        description="Recursos produtivos: capacidade, operadores e eficiência usados no planejamento de capacidade."
        actions={
          <Button onClick={openNew}>
            <Plus size={16} />
            Novo centro
          </Button>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Centros ativos" value={String(stats?.active ?? 0)} />
        <Kpi label="Inativos" value={String(stats?.inactive ?? 0)} />
        <Kpi label="Eficiência média" value={`${formatNumber(stats?.avgEfficiencyPct ?? 0)}%`} />
        <Kpi label="Capacidade média" value={`${formatNumber(stats?.avgCapacityHoursPerDay ?? 0)} h/dia`} />
      </div>

      <label className="mb-3 flex w-fit items-center gap-2 text-sm text-content-secondary">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded border-line" />
        Mostrar inativos
      </label>

      <DataTable
        data={list}
        columns={columns}
        loading={listQ.isLoading}
        searchPlaceholder="Buscar por código ou nome..."
        emptyMessage="Nenhum centro de trabalho cadastrado."
      />

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={editWc ? 'Editar centro de trabalho' : 'Novo centro de trabalho'}
        formId="wc-form"
        loading={create.isPending || update.isPending}
      >
        <form id="wc-form" onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4 py-1">
          <div className="grid grid-cols-[1fr_2fr] gap-4">
            <Field label="Código" required>
              <Input
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                className="font-mono uppercase"
                placeholder="CT-01"
                disabled={!!editWc}
              />
            </Field>
            <Field label="Nome" required>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex.: Linha de solda" />
            </Field>
          </div>
          <Field label="Descrição">
            <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Opcional" />
          </Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Capacidade (h/dia)">
              <Input type="number" min="0.5" max="24" step="0.5" value={form.capacityHoursPerDay} onChange={(e) => setForm((f) => ({ ...f, capacityHoursPerDay: e.target.value }))} />
            </Field>
            <Field label="Operadores">
              <Input type="number" min="1" value={form.operatorsCount} onChange={(e) => setForm((f) => ({ ...f, operatorsCount: e.target.value }))} />
            </Field>
            <Field label="Eficiência (%)">
              <Input type="number" min="1" max="100" value={form.efficiencyPct} onChange={(e) => setForm((f) => ({ ...f, efficiencyPct: e.target.value }))} />
            </Field>
          </div>
        </form>
      </FormDialog>
    </div>
  );
}
