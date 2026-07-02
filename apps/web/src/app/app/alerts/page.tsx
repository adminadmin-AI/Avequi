'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, RefreshCw } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import {
  ALERT_SEVERITY,
  ALERT_TYPE_LABEL,
  alertLink,
  type Alert,
  type AlertSeverity,
  type AlertType,
} from './alert-meta';

function Kpi({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'warning' | 'danger' }) {
  const cls = { neutral: 'text-content', warning: 'text-warning', danger: 'text-danger' }[tone];
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-content-muted">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tracking-tight ${cls}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

export default function AlertsPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const [tab, setTab] = useState<'active' | 'resolved'>('active');
  const [typeFilter, setTypeFilter] = useState<'' | AlertType>('');

  const resolved = tab === 'resolved';
  const listQ = useQuery({
    queryKey: ['/alerts/all', resolved],
    queryFn: async () =>
      (await apiClient.get<Alert[]>('/alerts/all', { params: { resolved } })).data,
  });

  const list = listQ.data ?? [];
  const filtered = useMemo(
    () => list.filter((a) => !typeFilter || a.type === typeFilter),
    [list, typeFilter],
  );

  const kpis = useMemo(() => {
    if (resolved) return null;
    let critical = 0,
      warning = 0;
    for (const a of list) {
      if (a.severity === 'CRITICAL') critical += 1;
      else if (a.severity === 'WARNING') warning += 1;
    }
    return { total: list.length, critical, warning };
  }, [list, resolved]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['/alerts/all'] });
    qc.invalidateQueries({ queryKey: ['/alerts/active-count'] });
  }

  const resolve = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/alerts/${id}/resolve`, {}),
    onSuccess: invalidate,
  });
  const runCheck = useMutation({
    mutationFn: () => apiClient.post('/alerts/check', {}),
    onSuccess: invalidate,
  });

  function handleResolve(a: Alert) {
    confirm({ title: 'Marcar como visto?', description: 'O alerta sairá da lista de ativos.', confirmLabel: 'Marcar' }).then(
      (ok) =>
        ok &&
        resolve.mutate(a.id, {
          onSuccess: () => toast.success('Alerta resolvido'),
          onError: () => toast.error('Erro ao resolver alerta'),
        }),
    );
  }
  function handleRunCheck() {
    runCheck.mutate(undefined, {
      onSuccess: () => toast.success('Verificação executada'),
      onError: () => toast.error('Não foi possível rodar a verificação'),
    });
  }

  const columns: Column<Alert>[] = [
    {
      key: 'type',
      header: 'Tipo',
      cell: (a) => <span className="font-medium text-content-secondary">{ALERT_TYPE_LABEL[a.type] ?? a.type}</span>,
    },
    {
      key: 'description',
      header: 'Descrição',
      cell: (a) => (
        <div>
          <p className="text-content">{a.title}</p>
          {a.body && <p className="text-xs text-content-muted">{a.body}</p>}
        </div>
      ),
    },
    {
      key: 'severity',
      header: 'Severidade',
      align: 'center',
      sortable: true,
      accessor: (a) => a.severity,
      cell: (a) => <Badge variant={ALERT_SEVERITY[a.severity].variant}>{ALERT_SEVERITY[a.severity].label}</Badge>,
    },
    { key: 'createdAt', header: 'Data', sortable: true, accessor: (a) => a.createdAt, cell: (a) => formatDateTime(a.createdAt) },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      cell: (a) => (a.resolvedAt ? <Badge variant="neutral">Visto</Badge> : <Badge variant="success">Ativo</Badge>),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (a) => {
        const link = alertLink(a);
        return (
          <div className="flex items-center justify-end gap-1">
            {link && (
              <button onClick={() => router.push(link)} title="Ver item relacionado" className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400">
                <ExternalLink size={15} />
              </button>
            )}
            {!a.resolvedAt && (
              <button onClick={() => handleResolve(a)} title="Marcar como visto" className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-success">
                <Check size={15} />
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
        title="Central de Alertas"
        description="Avisos operacionais de estoque, financeiro, produção e fiscal."
        actions={
          <Button variant="secondary" onClick={handleRunCheck} loading={runCheck.isPending}>
            <RefreshCw size={15} /> Rodar verificação
          </Button>
        }
      />

      {kpis && (
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <Kpi label="Ativos" value={String(kpis.total)} />
          <Kpi label="Críticos" value={String(kpis.critical)} tone={kpis.critical > 0 ? 'danger' : 'neutral'} />
          <Kpi label="Avisos" value={String(kpis.warning)} tone={kpis.warning > 0 ? 'warning' : 'neutral'} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-1 border-b border-line">
          {([['active', 'Ativos'], ['resolved', 'Resolvidos']] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                tab === id ? 'border-brand-600 text-brand-700 dark:text-brand-300' : 'border-transparent text-content-muted hover:text-content-secondary',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="w-56">
          <Label>Tipo</Label>
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as '' | AlertType)}>
            <option value="">Todos</option>
            {(Object.keys(ALERT_TYPE_LABEL) as AlertType[]).map((t) => (
              <option key={t} value={t}>{ALERT_TYPE_LABEL[t]}</option>
            ))}
          </Select>
        </div>
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        loading={listQ.isLoading}
        searchPlaceholder="Buscar alerta..."
        emptyMessage={resolved ? 'Nenhum alerta resolvido.' : 'Nenhum alerta ativo. Tudo em ordem! 🎉'}
      />
    </div>
  );
}
