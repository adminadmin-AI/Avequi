'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { PackageCheck, Hand } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { FormDialog } from '@/components/ui/form-dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';

interface WmsLocation {
  id: string;
  warehouseId: string;
  code: string;
  isActive: boolean;
}
interface TaskProduct {
  id: string;
  sku: string;
  name: string;
}
interface WmsTask {
  id: string;
  status: string;
  qty: string;
  product?: TaskProduct | null;
  location?: { id: string; code: string } | null;
}
interface WmsOrder {
  id: string;
  status: string;
  warehouseId?: string;
  warehouse?: { id: string; code: string; name: string } | null;
  tasks?: WmsTask[];
}

type FlatTask = WmsTask & { orderId: string; warehouseId?: string };

function isPending(status: string) {
  return status === 'PENDING' || status === 'IN_PROGRESS';
}

function Tabs({ tab, setTab }: { tab: string; setTab: (t: string) => void }) {
  const items = [
    { id: 'putaway', label: 'Putaway (Entrada)' },
    { id: 'pick', label: 'Pick (Saída)' },
  ];
  return (
    <div className="mb-5 flex gap-1 border-b border-line">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => setTab(it.id)}
          className={cn(
            'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
            tab === it.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-content-muted hover:text-content-secondary',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Busca a lista de ordens + detalhes (tasks) e achata as tarefas pendentes. */
function useFlatTasks(kind: 'receiving' | 'picking') {
  const ordersQ = useQuery({
    queryKey: [`/wms/${kind}`],
    queryFn: async () => (await apiClient.get<WmsOrder[]>(`/wms/${kind}`)).data,
  });
  const orders = ordersQ.data ?? [];
  const openOrders = orders.filter((o) => isPending(o.status));

  const detailQs = useQueries({
    queries: openOrders.map((o) => ({
      queryKey: [`/wms/${kind}`, o.id, 'detail'],
      queryFn: async () => (await apiClient.get<WmsOrder>(`/wms/${kind}/${o.id}`)).data,
    })),
  });

  const tasks: FlatTask[] = [];
  for (const q of detailQs) {
    const o = q.data;
    if (!o?.tasks) continue;
    for (const t of o.tasks) {
      if (isPending(t.status)) tasks.push({ ...t, orderId: o.id, warehouseId: o.warehouseId ?? o.warehouse?.id });
    }
  }
  const loading = ordersQ.isLoading || detailQs.some((q) => q.isLoading);
  return { tasks, loading };
}

export default function WmsTasksPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState('putaway');

  const { data: locations = [] } = useList<WmsLocation>('/wms/locations');

  const putaway = useFlatTasks('receiving');
  const pick = useFlatTasks('picking');

  // Confirmação de putaway (exige localização)
  const [confirmTask, setConfirmTask] = useState<FlatTask | null>(null);
  const [locationId, setLocationId] = useState('');

  const confirmPutaway = useMutation({
    mutationFn: ({ orderId, taskId, locationId }: { orderId: string; taskId: string; locationId: string }) =>
      apiClient.patch(`/wms/receiving/${orderId}/tasks/${taskId}/putaway`, { locationId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/wms/receiving'] }),
  });
  const confirmPick = useMutation({
    mutationFn: ({ orderId, taskId }: { orderId: string; taskId: string }) =>
      apiClient.patch(`/wms/picking/${orderId}/tasks/${taskId}/confirm`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/wms/picking'] }),
  });

  function submitPutaway() {
    if (!confirmTask) return;
    if (!locationId) return toast.error('Selecione a localização');
    confirmPutaway.mutate(
      { orderId: confirmTask.orderId, taskId: confirmTask.id, locationId },
      {
        onSuccess: () => {
          toast.success('Putaway confirmado');
          setConfirmTask(null);
          setLocationId('');
        },
        onError: () => toast.error('Não foi possível confirmar'),
      },
    );
  }

  function doConfirmPick(t: FlatTask) {
    confirmPick.mutate(
      { orderId: t.orderId, taskId: t.id },
      {
        onSuccess: () => toast.success('Pick confirmado'),
        onError: () => toast.error('Não foi possível confirmar'),
      },
    );
  }

  const locsForWarehouse = useMemo(
    () => locations.filter((l) => l.isActive && (!confirmTask?.warehouseId || l.warehouseId === confirmTask.warehouseId)),
    [locations, confirmTask],
  );

  const active = tab === 'putaway' ? putaway : pick;

  return (
    <div>
      <PageHeader title="Tarefas WMS" description="Alocação (putaway) e separação (pick) pendentes." />

      <Tabs tab={tab} setTab={setTab} />

      {active.loading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : active.tasks.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface py-16 text-center text-sm text-content-muted">
          Nenhuma tarefa pendente.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-content-muted">
                <th className="px-4 py-2.5 text-left font-medium">Produto</th>
                <th className="px-4 py-2.5 text-right font-medium">Quantidade</th>
                <th className="px-4 py-2.5 text-left font-medium">Localização {tab === 'putaway' ? 'sugerida' : 'origem'}</th>
                <th className="px-4 py-2.5 text-center font-medium">Status</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {active.tasks.map((t) => (
                <tr key={t.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <p className="text-content">{t.product?.name ?? '—'}</p>
                    <p className="font-mono text-xs text-content-muted">{t.product?.sku}</p>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(Number(t.qty))}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{t.location?.code ?? '—'}</td>
                  <td className="px-4 py-2.5 text-center">
                    <Badge variant="warning">Pendente</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {tab === 'putaway' ? (
                      <button
                        onClick={() => {
                          setConfirmTask(t);
                          setLocationId(t.location?.id ?? '');
                        }}
                        title="Confirmar localização"
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-brand-600 hover:bg-brand-50"
                      >
                        <PackageCheck size={14} /> Confirmar
                      </button>
                    ) : (
                      <button
                        onClick={() => doConfirmPick(t)}
                        title="Confirmar pick"
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-brand-600 hover:bg-brand-50"
                      >
                        <Hand size={14} /> Confirmar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <FormDialog
        open={!!confirmTask}
        onOpenChange={(o) => !o && setConfirmTask(null)}
        title="Confirmar localização (putaway)"
        description={confirmTask?.product?.name ?? ''}
        formId="putaway-form"
        submitLabel="Confirmar"
        loading={confirmPutaway.isPending}
      >
        <form
          id="putaway-form"
          onSubmit={(e) => {
            e.preventDefault();
            submitPutaway();
          }}
          className="space-y-3 py-1"
        >
          <div>
            <Label required>Localização real</Label>
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">— Selecione —</option>
              {locsForWarehouse.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code}
                </option>
              ))}
            </Select>
          </div>
        </form>
      </FormDialog>
    </div>
  );
}
