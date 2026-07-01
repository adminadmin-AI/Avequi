'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useList } from '@/hooks/use-resource';
import type { SalesOrder, SalesOrderStatus, Customer } from '@/types/api';
import { Plus, LayoutList, Trello } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { SalesKanban } from './sales-kanban';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/ui/data-table';
import { formatBRL, formatDate } from '@/lib/format';
import { SALES_STATUS, SALES_STATUS_OPTIONS, salesOrderTotal } from './sales-status';

const RESOURCE = '/sales';
const OPEN_STATUSES: SalesOrderStatus[] = [
  'DRAFT',
  'CREDIT_HOLD',
  'RESERVED',
  'CONFIRMED',
  'AWAITING_PICKING',
  'READY_TO_INVOICE',
];

function shortId(id: string) {
  return id.slice(-6).toUpperCase();
}

function Kpi({ label, value, count }: { label: string; value: string; count?: number }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-content-muted">{label}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight text-content">{value}</p>
        {count != null && <p className="mt-0.5 text-xs text-content-muted">{count} OVs</p>}
      </CardContent>
    </Card>
  );
}

export default function SalesPage() {
  const router = useRouter();

  const { data: orders = [], isLoading } = useList<SalesOrder>(RESOURCE);
  const { data: customers = [] } = useList<Customer>('/customers');

  const [view, setView] = useState<'table' | 'kanban'>('table');
  const [statusFilter, setStatusFilter] = useState<'' | SalesOrderStatus>('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // ── KPIs ──
  const kpis = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    let openCount = 0;
    let confirmedValue = 0;
    let invoicedMonth = 0;

    for (const o of orders) {
      const total = salesOrderTotal(o);
      if (OPEN_STATUSES.includes(o.status)) openCount += 1;
      if (o.status === 'CONFIRMED') confirmedValue += total;
      if (o.status === 'INVOICED' && o.invoicedAt && new Date(o.invoicedAt) >= monthStart) {
        invoicedMonth += total;
      }
    }
    return { openCount, confirmedValue, invoicedMonth };
  }, [orders]);

  // ── Filtros (client-side) ──
  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter && o.status !== statusFilter) return false;
      if (customerFilter && o.customerId !== customerFilter) return false;
      if (from && o.createdAt < from) return false;
      if (to && o.createdAt > to + 'T23:59:59') return false;
      return true;
    });
  }, [orders, statusFilter, customerFilter, from, to]);

  const columns: Column<SalesOrder>[] = [
    {
      key: 'number',
      header: 'Nº interno',
      cell: (o) => <span className="font-mono text-xs font-medium">#{shortId(o.id)}</span>,
    },
    { key: 'customer', header: 'Cliente', cell: (o) => o.customer?.name ?? <span className="text-content-muted">—</span> },
    {
      key: 'total',
      header: 'Valor total',
      align: 'right',
      sortable: true,
      accessor: (o) => salesOrderTotal(o),
      cell: (o) => <span className="font-medium tabular-nums">{formatBRL(salesOrderTotal(o))}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (o) => o.status,
      cell: (o) => {
        const m = SALES_STATUS[o.status];
        return <Badge variant={m.variant}>{m.label}</Badge>;
      },
    },
    {
      key: 'createdAt',
      header: 'Criação',
      sortable: true,
      accessor: (o) => o.createdAt,
      cell: (o) => formatDate(o.createdAt),
    },
    {
      key: 'confirmedAt',
      header: 'Confirmação',
      cell: (o) => (o.confirmedAt ? formatDate(o.confirmedAt) : <span className="text-content-muted">—</span>),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Ordens de Venda"
        description="Pipeline comercial — do rascunho ao faturamento."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-line bg-surface p-0.5">
              <button
                onClick={() => setView('table')}
                title="Tabela"
                className={cn(
                  'rounded-md p-1.5 transition-colors',
                  view === 'table' ? 'bg-brand-600 text-white' : 'text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800',
                )}
              >
                <LayoutList size={16} />
              </button>
              <button
                onClick={() => setView('kanban')}
                title="Kanban"
                className={cn(
                  'rounded-md p-1.5 transition-colors',
                  view === 'kanban' ? 'bg-brand-600 text-white' : 'text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800',
                )}
              >
                <Trello size={16} />
              </button>
            </div>
            <Button onClick={() => router.push('/app/sales/new')}>
              <Plus size={16} />
              Nova venda
            </Button>
          </div>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Kpi label="OVs abertas" value={String(kpis.openCount)} />
        <Kpi label="Em OVs confirmadas" value={formatBRL(kpis.confirmedValue)} />
        <Kpi label="Faturado no mês" value={formatBRL(kpis.invoicedMonth)} />
      </div>

      {view === 'kanban' ? (
        <SalesKanban orders={filtered} />
      ) : (
      <>
      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>Status</Label>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | SalesOrderStatus)}>
            <option value="">Todos</option>
            {SALES_STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Cliente</Label>
          <Select value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
            <option value="">Todos</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
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
        onRowClick={(o) => router.push(`/app/sales/${o.id}`)}
        searchPlaceholder="Buscar por cliente..."
        emptyMessage="Nenhuma ordem de venda encontrada."
      />
      </>
      )}
    </div>
  );
}
