'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Wrench, CheckCircle2, Ban, Pencil, Info } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { useList } from '@/hooks/use-resource';
import type { User } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatDate } from '@/lib/format';
import { NCR_STATUS, NCR_SEVERITY, type NcrStatus, type NcrSeverity } from '../quality-meta';

const RESOURCE = '/quality/ncr';

interface Ncr {
  id: string;
  title: string;
  description: string;
  severity: NcrSeverity;
  status: NcrStatus;
  rootCause?: string | null;
  correctiveAction?: string | null;
  responsible?: { id: string; name: string } | null;
  createdAt: string;
}

function shortId(id: string) {
  return id.slice(-6).toUpperCase();
}

export default function NcrPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const companyId = useAuthStore((s) => s.user?.companyId ?? '');

  const { data: list = [], isLoading } = useQuery({
    queryKey: [RESOURCE],
    queryFn: async () => (await apiClient.get<Ncr[]>(RESOURCE)).data,
  });
  const { data: users = [] } = useList<User>('/users');

  const [severityFilter, setSeverityFilter] = useState<'' | NcrSeverity>('');
  const [statusFilter, setStatusFilter] = useState<'' | NcrStatus>('');

  // Nova NCR
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', severity: 'MAJOR' as NcrSeverity, responsibleId: '' });

  // Editar (causa raiz / ação corretiva)
  const [editTarget, setEditTarget] = useState<Ncr | null>(null);
  const [editForm, setEditForm] = useState({ rootCause: '', correctiveAction: '' });

  const create = useMutation({
    mutationFn: (payload: any) => apiClient.post(RESOURCE, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: [RESOURCE] }),
  });
  const action = useMutation({
    mutationFn: ({ id, endpoint }: { id: string; endpoint: string }) => apiClient.patch(`${RESOURCE}/${id}/${endpoint}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: [RESOURCE] }),
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiClient.patch(`${RESOURCE}/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [RESOURCE] }),
  });

  const filtered = useMemo(
    () => list.filter((n) => (!severityFilter || n.severity === severityFilter) && (!statusFilter || n.status === statusFilter)),
    [list, severityFilter, statusFilter],
  );

  function submitCreate() {
    if (!form.title.trim()) return toast.error('Informe o título');
    if (form.description.trim().length < 3) return toast.error('Descreva a não conformidade');
    create.mutate(
      { companyId, title: form.title, description: form.description, severity: form.severity, responsibleId: form.responsibleId || undefined },
      {
        onSuccess: () => {
          toast.success('NCR aberta');
          setOpen(false);
          setForm({ title: '', description: '', severity: 'MAJOR', responsibleId: '' });
        },
        onError: () => toast.error('Erro ao abrir NCR'),
      },
    );
  }
  function lifecycle(n: Ncr, endpoint: 'analyze' | 'corrective-action' | 'close' | 'cancel') {
    const labels: Record<string, string> = {
      analyze: 'Iniciar análise?',
      'corrective-action': 'Marcar ação corretiva?',
      close: 'Fechar NCR?',
      cancel: 'Cancelar NCR?',
    };
    confirm({ title: labels[endpoint], confirmLabel: 'Confirmar', variant: endpoint === 'cancel' ? 'danger' : 'primary' }).then(
      (ok) => ok && action.mutate({ id: n.id, endpoint }, { onSuccess: () => toast.success('Status atualizado'), onError: () => toast.error('Erro') }),
    );
  }
  function submitEdit() {
    if (!editTarget) return;
    update.mutate(
      { id: editTarget.id, data: { rootCause: editForm.rootCause || undefined, correctiveAction: editForm.correctiveAction || undefined } },
      {
        onSuccess: () => {
          toast.success('NCR atualizada');
          setEditTarget(null);
        },
        onError: () => toast.error('Erro ao atualizar'),
      },
    );
  }

  const columns: Column<Ncr>[] = [
    { key: 'number', header: 'Nº', cell: (n) => <span className="font-mono text-xs font-medium">#{shortId(n.id)}</span> },
    { key: 'title', header: 'Título', cell: (n) => <div><p className="text-slate-800">{n.title}</p><p className="truncate text-xs text-slate-400">{n.description}</p></div> },
    { key: 'severity', header: 'Severidade', align: 'center', cell: (n) => <Badge variant={NCR_SEVERITY[n.severity].variant}>{NCR_SEVERITY[n.severity].label}</Badge> },
    { key: 'status', header: 'Status', align: 'center', sortable: true, accessor: (n) => n.status, cell: (n) => <Badge variant={NCR_STATUS[n.status].variant}>{NCR_STATUS[n.status].label}</Badge> },
    { key: 'responsible', header: 'Responsável', cell: (n) => n.responsible?.name ?? '—' },
    { key: 'createdAt', header: 'Abertura', sortable: true, accessor: (n) => n.createdAt, cell: (n) => formatDate(n.createdAt) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (n) => {
        const closedOrCancelled = n.status === 'CLOSED' || n.status === 'CANCELLED';
        return (
          <div className="flex items-center justify-end gap-1">
            {!closedOrCancelled && (
              <button onClick={() => { setEditTarget(n); setEditForm({ rootCause: n.rootCause ?? '', correctiveAction: n.correctiveAction ?? '' }); }} title="Editar causa/ação" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600">
                <Pencil size={15} />
              </button>
            )}
            {n.status === 'OPEN' && (
              <button onClick={() => lifecycle(n, 'analyze')} title="Analisar" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-warning">
                <Search size={15} />
              </button>
            )}
            {n.status === 'UNDER_ANALYSIS' && (
              <button onClick={() => lifecycle(n, 'corrective-action')} title="Ação corretiva" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600">
                <Wrench size={15} />
              </button>
            )}
            {n.status === 'CORRECTIVE_ACTION' && (
              <button onClick={() => lifecycle(n, 'close')} title="Fechar" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-success">
                <CheckCircle2 size={15} />
              </button>
            )}
            {!closedOrCancelled && (
              <button onClick={() => lifecycle(n, 'cancel')} title="Cancelar" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-danger">
                <Ban size={15} />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Não Conformidades (NCR)"
        description="Registro e tratamento de não conformidades."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} />
            Nova NCR
          </Button>
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          Ciclo: Aberta → Em análise → Ação corretiva → Fechada (ou Cancelada). Causa raiz e ação
          corretiva são registradas na edição. O backend não tem "reabrir" — uma NCR fechada é final.
        </span>
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label>Severidade</Label>
          <Select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as '' | NcrSeverity)}>
            <option value="">Todas</option>
            {(Object.keys(NCR_SEVERITY) as NcrSeverity[]).map((s) => (
              <option key={s} value={s}>{NCR_SEVERITY[s].label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Status</Label>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | NcrStatus)}>
            <option value="">Todos</option>
            {(Object.keys(NCR_STATUS) as NcrStatus[]).map((s) => (
              <option key={s} value={s}>{NCR_STATUS[s].label}</option>
            ))}
          </Select>
        </div>
      </div>

      <DataTable data={filtered} columns={columns} loading={isLoading} searchPlaceholder="Buscar..." emptyMessage="Nenhuma NCR encontrada." />

      {/* Nova NCR */}
      <FormDialog open={open} onOpenChange={setOpen} title="Nova não conformidade" formId="ncr-form" loading={create.isPending}>
        <form id="ncr-form" onSubmit={(e) => { e.preventDefault(); submitCreate(); }} className="space-y-4 py-1">
          <div>
            <Label required>Título</Label>
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Resumo da não conformidade" />
          </div>
          <div>
            <Label required>Descrição</Label>
            <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Detalhe o problema" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label required>Severidade</Label>
              <Select value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value as NcrSeverity }))}>
                {(Object.keys(NCR_SEVERITY) as NcrSeverity[]).map((s) => (
                  <option key={s} value={s}>{NCR_SEVERITY[s].label}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Responsável</Label>
              <Select value={form.responsibleId} onChange={(e) => setForm((f) => ({ ...f, responsibleId: e.target.value }))}>
                <option value="">— Nenhum —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </Select>
            </div>
          </div>
        </form>
      </FormDialog>

      {/* Editar causa/ação */}
      <FormDialog
        open={!!editTarget}
        onOpenChange={(o) => !o && setEditTarget(null)}
        title="Causa raiz e ação corretiva"
        formId="ncr-edit-form"
        loading={update.isPending}
      >
        <form id="ncr-edit-form" onSubmit={(e) => { e.preventDefault(); submitEdit(); }} className="space-y-3 py-1">
          <div>
            <Label>Causa raiz</Label>
            <Input value={editForm.rootCause} onChange={(e) => setEditForm((f) => ({ ...f, rootCause: e.target.value }))} placeholder="Ex.: ferramenta desgastada" />
          </div>
          <div>
            <Label>Ação corretiva</Label>
            <Input value={editForm.correctiveAction} onChange={(e) => setEditForm((f) => ({ ...f, correctiveAction: e.target.value }))} placeholder="Ex.: substituição e recalibração" />
          </div>
        </form>
      </FormDialog>
    </div>
  );
}
