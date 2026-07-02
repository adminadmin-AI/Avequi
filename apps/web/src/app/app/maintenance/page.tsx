'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Play, Check, X, Pencil, PowerOff, Info, LayoutList, CalendarDays } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { useList } from '@/hooks/use-resource';
import type {
  Equipment,
  EquipmentStatus,
  MaintenanceOrder,
  MaintenanceOrderStatus,
  MaintenanceType,
  User,
} from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { formatDate, formatBRL } from '@/lib/format';
import { MaintenanceCalendar } from './maintenance-calendar';
import {
  EQUIPMENT_STATUS,
  MAINTENANCE_ORDER_STATUS,
  MAINTENANCE_TYPE,
  shortId,
} from './maintenance-meta';

const ORDERS = '/maintenance/orders';
const EQUIPMENT = '/maintenance/equipment';

interface MaintenanceStats {
  equipment: { total: number; active: number; underMaintenance: number };
  orders: { open: number; inProgress: number; doneThisMonth: number };
  overdueCount: number;
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-content-muted">{label}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight text-content">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-content-muted">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function Tabs({ tab, setTab }: { tab: string; setTab: (t: string) => void }) {
  const items = [
    { id: 'orders', label: 'Ordens de Manutenção' },
    { id: 'equipment', label: 'Equipamentos' },
  ];
  return (
    <div className="mb-5 flex gap-1 border-b border-line">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => setTab(it.id)}
          className={cn(
            'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
            tab === it.id ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300' : 'border-transparent text-content-muted hover:text-content-secondary',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
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

export default function MaintenancePage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const companyId = useAuthStore((s) => s.user?.companyId ?? '');
  const [tab, setTab] = useState('orders');

  // ── Dados ──
  const ordersQ = useQuery({
    queryKey: [ORDERS],
    queryFn: async () => (await apiClient.get<MaintenanceOrder[]>(ORDERS)).data,
  });
  const equipmentQ = useQuery({
    queryKey: [EQUIPMENT],
    queryFn: async () => (await apiClient.get<Equipment[]>(EQUIPMENT)).data,
  });
  const statsQ = useQuery({
    queryKey: [`${EQUIPMENT}/stats`],
    queryFn: async () => (await apiClient.get<MaintenanceStats>(`${EQUIPMENT}/stats`)).data,
  });
  const { data: users = [] } = useList<User>('/users');

  const orders = ordersQ.data ?? [];
  const equipment = equipmentQ.data ?? [];
  const techName = (id?: string | null) => users.find((u) => u.id === id)?.name ?? '—';

  function refetchAll() {
    qc.invalidateQueries({ queryKey: [ORDERS] });
    qc.invalidateQueries({ queryKey: [EQUIPMENT] });
    qc.invalidateQueries({ queryKey: [`${EQUIPMENT}/stats`] });
  }

  // ── Mutations OM ──
  const createOrder = useMutation({
    mutationFn: (payload: any) => apiClient.post(ORDERS, payload),
    onSuccess: refetchAll,
  });
  const orderAction = useMutation({
    mutationFn: ({ id, endpoint, body }: { id: string; endpoint: string; body?: any }) =>
      apiClient.patch(`${ORDERS}/${id}/${endpoint}`, body ?? {}),
    onSuccess: refetchAll,
  });

  // ── Visualização e detalhe (#134) ──
  const [view, setView] = useState<'table' | 'calendar'>('table');
  const [selected, setSelected] = useState<MaintenanceOrder | null>(null);

  // ── Filtros OM ──
  const [statusFilter, setStatusFilter] = useState<'' | MaintenanceOrderStatus>('');
  const [typeFilter, setTypeFilter] = useState<'' | MaintenanceType>('');
  const [equipFilter, setEquipFilter] = useState('');
  const [techFilter, setTechFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter && o.status !== statusFilter) return false;
      if (typeFilter && o.type !== typeFilter) return false;
      if (equipFilter && o.equipmentId !== equipFilter) return false;
      if (techFilter && o.technicianId !== techFilter) return false;
      const ref = o.scheduledAt ?? o.createdAt;
      if (from && ref < from) return false;
      if (to && ref > to + 'T23:59:59') return false;
      return true;
    });
  }, [orders, statusFilter, typeFilter, equipFilter, techFilter, from, to]);

  // ── Nova OM ──
  const [omOpen, setOmOpen] = useState(false);
  const [omForm, setOmForm] = useState({
    equipmentId: '',
    type: 'PREVENTIVE' as MaintenanceType,
    title: '',
    description: '',
    scheduledAt: '',
    technicianId: '',
  });
  function openNewOm() {
    setOmForm({ equipmentId: '', type: 'PREVENTIVE', title: '', description: '', scheduledAt: '', technicianId: '' });
    setOmOpen(true);
  }
  function submitOm() {
    if (!omForm.equipmentId) return toast.error('Selecione o equipamento');
    if (!omForm.title.trim()) return toast.error('Informe o título da OM');
    createOrder.mutate(
      {
        companyId,
        equipmentId: omForm.equipmentId,
        type: omForm.type,
        title: omForm.title.trim(),
        description: omForm.description || undefined,
        scheduledAt: omForm.scheduledAt ? new Date(omForm.scheduledAt).toISOString() : undefined,
        technicianId: omForm.technicianId || undefined,
      },
      {
        onSuccess: () => {
          toast.success('Ordem de manutenção criada');
          setOmOpen(false);
        },
        onError: () => toast.error('Erro ao criar ordem de manutenção'),
      },
    );
  }

  // ── Concluir OM ──
  const [completeTarget, setCompleteTarget] = useState<MaintenanceOrder | null>(null);
  const [resolution, setResolution] = useState('');
  const [cost, setCost] = useState('');
  function submitComplete() {
    if (!completeTarget) return;
    if (resolution.trim().length < 3) return toast.error('Descreva o serviço realizado');
    orderAction.mutate(
      {
        id: completeTarget.id,
        endpoint: 'complete',
        body: { resolution: resolution.trim(), cost: cost ? Number(cost) : undefined },
      },
      {
        onSuccess: () => {
          toast.success('Ordem concluída');
          setCompleteTarget(null);
          setResolution('');
          setCost('');
        },
        onError: () => toast.error('Não foi possível concluir a ordem'),
      },
    );
  }
  function startOrder(o: MaintenanceOrder) {
    confirm({ title: 'Iniciar manutenção?', description: `O equipamento ficará "Em manutenção".`, confirmLabel: 'Iniciar' }).then(
      (ok) =>
        ok &&
        orderAction.mutate(
          { id: o.id, endpoint: 'start' },
          { onSuccess: () => toast.success('Ordem iniciada'), onError: () => toast.error('Erro ao iniciar') },
        ),
    );
  }
  function cancelOrder(o: MaintenanceOrder) {
    confirm({ title: 'Cancelar ordem?', description: `A OM #${shortId(o.id)} será cancelada.`, confirmLabel: 'Cancelar OM', variant: 'danger' }).then(
      (ok) =>
        ok &&
        orderAction.mutate(
          { id: o.id, endpoint: 'cancel' },
          { onSuccess: () => toast.success('Ordem cancelada'), onError: () => toast.error('Erro ao cancelar') },
        ),
    );
  }

  const orderColumns: Column<MaintenanceOrder>[] = [
    { key: 'number', header: 'Nº OM', cell: (o) => <span className="font-mono text-xs font-medium">#{shortId(o.id)}</span> },
    {
      key: 'equipment',
      header: 'Equipamento',
      cell: (o) => (o.equipment ? `${o.equipment.code} — ${o.equipment.name}` : '—'),
    },
    { key: 'title', header: 'Descrição', cell: (o) => o.title },
    {
      key: 'type',
      header: 'Tipo',
      align: 'center',
      cell: (o) => <Badge variant={MAINTENANCE_TYPE[o.type].variant}>{MAINTENANCE_TYPE[o.type].label}</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (o) => o.status,
      cell: (o) => <Badge variant={MAINTENANCE_ORDER_STATUS[o.status].variant}>{MAINTENANCE_ORDER_STATUS[o.status].label}</Badge>,
    },
    { key: 'technician', header: 'Técnico', cell: (o) => o.technician?.name ?? techName(o.technicianId) },
    { key: 'scheduledAt', header: 'Data prevista', sortable: true, accessor: (o) => o.scheduledAt ?? '', cell: (o) => (o.scheduledAt ? formatDate(o.scheduledAt) : '—') },
    { key: 'completedAt', header: 'Conclusão', cell: (o) => (o.completedAt ? formatDate(o.completedAt) : '—') },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (o) => (
        <div className="flex items-center justify-end gap-1">
          {o.status === 'OPEN' && (
            <>
              <button onClick={() => startOrder(o)} title="Iniciar" className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400">
                <Play size={15} />
              </button>
              <button onClick={() => cancelOrder(o)} title="Cancelar" className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-danger">
                <X size={15} />
              </button>
            </>
          )}
          {o.status === 'IN_PROGRESS' && (
            <>
              <button onClick={() => { setCompleteTarget(o); setResolution(''); setCost(''); }} title="Concluir" className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-success">
                <Check size={15} />
              </button>
              <button onClick={() => cancelOrder(o)} title="Cancelar" className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-danger">
                <X size={15} />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  // ── Equipamentos ──
  const createEquipment = useMutation({
    mutationFn: (payload: any) => apiClient.post(EQUIPMENT, payload),
    onSuccess: refetchAll,
  });
  const updateEquipment = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiClient.patch(`${EQUIPMENT}/${id}`, data),
    onSuccess: refetchAll,
  });
  const deactivateEquipment = useMutation({
    mutationFn: (id: string) => apiClient.patch(`${EQUIPMENT}/${id}/deactivate`, {}),
    onSuccess: refetchAll,
  });

  const [eqOpen, setEqOpen] = useState(false);
  const [editEq, setEditEq] = useState<Equipment | null>(null);
  const [eqForm, setEqForm] = useState({
    code: '',
    name: '',
    description: '',
    location: '',
    maintenanceIntervalDays: '30',
    nextMaintenanceAt: '',
    status: 'ACTIVE' as EquipmentStatus,
  });
  function openNewEq() {
    setEditEq(null);
    setEqForm({ code: '', name: '', description: '', location: '', maintenanceIntervalDays: '30', nextMaintenanceAt: '', status: 'ACTIVE' });
    setEqOpen(true);
  }
  function openEditEq(e: Equipment) {
    setEditEq(e);
    setEqForm({
      code: e.code,
      name: e.name,
      description: e.description ?? '',
      location: e.location ?? '',
      maintenanceIntervalDays: String(e.maintenanceIntervalDays ?? 30),
      nextMaintenanceAt: e.nextMaintenanceAt ? e.nextMaintenanceAt.slice(0, 10) : '',
      status: e.status,
    });
    setEqOpen(true);
  }
  function submitEq() {
    if (!eqForm.name.trim()) return toast.error('Informe o nome do equipamento');
    if (!editEq && !eqForm.code.trim()) return toast.error('Informe o código');
    const interval = Number(eqForm.maintenanceIntervalDays) || 30;
    const nextAt = eqForm.nextMaintenanceAt ? new Date(eqForm.nextMaintenanceAt).toISOString() : undefined;
    const opts = {
      onSuccess: () => {
        toast.success(editEq ? 'Equipamento atualizado' : 'Equipamento cadastrado');
        setEqOpen(false);
      },
      onError: () => toast.error('Erro ao salvar equipamento'),
    };
    if (editEq) {
      updateEquipment.mutate(
        {
          id: editEq.id,
          data: {
            name: eqForm.name.trim(),
            description: eqForm.description || undefined,
            location: eqForm.location || undefined,
            status: eqForm.status,
            maintenanceIntervalDays: interval,
            ...(nextAt ? { nextMaintenanceAt: nextAt } : {}),
          },
        },
        opts,
      );
    } else {
      createEquipment.mutate(
        {
          companyId,
          code: eqForm.code.trim().toUpperCase(),
          name: eqForm.name.trim(),
          description: eqForm.description || undefined,
          location: eqForm.location || undefined,
          maintenanceIntervalDays: interval,
          ...(nextAt ? { nextMaintenanceAt: nextAt } : {}),
        },
        opts,
      );
    }
  }
  function deactivateEq(e: Equipment) {
    confirm({ title: 'Desativar equipamento?', description: `"${e.name}" ficará inativo.`, confirmLabel: 'Desativar', variant: 'danger' }).then(
      (ok) =>
        ok &&
        deactivateEquipment.mutate(e.id, { onSuccess: () => toast.success('Equipamento desativado'), onError: () => toast.error('Erro ao desativar') }),
    );
  }

  const equipColumns: Column<Equipment>[] = [
    { key: 'code', header: 'Código', cell: (e) => <span className="font-mono text-xs font-medium">{e.code}</span> },
    { key: 'name', header: 'Nome', cell: (e) => e.name },
    { key: 'location', header: 'Local', cell: (e) => e.location || '—' },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (e) => e.status,
      cell: (e) => <Badge variant={EQUIPMENT_STATUS[e.status].variant}>{EQUIPMENT_STATUS[e.status].label}</Badge>,
    },
    {
      key: 'nextMaintenanceAt',
      header: 'Próxima manut.',
      sortable: true,
      accessor: (e) => e.nextMaintenanceAt ?? '',
      cell: (e) => {
        if (!e.nextMaintenanceAt) return '—';
        const overdue = e.status === 'ACTIVE' && new Date(e.nextMaintenanceAt) < new Date();
        return <span className={overdue ? 'font-medium text-danger' : ''}>{formatDate(e.nextMaintenanceAt)}</span>;
      },
    },
    { key: 'interval', header: 'Intervalo', align: 'right', cell: (e) => `${e.maintenanceIntervalDays}d` },
    { key: 'orders', header: 'OMs', align: 'right', cell: (e) => e._count?.maintenanceOrders ?? 0 },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (e) => (
        <div className="flex items-center justify-end gap-1">
          <button onClick={() => openEditEq(e)} title="Editar" className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400">
            <Pencil size={15} />
          </button>
          {e.status !== 'INACTIVE' && (
            <button onClick={() => deactivateEq(e)} title="Desativar" className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-danger">
              <PowerOff size={15} />
            </button>
          )}
        </div>
      ),
    },
  ];

  const stats = statsQ.data;

  return (
    <div>
      <PageHeader
        title="Manutenção"
        description="Ordens de manutenção preventiva e corretiva, e cadastro de equipamentos."
        actions={
          tab === 'orders' ? (
            <Button onClick={openNewOm} disabled={equipment.length === 0}>
              <Plus size={16} />
              Nova OM
            </Button>
          ) : (
            <Button onClick={openNewEq}>
              <Plus size={16} />
              Novo equipamento
            </Button>
          )
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Abertas" value={String(stats?.orders.open ?? 0)} />
        <Kpi label="Em andamento" value={String(stats?.orders.inProgress ?? 0)} />
        <Kpi label="Concluídas no mês" value={String(stats?.orders.doneThisMonth ?? 0)} />
        <Kpi
          label="Equip. em manutenção"
          value={String(stats?.equipment.underMaintenance ?? 0)}
          hint={stats?.overdueCount ? `${stats.overdueCount} com manutenção vencida` : undefined}
        />
      </div>

      <Tabs tab={tab} setTab={setTab} />

      {tab === 'orders' ? (
        <>
          {equipment.length === 0 && !equipmentQ.isLoading && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              <Info size={14} className="mt-0.5 shrink-0" />
              <span>
                Cadastre ao menos um <strong>equipamento</strong> (aba Equipamentos) antes de abrir uma ordem de manutenção.
              </span>
            </div>
          )}

          <div className="mb-3 flex items-center justify-end">
            <div className="inline-flex rounded-lg border border-line p-0.5">
              <button
                onClick={() => setView('table')}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  view === 'table' ? 'bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-300' : 'text-content-muted hover:text-content-secondary',
                )}
              >
                <LayoutList size={15} /> Tabela
              </button>
              <button
                onClick={() => setView('calendar')}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  view === 'calendar' ? 'bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-300' : 'text-content-muted hover:text-content-secondary',
                )}
              >
                <CalendarDays size={15} /> Calendário
              </button>
            </div>
          </div>

          <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <div>
              <Label>Status</Label>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | MaintenanceOrderStatus)}>
                <option value="">Todos</option>
                {(Object.keys(MAINTENANCE_ORDER_STATUS) as MaintenanceOrderStatus[]).map((s) => (
                  <option key={s} value={s}>{MAINTENANCE_ORDER_STATUS[s].label}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as '' | MaintenanceType)}>
                <option value="">Todos</option>
                {(Object.keys(MAINTENANCE_TYPE) as MaintenanceType[]).map((t) => (
                  <option key={t} value={t}>{MAINTENANCE_TYPE[t].label}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Equipamento</Label>
              <Select value={equipFilter} onChange={(e) => setEquipFilter(e.target.value)}>
                <option value="">Todos</option>
                {equipment.map((e) => (
                  <option key={e.id} value={e.id}>{e.code} — {e.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Técnico</Label>
              <Select value={techFilter} onChange={(e) => setTechFilter(e.target.value)}>
                <option value="">Todos</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>De</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label>Até</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>

          {view === 'table' ? (
            <DataTable
              data={filteredOrders}
              columns={orderColumns}
              loading={ordersQ.isLoading}
              searchPlaceholder="Buscar por descrição..."
              emptyMessage="Nenhuma ordem de manutenção encontrada."
            />
          ) : (
            <MaintenanceCalendar orders={filteredOrders} onSelect={(o) => setSelected(o)} />
          )}
        </>
      ) : (
        <DataTable
          data={equipment}
          columns={equipColumns}
          loading={equipmentQ.isLoading}
          searchPlaceholder="Buscar equipamento..."
          emptyMessage="Nenhum equipamento cadastrado."
        />
      )}

      {/* Nova OM */}
      <FormDialog open={omOpen} onOpenChange={setOmOpen} title="Nova ordem de manutenção" formId="om-form" loading={createOrder.isPending}>
        <form id="om-form" onSubmit={(e) => { e.preventDefault(); submitOm(); }} className="space-y-4 py-1">
          <Field label="Equipamento" required>
            <Select value={omForm.equipmentId} onChange={(e) => setOmForm((f) => ({ ...f, equipmentId: e.target.value }))}>
              <option value="">— Selecione —</option>
              {equipment.map((e) => (
                <option key={e.id} value={e.id}>{e.code} — {e.name}</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Tipo">
              <Select value={omForm.type} onChange={(e) => setOmForm((f) => ({ ...f, type: e.target.value as MaintenanceType }))}>
                {(Object.keys(MAINTENANCE_TYPE) as MaintenanceType[]).map((t) => (
                  <option key={t} value={t}>{MAINTENANCE_TYPE[t].label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Data prevista">
              <Input type="date" value={omForm.scheduledAt} onChange={(e) => setOmForm((f) => ({ ...f, scheduledAt: e.target.value }))} />
            </Field>
          </div>
          <Field label="Título" required>
            <Input value={omForm.title} onChange={(e) => setOmForm((f) => ({ ...f, title: e.target.value }))} placeholder="Ex.: Troca de rolamentos" />
          </Field>
          <Field label="Descrição">
            <Input value={omForm.description} onChange={(e) => setOmForm((f) => ({ ...f, description: e.target.value }))} placeholder="Detalhes do serviço (opcional)" />
          </Field>
          <Field label="Técnico responsável">
            <Select value={omForm.technicianId} onChange={(e) => setOmForm((f) => ({ ...f, technicianId: e.target.value }))}>
              <option value="">— Não atribuído —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </Select>
          </Field>
          <p className="text-xs text-content-muted">
            Manutenção <strong>corretiva</strong> coloca o equipamento em manutenção imediatamente.
          </p>
        </form>
      </FormDialog>

      {/* Concluir OM */}
      <FormDialog
        open={!!completeTarget}
        onOpenChange={(o) => !o && setCompleteTarget(null)}
        title="Concluir ordem de manutenção"
        description="Registre o serviço realizado. O equipamento volta a ficar ativo e a próxima manutenção é reagendada."
        formId="complete-form"
        submitLabel="Concluir"
        loading={orderAction.isPending}
      >
        <form id="complete-form" onSubmit={(e) => { e.preventDefault(); submitComplete(); }} className="space-y-4 py-1">
          <Field label="Serviço realizado" required>
            <Input value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Descreva o que foi feito" />
          </Field>
          <Field label="Custo (R$)">
            <Input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Opcional" />
          </Field>
        </form>
      </FormDialog>

      {/* Equipamento */}
      <FormDialog
        open={eqOpen}
        onOpenChange={setEqOpen}
        title={editEq ? 'Editar equipamento' : 'Novo equipamento'}
        formId="eq-form"
        loading={createEquipment.isPending || updateEquipment.isPending}
      >
        <form id="eq-form" onSubmit={(e) => { e.preventDefault(); submitEq(); }} className="space-y-4 py-1">
          <div className="grid grid-cols-[1fr_2fr] gap-4">
            <Field label="Código" required>
              <Input
                value={eqForm.code}
                onChange={(e) => setEqForm((f) => ({ ...f, code: e.target.value }))}
                className="font-mono uppercase"
                placeholder="EQ-01"
                disabled={!!editEq}
              />
            </Field>
            <Field label="Nome" required>
              <Input value={eqForm.name} onChange={(e) => setEqForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex.: Prensa hidráulica" />
            </Field>
          </div>
          <Field label="Local">
            <Input value={eqForm.location} onChange={(e) => setEqForm((f) => ({ ...f, location: e.target.value }))} placeholder="Ex.: Setor de corte" />
          </Field>
          <Field label="Descrição">
            <Input value={eqForm.description} onChange={(e) => setEqForm((f) => ({ ...f, description: e.target.value }))} placeholder="Opcional" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Intervalo de manutenção (dias)">
              <Input type="number" min="1" value={eqForm.maintenanceIntervalDays} onChange={(e) => setEqForm((f) => ({ ...f, maintenanceIntervalDays: e.target.value }))} />
            </Field>
            <Field label="Próxima manutenção">
              <Input type="date" value={eqForm.nextMaintenanceAt} onChange={(e) => setEqForm((f) => ({ ...f, nextMaintenanceAt: e.target.value }))} />
            </Field>
          </div>
          {editEq && (
            <Field label="Status">
              <Select value={eqForm.status} onChange={(e) => setEqForm((f) => ({ ...f, status: e.target.value as EquipmentStatus }))}>
                {(Object.keys(EQUIPMENT_STATUS) as EquipmentStatus[]).map((s) => (
                  <option key={s} value={s}>{EQUIPMENT_STATUS[s].label}</option>
                ))}
              </Select>
            </Field>
          )}
        </form>
      </FormDialog>

      {/* Detalhe da OM (clique no calendário) */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>OM #{shortId(selected.id)}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 px-6 pb-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant={MAINTENANCE_TYPE[selected.type].variant}>{MAINTENANCE_TYPE[selected.type].label}</Badge>
                  <Badge variant={MAINTENANCE_ORDER_STATUS[selected.status].variant}>{MAINTENANCE_ORDER_STATUS[selected.status].label}</Badge>
                </div>
                <p className="text-base font-medium text-content">{selected.title}</p>
                {selected.description && <p className="text-content-secondary">{selected.description}</p>}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-content-secondary">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-content-muted">Equipamento</dt>
                    <dd>{selected.equipment ? `${selected.equipment.code} — ${selected.equipment.name}` : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-content-muted">Técnico</dt>
                    <dd>{selected.technician?.name ?? techName(selected.technicianId)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-content-muted">Data prevista</dt>
                    <dd>{selected.scheduledAt ? formatDate(selected.scheduledAt) : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-content-muted">Conclusão</dt>
                    <dd>{selected.completedAt ? formatDate(selected.completedAt) : '—'}</dd>
                  </div>
                  {selected.resolution && (
                    <div className="col-span-2">
                      <dt className="text-xs uppercase tracking-wide text-content-muted">Serviço realizado</dt>
                      <dd>{selected.resolution}{selected.cost ? ` · ${formatBRL(selected.cost)}` : ''}</dd>
                    </div>
                  )}
                </dl>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
                {selected.status === 'OPEN' && (
                  <>
                    <Button variant="secondary" onClick={() => { const o = selected; setSelected(null); cancelOrder(o); }}>Cancelar OM</Button>
                    <Button onClick={() => { const o = selected; setSelected(null); startOrder(o); }}>
                      <Play size={15} /> Iniciar
                    </Button>
                  </>
                )}
                {selected.status === 'IN_PROGRESS' && (
                  <>
                    <Button variant="secondary" onClick={() => { const o = selected; setSelected(null); cancelOrder(o); }}>Cancelar OM</Button>
                    <Button onClick={() => { const o = selected; setSelected(null); setCompleteTarget(o); setResolution(''); setCost(''); }}>
                      <Check size={15} /> Concluir
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
