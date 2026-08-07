'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';
import { usePagedList, useList } from '@/hooks/use-resource';
import type { ReplenishmentItem, ReplenishmentStatus, Warehouse, ProductType } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/ui/data-table';
import { StatGroup } from '@/components/ui/stat-group';
import { formatNumber } from '@/lib/format';
import { PRODUCT_TYPE_LABELS } from '@/lib/enums';

const RESOURCE = '/stock/replenishment';

const STATUS_META: Record<ReplenishmentStatus, { label: string; variant: 'success' | 'warning' | 'danger' }> = {
  BELOW_MIN: { label: 'Abaixo do mínimo', variant: 'danger' },
  AT_RISK: { label: 'Em risco', variant: 'warning' },
  OK: { label: 'OK', variant: 'success' },
};

export default function PurchaseAutomationPage() {
  // #1031 — join produto × saldo e classificação vêm prontos do servidor
  // (GET /stock/replenishment, paginado). A tela faz UMA requisição para a
  // tabela, mais uma segunda leve (pageSize=1, só para ler `total`) que dá o
  // recorte "abaixo do mínimo" do indicador. Nenhuma das duas cresce com o
  // tamanho do catálogo — é a diferença central em relação ao loop antigo.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [status, setStatus] = useState<ReplenishmentStatus | ''>('');
  const [warehouseId, setWarehouseId] = useState('');
  const [type, setType] = useState<ProductType | ''>('');

  const { data, isLoading } = usePagedList<ReplenishmentItem>(RESOURCE, {
    page,
    pageSize,
    status: status || undefined,
    warehouseId: warehouseId || undefined,
    type: type || undefined,
  });
  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  // Rótulo do 1º indicador acompanha o filtro de status ativo: sem filtro
  // (default do servidor) é "precisa de reposição" (abaixo do mínimo + em
  // risco); com filtro explícito, o indicador reflete exatamente o que a
  // tabela está mostrando.
  const totalLabel = status ? STATUS_META[status].label : 'Precisa de reposição';

  const { data: belowMinData } = usePagedList<ReplenishmentItem>(RESOURCE, {
    page: 1,
    pageSize: 1,
    status: 'BELOW_MIN',
    warehouseId: warehouseId || undefined,
    type: type || undefined,
  });
  const belowMinTotal = belowMinData?.total ?? 0;

  const { data: warehouses = [] } = useList<Warehouse>('/warehouses');

  function handleFilterChange<T>(setter: (v: T) => void, value: T) {
    setter(value);
    setPage(1); // filtro novo invalida a página atual
  }

  const columns: Column<ReplenishmentItem>[] = [
    { key: 'name', header: 'Produto', cell: (r) => r.name },
    { key: 'sku', header: 'SKU', cell: (r) => <span className="font-mono text-xs">{r.sku}</span> },
    { key: 'type', header: 'Categoria', cell: (r) => PRODUCT_TYPE_LABELS[r.type] },
    {
      key: 'available',
      header: 'Estoque atual',
      align: 'right',
      cell: (r) => <span className="tabular-nums">{formatNumber(r.available)}</span>,
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
      cell: (r) => <Badge variant={STATUS_META[r.status].variant}>{STATUS_META[r.status].label}</Badge>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Automação de compras"
        description="Monitor de estoque mínimo para reposição."
      />

      <StatGroup
        className="mb-6"
        stats={[
          {
            label: totalLabel,
            value: String(total),
            tone: total > 0 ? 'warning' : 'neutral',
          },
          {
            label: 'Abaixo do mínimo',
            value: String(belowMinTotal),
            tone: belowMinTotal > 0 ? 'danger' : 'neutral',
          },
        ]}
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-surface-secondary px-3 py-2 text-xs text-content-muted">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          A <strong>geração automática de pedidos de compra</strong> e a{' '}
          <strong>configuração por produto</strong> (ligar/desligar reposição automática) ainda não
          estão disponíveis. Esta tela mostra o monitor de estoque mínimo; o reabastecimento
          automático fica a cargo do MRP. Em breve.
        </span>
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label>Status</Label>
          <Select
            value={status}
            onChange={(e) => handleFilterChange(setStatus, e.target.value as ReplenishmentStatus | '')}
          >
            <option value="">Precisa de atenção (padrão)</option>
            <option value="BELOW_MIN">Abaixo do mínimo</option>
            <option value="AT_RISK">Em risco</option>
            <option value="OK">OK</option>
          </Select>
        </div>
        <div>
          <Label>Depósito</Label>
          <Select
            value={warehouseId}
            onChange={(e) => handleFilterChange(setWarehouseId, e.target.value)}
          >
            <option value="">Todos</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Categoria</Label>
          <Select
            value={type}
            onChange={(e) => handleFilterChange(setType, e.target.value as ProductType | '')}
          >
            <option value="">Todas</option>
            {Object.entries(PRODUCT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <DataTable
        data={rows}
        columns={columns}
        loading={isLoading}
        searchable={false}
        emptyMessage="Nenhum produto encontrado para os filtros selecionados."
        serverMode
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(v) => handleFilterChange(setPageSize, v)}
      />
    </div>
  );
}
