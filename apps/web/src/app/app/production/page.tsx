'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useList } from '@/hooks/use-resource';
import { useProductOptions } from '@/hooks/use-product-customer-options';
import type { ProductionOrder, ProductionOrderStatus } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { DateRangePicker, type DateRange, dateToISO } from '@/components/ui/date-picker';
import { DataTable, type Column } from '@/components/ui/data-table';
import { StatGroup } from '@/components/ui/stat-group';
import { formatNumber, formatDate } from '@/lib/format';
import { PRODUCTION_STATUS, PRODUCTION_STATUS_OPTIONS } from './production-status';

const RESOURCE = '/production';

function shortId(id: string) {
  return id.slice(-6).toUpperCase();
}

export default function ProductionPage() {
  const router = useRouter();

  const { data: orders = [], isLoading } = useList<ProductionOrder>(RESOURCE);

  // Produto (#1028 parte 2) — filtro com busca server-side
  const [productSearch, setProductSearch] = useState('');
  const [productFilterLabel, setProductFilterLabel] = useState<string | undefined>();
  const { items: productItems, options: productOptionsRaw, isLoading: productsLoading } = useProductOptions({
    search: productSearch,
  });
  const productFilterOptions = useMemo(
    () => [{ value: '', label: 'Todos' }, ...productOptionsRaw],
    [productOptionsRaw],
  );

  const [statusFilter, setStatusFilter] = useState<'' | ProductionOrderStatus>('');
  const [productFilter, setProductFilter] = useState('');
  // Período de criação (padrão #881): um campo, calendário de 2 cliques.
  const [range, setRange] = useState<DateRange>();
  const from = dateToISO(range?.from);
  const to = dateToISO(range?.to);

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
      cell: (o) => <StatusDot variant={PRODUCTION_STATUS[o.status].variant}>{PRODUCTION_STATUS[o.status].label}</StatusDot>,
    },
    { key: 'planned', header: 'Planejada', cell: (o) => (o.scheduledStart ? formatDate(o.scheduledStart) : '—') },
    { key: 'started', header: 'Início', cell: (o) => (o.startedAt ? formatDate(o.startedAt) : '—') },
    { key: 'completed', header: 'Conclusão', cell: (o) => (o.completedAt ? formatDate(o.completedAt) : '—') },
  ];

  return (
    <div>
      <PageHeader
        title="Ordens de produção"
        description="Planejamento e acompanhamento da produção."
        actions={
          <Button onClick={() => router.push('/app/production/new')}>
            <Plus size={16} />
            Nova OP
          </Button>
        }
      />

      <StatGroup
        className="mb-6"
        stats={[
          { label: 'Em produção', value: String(kpis.inProgress) },
          { label: 'Planejadas', value: String(kpis.planned) },
          { label: 'Concluídas no mês', value: String(kpis.doneMonth) },
        ]}
      />

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
          <Combobox
            options={productFilterOptions}
            value={productFilter}
            onValueChange={(v) => {
              setProductFilter(v);
              const p = productItems.find((i) => i.id === v);
              setProductFilterLabel(p ? `${p.sku} · ${p.name}` : undefined);
            }}
            onQueryChange={setProductSearch}
            serverSideSearch
            selectedLabel={productFilterLabel}
            loading={productsLoading}
            placeholder="Todos"
            searchPlaceholder="Buscar por SKU ou nome..."
          />
        </div>
        <div>
          <Label>Criação</Label>
          <DateRangePicker
            value={range}
            onValueChange={setRange}
            clearable
            placeholder="Qualquer período"
          />
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
