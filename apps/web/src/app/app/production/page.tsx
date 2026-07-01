'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useList } from '@/hooks/use-resource';
import type { ProductionOrder, ProductionOrderStatus, Product } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/ui/data-table';
import { formatNumber, formatDate } from '@/lib/format';
import { PRODUCTION_STATUS, PRODUCTION_STATUS_OPTIONS } from './production-status';

const RESOURCE = '/production';

function shortId(id: string) {
  return id.slice(-6).toUpperCase();
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

export default function ProductionPage() {
  const router = useRouter();

  const { data: orders = [], isLoading } = useList<ProductionOrder>(RESOURCE);
  const { data: products = [] } = useList<Product>('/products');

  const [statusFilter, setStatusFilter] = useState<'' | ProductionOrderStatus>('');
  const [productFilter, setProductFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const kpis = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    let inProgress = 0,
      planned = 0,
      doneMonth = 0;
    for (const o of orders) {
      if (o.status === 'IN_PROGRESS') inProgress += 1;
      if (o.status === 'DRAFT') planned += 1;
      if (o.status === 'DONE' && o.completedAt && new Date(o.completedAt) >= monthStart) doneMonth += 1;
    }
    return { inProgress, planned, doneMonth };
  }, [orders]);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter && o.status !== statusFilter) return false;
      if (productFilter && o.productId !== productFilter) return false;
      if (from && o.createdAt < from) return false;
      if (to && o.createdAt > to + 'T23:59:59') return false;
      return true;
    });
  }, [orders, statusFilter, productFilter, from, to]);

  const columns: Column<ProductionOrder>[] = [
    { key: 'number', header: 'Nº OP', cell: (o) => <span className="font-mono text-xs font-medium">#{shortId(o.id)}</span> },
    { key: 'product', header: 'Produto', cell: (o) => o.product?.name ?? '—' },
    {
      key: 'qty',
      header: 'Quantidade',
      align: 'right',
      sortable: true,
      accessor: (o) => Number(o.plannedQty),
      cell: (o) => (
        <span className="tabular-nums">
          {formatNumber(Number(o.producedQty))}/{formatNumber(Number(o.plannedQty))}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (o) => o.status,
      cell: (o) => <Badge variant={PRODUCTION_STATUS[o.status].variant}>{PRODUCTION_STATUS[o.status].label}</Badge>,
    },
    { key: 'planned', header: 'Planejada', cell: (o) => (o.scheduledStart ? formatDate(o.scheduledStart) : '—') },
    { key: 'started', header: 'Início', cell: (o) => (o.startedAt ? formatDate(o.startedAt) : '—') },
    { key: 'completed', header: 'Conclusão', cell: (o) => (o.completedAt ? formatDate(o.completedAt) : '—') },
  ];

  return (
    <div>
      <PageHeader
        title="Ordens de Produção"
        description="Planejamento e acompanhamento da produção."
        actions={
          <Button onClick={() => router.push('/app/production/new')}>
            <Plus size={16} />
            Nova OP
          </Button>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Kpi label="Em produção" value={String(kpis.inProgress)} />
        <Kpi label="Planejadas" value={String(kpis.planned)} />
        <Kpi label="Concluídas no mês" value={String(kpis.doneMonth)} />
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>Status</Label>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | ProductionOrderStatus)}>
            <option value="">Todos</option>
            {PRODUCTION_STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Produto</Label>
          <Select value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
            <option value="">Todos</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} — {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Criação de</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label>Criação até</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        loading={isLoading}
        onRowClick={(o) => router.push(`/app/production/${o.id}`)}
        searchPlaceholder="Buscar por produto..."
        emptyMessage="Nenhuma ordem de produção encontrada."
      />
    </div>
  );
}
