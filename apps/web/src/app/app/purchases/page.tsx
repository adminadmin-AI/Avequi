'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useList } from '@/hooks/use-resource';
import type { PurchaseOrder, PurchaseOrderStatus, Supplier } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/ui/data-table';
import { formatBRL, formatDate } from '@/lib/format';
import { PO_STATUS, PO_STATUS_OPTIONS, purchaseOrderTotal } from './purchase-status';

const RESOURCE = '/purchases/orders';

function shortId(id: string) {
  return id.slice(-6).toUpperCase();
}

function Kpi({ label, value, count }: { label: string; value: string; count?: number }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-content-muted">{label}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight text-content">{value}</p>
        {count != null && <p className="mt-0.5 text-xs text-content-muted">{count} POs</p>}
      </CardContent>
    </Card>
  );
}

export default function PurchasesPage() {
  const router = useRouter();

  const { data: orders = [], isLoading } = useList<PurchaseOrder>(RESOURCE);
  const { data: suppliers = [] } = useList<Supplier>('/suppliers');

  const [statusFilter, setStatusFilter] = useState<'' | PurchaseOrderStatus>('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const kpis = useMemo(() => {
    let draftCount = 0;
    let openValue = 0;
    let receivedCount = 0;
    for (const o of orders) {
      const total = purchaseOrderTotal(o);
      if (o.status === 'DRAFT') draftCount += 1;
      if (o.status === 'APPROVED' || o.status === 'PARTIALLY_RECEIVED') openValue += total;
      if (o.status === 'RECEIVED') receivedCount += 1;
    }
    return { draftCount, openValue, receivedCount };
  }, [orders]);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter && o.status !== statusFilter) return false;
      if (supplierFilter && o.supplierId !== supplierFilter) return false;
      if (from && o.createdAt < from) return false;
      if (to && o.createdAt > to + 'T23:59:59') return false;
      return true;
    });
  }, [orders, statusFilter, supplierFilter, from, to]);

  const columns: Column<PurchaseOrder>[] = [
    { key: 'number', header: 'Nº PO', cell: (o) => <span className="font-mono text-xs font-medium">#{shortId(o.id)}</span> },
    { key: 'supplier', header: 'Fornecedor', cell: (o) => o.supplier?.name ?? <span className="text-content-muted">—</span> },
    {
      key: 'total',
      header: 'Valor total',
      align: 'right',
      sortable: true,
      accessor: (o) => purchaseOrderTotal(o),
      cell: (o) => <span className="font-medium tabular-nums">{formatBRL(purchaseOrderTotal(o))}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (o) => o.status,
      cell: (o) => <Badge variant={PO_STATUS[o.status].variant}>{PO_STATUS[o.status].label}</Badge>,
    },
    { key: 'createdAt', header: 'Criação', sortable: true, accessor: (o) => o.createdAt, cell: (o) => formatDate(o.createdAt) },
    {
      key: 'expectedAt',
      header: 'Prevista',
      cell: (o) => (o.expectedAt ? formatDate(o.expectedAt) : <span className="text-content-muted">—</span>),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Pedidos de Compra"
        description="Ordens de compra a fornecedores — do rascunho ao recebimento."
        actions={
          <Button onClick={() => router.push('/app/purchases/new')}>
            <Plus size={16} />
            Nova PO
          </Button>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Kpi label="Em rascunho" value={String(kpis.draftCount)} />
        <Kpi label="Em aberto (aprovadas)" value={formatBRL(kpis.openValue)} />
        <Kpi label="Recebidas" value={String(kpis.receivedCount)} />
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>Status</Label>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | PurchaseOrderStatus)}>
            <option value="">Todos</option>
            {PO_STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Fornecedor</Label>
          <Select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
            <option value="">Todos</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
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
        onRowClick={(o) => router.push(`/app/purchases/${o.id}`)}
        searchPlaceholder="Buscar por fornecedor..."
        emptyMessage="Nenhum pedido de compra encontrado."
      />
    </div>
  );
}
