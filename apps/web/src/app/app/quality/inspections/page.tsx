'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Play, Check, X, PauseCircle, Info } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
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
import { INSPECTION_STATUS, INSPECTION_TYPE, type InspectionStatus, type InspectionType } from '../quality-meta';

const RESOURCE = '/quality/inspections';

interface Inspection {
  id: string;
  type: InspectionType;
  status: InspectionStatus;
  notes?: string | null;
  goodsReceiptId?: string | null;
  productionOrderId?: string | null;
  createdAt: string;
}

function shortId(id: string) {
  return id.slice(-6).toUpperCase();
}

export default function InspectionsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const companyId = useAuthStore((s) => s.user?.companyId ?? '');

  const { data: list = [], isLoading } = useQuery({
    queryKey: [RESOURCE],
    queryFn: async () => (await apiClient.get<Inspection[]>(RESOURCE)).data,
  });

  const [statusFilter, setStatusFilter] = useState<'' | InspectionStatus>('');
  const [typeFilter, setTypeFilter] = useState<'' | InspectionType>('');

  // Nova inspeção
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<InspectionType>('RECEIVING');
  const [notes, setNotes] = useState('');

  // Reprovar (cria NCR)
  const [failTarget, setFailTarget] = useState<Inspection | null>(null);
  const [failTitle, setFailTitle] = useState('');
  const [failDesc, setFailDesc] = useState('');

  const create = useMutation({
    mutationFn: (payload: any) => apiClient.post(RESOURCE, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: [RESOURCE] }),
  });
  const action = useMutation({
    mutationFn: ({ id, endpoint, body }: { id: string; endpoint: string; body?: any }) =>
      apiClient.patch(`${RESOURCE}/${id}/${endpoint}`, body ?? {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: [RESOURCE] }),
  });

  const filtered = useMemo(
    () => list.filter((i) => (!statusFilter || i.status === statusFilter) && (!typeFilter || i.type === typeFilter)),
    [list, statusFilter, typeFilter],
  );

  function submitCreate() {
    create.mutate(
      { companyId, type, notes: notes || undefined },
      {
        onSuccess: () => {
          toast.success('Inspeção criada');
          setOpen(false);
          setNotes('');
        },
        onError: () => toast.error('Erro ao criar inspeção'),
      },
    );
  }
  function simple(i: Inspection, endpoint: 'start' | 'pass' | 'hold') {
    const labels: Record<string, string> = { start: 'Iniciar inspeção?', pass: 'Aprovar inspeção?', hold: 'Colocar em espera?' };
    confirm({ title: labels[endpoint], confirmLabel: 'Confirmar' }).then(
      (ok) => ok && action.mutate({ id: i.id, endpoint }, { onSuccess: () => toast.success('Status atualizado'), onError: () => toast.error('Erro') }),
    );
  }
  function submitFail() {
    if (!failTarget) return;
    if (failDesc.trim().length < 3) return toast.error('Descreva a não conformidade');
    action.mutate(
      { id: failTarget.id, endpoint: 'fail', body: { title: failTitle || 'Reprovação de inspeção', description: failDesc, severity: 'MAJOR' } },
      {
        onSuccess: () => {
          toast.success('Inspeção reprovada — NCR aberta');
          setFailTarget(null);
          setFailTitle('');
          setFailDesc('');
        },
        onError: () => toast.error('Não foi possível reprovar'),
      },
    );
  }

  const columns: Column<Inspection>[] = [
    { key: 'number', header: 'Nº', cell: (i) => <span className="font-mono text-xs font-medium">#{shortId(i.id)}</span> },
    { key: 'type', header: 'Tipo', cell: (i) => INSPECTION_TYPE[i.type] },
    {
      key: 'origin',
      header: 'Origem',
      cell: (i) => (i.goodsReceiptId ? 'Recebimento' : i.productionOrderId ? 'Produção' : '—'),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (i) => i.status,
      cell: (i) => <Badge variant={INSPECTION_STATUS[i.status].variant}>{INSPECTION_STATUS[i.status].label}</Badge>,
    },
    { key: 'createdAt', header: 'Data', sortable: true, accessor: (i) => i.createdAt, cell: (i) => formatDate(i.createdAt) },
    { key: 'notes', header: 'Observações', cell: (i) => i.notes || '—' },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (i) => (
        <div className="flex items-center justify-end gap-1">
          {i.status === 'PENDING' && (
            <button onClick={() => simple(i, 'start')} title="Iniciar" className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400">
              <Play size={15} />
            </button>
          )}
          {i.status === 'IN_PROGRESS' && (
            <>
              <button onClick={() => simple(i, 'pass')} title="Aprovar" className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-success">
                <Check size={15} />
              </button>
              <button onClick={() => { setFailTarget(i); setFailTitle(''); setFailDesc(''); }} title="Reprovar (abre NCR)" className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-danger">
                <X size={15} />
              </button>
              <button onClick={() => simple(i, 'hold')} title="Em espera" className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-warning">
                <PauseCircle size={15} />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Inspeções de Qualidade"
        description="Controle de inspeções de recebimento, processo e final."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} />
            Nova inspeção
          </Button>
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-surface-secondary px-3 py-2 text-xs text-content-muted">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          A inspeção é vinculada a Recebimento ou Produção (não há produto/lote/nota direto no modelo).
          Reprovar uma inspeção <strong>abre automaticamente uma NCR</strong>.
        </span>
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label>Status</Label>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | InspectionStatus)}>
            <option value="">Todos</option>
            {(Object.keys(INSPECTION_STATUS) as InspectionStatus[]).map((s) => (
              <option key={s} value={s}>{INSPECTION_STATUS[s].label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Tipo</Label>
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as '' | InspectionType)}>
            <option value="">Todos</option>
            {(Object.keys(INSPECTION_TYPE) as InspectionType[]).map((t) => (
              <option key={t} value={t}>{INSPECTION_TYPE[t]}</option>
            ))}
          </Select>
        </div>
      </div>

      <DataTable data={filtered} columns={columns} loading={isLoading} searchPlaceholder="Buscar..." emptyMessage="Nenhuma inspeção encontrada." />

      {/* Nova inspeção */}
      <FormDialog open={open} onOpenChange={setOpen} title="Nova inspeção" formId="insp-form" loading={create.isPending}>
        <form id="insp-form" onSubmit={(e) => { e.preventDefault(); submitCreate(); }} className="space-y-4 py-1">
          <div>
            <Label required>Tipo</Label>
            <Select value={type} onChange={(e) => setType(e.target.value as InspectionType)}>
              {(Object.keys(INSPECTION_TYPE) as InspectionType[]).map((t) => (
                <option key={t} value={t}>{INSPECTION_TYPE[t]}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Observações</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
          </div>
        </form>
      </FormDialog>

      {/* Reprovar (NCR) */}
      <FormDialog
        open={!!failTarget}
        onOpenChange={(o) => !o && setFailTarget(null)}
        title="Reprovar inspeção"
        description="A reprovação abre uma não conformidade (NCR)."
        formId="fail-form"
        submitLabel="Reprovar e abrir NCR"
        loading={action.isPending}
      >
        <form id="fail-form" onSubmit={(e) => { e.preventDefault(); submitFail(); }} className="space-y-3 py-1">
          <div>
            <Label>Título da NCR</Label>
            <Input value={failTitle} onChange={(e) => setFailTitle(e.target.value)} placeholder="Ex.: Dimensional fora de tolerância" />
          </div>
          <div>
            <Label required>Descrição da não conformidade</Label>
            <Input value={failDesc} onChange={(e) => setFailDesc(e.target.value)} placeholder="Descreva o problema" />
          </div>
        </form>
      </FormDialog>
    </div>
  );
}
