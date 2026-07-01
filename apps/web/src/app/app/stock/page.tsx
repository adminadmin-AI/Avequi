'use client';

import { useMemo, useState } from 'react';
import { useList } from '@/hooks/use-resource';
import type { StockBalance, Warehouse } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/ui/data-table';
import { cn } from '@/lib/utils';
import { formatBRL, formatNumber } from '@/lib/format';

function num(v: string | null | undefined) {
  return v ? Number(v) : 0;
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

export default function StockPage() {
  const { data: balances = [], isLoading } = useList<StockBalance>('/stock/balances');
  const { data: warehouses = [] } = useList<Warehouse>('/warehouses');

  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [search, setSearch] = useState('');
  const [belowMin, setBelowMin] = useState(false);

  const isBelowMin = (b: StockBalance) => {
    const min = num(b.product?.minStock);
    return min > 0 && num(b.available) < min;
  };

  const kpis = useMemo(() => {
    const skus = new Set<string>();
    let value = 0;
    let below = 0;
    for (const b of balances) {
      skus.add(b.productId);
      value += num(b.available) * num(b.product?.avgCost);
      if (isBelowMin(b)) below += 1;
    }
    return { skus: skus.size, value, below };
  }, [balances]);

  const filtered = useMemo(() => {
    return balances.filter((b) => {
      if (warehouseFilter && b.warehouseId !== warehouseFilter) return false;
      if (belowMin && !isBelowMin(b)) return false;
      if (search) {
        const q = search.toLowerCase();
        const hit = (b.product?.sku ?? '').toLowerCase().includes(q) || (b.product?.name ?? '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [balances, warehouseFilter, belowMin, search]);

  const columns: Column<StockBalance>[] = [
    { key: 'sku', header: 'SKU', cell: (b) => <span className="font-mono text-xs">{b.product?.sku ?? '—'}</span> },
    { key: 'product', header: 'Produto', cell: (b) => b.product?.name ?? '—' },
    { key: 'warehouse', header: 'Depósito', cell: (b) => b.warehouse?.code ?? b.warehouse?.name ?? '—' },
    {
      key: 'available',
      header: 'Disponível',
      align: 'right',
      sortable: true,
      accessor: (b) => num(b.available),
      cell: (b) => (
        <span className={cn('tabular-nums', isBelowMin(b) && 'font-medium text-danger')}>
          {formatNumber(num(b.available))}
        </span>
      ),
    },
    { key: 'reserved', header: 'Reservado', align: 'right', cell: (b) => <span className="tabular-nums text-content-muted">{formatNumber(num(b.reserved))}</span> },
    { key: 'inTransit', header: 'Em trânsito', align: 'right', cell: (b) => <span className="tabular-nums text-content-muted">{formatNumber(num(b.inTransit))}</span> },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      sortable: true,
      accessor: (b) => num(b.available) + num(b.reserved) + num(b.inTransit),
      cell: (b) => <span className="font-medium tabular-nums">{formatNumber(num(b.available) + num(b.reserved) + num(b.inTransit))}</span>,
    },
  ];

  return (
    <div>
      <PageHeader title="Saldos de Estoque" description="Posição de estoque por produto e depósito." />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Kpi label="SKUs em estoque" value={String(kpis.skus)} />
        <Kpi label="Valor do estoque" value={formatBRL(kpis.value)} />
        <Kpi label="Abaixo do mínimo" value={String(kpis.below)} />
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label>Depósito</Label>
          <Select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)}>
            <option value="">Todos</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Produto</Label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="SKU ou nome" />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 pb-2 text-sm text-content-secondary">
            <input type="checkbox" checked={belowMin} onChange={(e) => setBelowMin(e.target.checked)} />
            Somente abaixo do mínimo
          </label>
        </div>
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        loading={isLoading}
        searchPlaceholder="Buscar..."
        emptyMessage="Nenhum saldo de estoque encontrado."
      />
    </div>
  );
}
