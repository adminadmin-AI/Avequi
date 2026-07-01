'use client';

import { useMemo } from 'react';
import { Info } from 'lucide-react';
import { useList } from '@/hooks/use-resource';
import type { Product } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { formatNumber } from '@/lib/format';

interface StockBalance {
  id: string;
  productId: string;
  available: string;
  product?: Product | null;
}

interface MonitorRow {
  productId: string;
  sku: string;
  name: string;
  current: number;
  minStock: number;
  status: 'OK' | 'ALERTA' | 'CRITICO';
}

function classify(current: number, min: number): MonitorRow['status'] {
  if (current <= 0) return 'CRITICO';
  if (min > 0 && current < min) return 'ALERTA';
  return 'OK';
}

const STATUS_META: Record<MonitorRow['status'], { label: string; variant: any }> = {
  OK: { label: 'OK', variant: 'success' },
  ALERTA: { label: 'Alerta', variant: 'warning' },
  CRITICO: { label: 'Crítico', variant: 'danger' },
};

export default function PurchaseAutomationPage() {
  const { data: products = [], isLoading: pLoading } = useList<Product>('/products');
  const { data: balances = [], isLoading: bLoading } = useList<StockBalance>('/stock/balances');

  // Soma saldo disponível por produto (pode haver saldo em vários depósitos).
  const availableByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of balances) {
      map.set(b.productId, (map.get(b.productId) ?? 0) + Number(b.available ?? 0));
    }
    return map;
  }, [balances]);

  const rows = useMemo<MonitorRow[]>(() => {
    return products
      .filter((p) => p.isActive)
      .map((p) => {
        const current = availableByProduct.get(p.id) ?? 0;
        const minStock = Number(p.minStock ?? 0);
        return {
          productId: p.id,
          sku: p.sku,
          name: p.name,
          current,
          minStock,
          status: classify(current, minStock),
        };
      })
      // Mostra primeiro os que precisam de atenção
      .sort((a, b) => {
        const order = { CRITICO: 0, ALERTA: 1, OK: 2 };
        return order[a.status] - order[b.status];
      });
  }, [products, availableByProduct]);

  const counts = useMemo(() => {
    let critico = 0,
      alerta = 0;
    for (const r of rows) {
      if (r.status === 'CRITICO') critico += 1;
      else if (r.status === 'ALERTA') alerta += 1;
    }
    return { critico, alerta };
  }, [rows]);

  const columns: Column<MonitorRow>[] = [
    { key: 'name', header: 'Produto', cell: (r) => r.name },
    { key: 'sku', header: 'SKU', cell: (r) => <span className="font-mono text-xs">{r.sku}</span> },
    {
      key: 'current',
      header: 'Estoque atual',
      align: 'right',
      sortable: true,
      accessor: (r) => r.current,
      cell: (r) => <span className="tabular-nums">{formatNumber(r.current)}</span>,
    },
    {
      key: 'minStock',
      header: 'Estoque mínimo',
      align: 'right',
      cell: (r) => <span className="tabular-nums text-content-muted">{formatNumber(r.minStock)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (r) => r.status,
      cell: (r) => <Badge variant={STATUS_META[r.status].variant}>{STATUS_META[r.status].label}</Badge>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Automação de Compras"
        description="Monitor de estoque mínimo para reposição."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <Card className={counts.critico > 0 ? 'border-danger/30 bg-danger/10' : undefined}>
          <CardContent className="py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-content-muted">Crítico (sem estoque)</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-danger">{counts.critico}</p>
          </CardContent>
        </Card>
        <Card className={counts.alerta > 0 ? 'border-warning/30 bg-warning/10' : undefined}>
          <CardContent className="py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-content-muted">Abaixo do mínimo</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-warning">{counts.alerta}</p>
          </CardContent>
        </Card>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-surface-secondary px-3 py-2 text-xs text-content-muted">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          A <strong>geração automática de PO</strong> e a <strong>configuração por produto</strong>
          {' '}(ligar/desligar reposição automática) ainda não têm endpoint no backend
          (<code>/purchase-automation/*</code> não existe). Esta tela entrega o monitor de estoque
          mínimo; o reabastecimento por MRP fica na tela de MRP (#124).
        </span>
      </div>

      <DataTable
        data={rows}
        columns={columns}
        loading={pLoading || bLoading}
        searchPlaceholder="Buscar por produto ou SKU..."
        emptyMessage="Nenhum produto cadastrado."
      />
    </div>
  );
}
