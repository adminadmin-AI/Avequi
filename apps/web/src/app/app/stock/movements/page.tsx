'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type { StockMovement, MovementType, Warehouse } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { formatNumber, formatDateTime } from '@/lib/format';
import { MOVEMENT_TYPE, MOVEMENT_TYPE_OPTIONS } from './movement-meta';
import { NewMovementDialog } from './new-movement-dialog';

export default function MovementsPage() {
  const toast = useToast();
  const qc = useQueryClient();

  const { data: movements = [], isLoading } = useQuery({
    queryKey: ['/stock/movements'],
    queryFn: async () => (await apiClient.get<StockMovement[]>('/stock/movements')).data,
  });
  const { data: warehouses = [] } = useList<Warehouse>('/warehouses');

  const [typeFilter, setTypeFilter] = useState<'' | MovementType>('');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [search, setSearch] = useState('');

  const [reverseTarget, setReverseTarget] = useState<StockMovement | null>(null);
  const [reverseReason, setReverseReason] = useState('');

  const reverse = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.post(`/stock/reverse/${id}`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/stock/movements'] }),
  });

  const filtered = useMemo(() => {
    return movements.filter((m) => {
      if (typeFilter && m.type !== typeFilter) return false;
      if (warehouseFilter && m.warehouseId !== warehouseFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hit =
          (m.product?.sku ?? '').toLowerCase().includes(q) ||
          (m.product?.name ?? '').toLowerCase().includes(q) ||
          (m.reference ?? '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [movements, typeFilter, warehouseFilter, search]);

  function submitReverse() {
    if (!reverseTarget) return;
    if (reverseReason.trim().length < 3) return toast.error('Informe o motivo (mín. 3 caracteres)');
    reverse.mutate(
      { id: reverseTarget.id, reason: reverseReason },
      {
        onSuccess: () => {
          toast.success('Movimentação estornada');
          setReverseTarget(null);
          setReverseReason('');
        },
        onError: () => toast.error('Não foi possível estornar'),
      },
    );
  }

  const canReverse = (m: StockMovement) =>
    (m.type === 'ENTRY' || m.type === 'EXIT') && !m.reversedById;

  const columns: Column<StockMovement>[] = [
    { key: 'date', header: 'Data', sortable: true, accessor: (m) => m.createdAt, cell: (m) => formatDateTime(m.createdAt) },
    { key: 'sku', header: 'SKU', cell: (m) => <span className="font-mono text-xs">{m.product?.sku ?? '—'}</span> },
    { key: 'product', header: 'Produto', cell: (m) => m.product?.name ?? '—' },
    {
      key: 'type',
      header: 'Tipo',
      align: 'center',
      cell: (m) => <Badge variant={MOVEMENT_TYPE[m.type].variant}>{MOVEMENT_TYPE[m.type].label}</Badge>,
    },
    {
      key: 'quantity',
      header: 'Quantidade',
      align: 'right',
      cell: (m) => {
        const sign = MOVEMENT_TYPE[m.type].sign;
        return (
          <span className={`tabular-nums ${sign > 0 ? 'text-success' : sign < 0 ? 'text-danger' : 'text-slate-700'}`}>
            {sign > 0 ? '+' : sign < 0 ? '−' : ''} {formatNumber(Number(m.quantity))}
          </span>
        );
      },
    },
    { key: 'warehouse', header: 'Depósito', cell: (m) => m.warehouse?.code ?? m.warehouse?.name ?? '—' },
    { key: 'reference', header: 'Referência', cell: (m) => m.reference || '—' },
    { key: 'user', header: 'Usuário', cell: (m) => m.user?.name ?? '—' },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (m) =>
        canReverse(m) ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setReverseTarget(m);
              setReverseReason('');
            }}
            title="Estornar"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-danger"
          >
            <Undo2 size={15} />
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Movimentações de Estoque"
        description="Histórico de entradas, saídas e ajustes."
        actions={<NewMovementDialog />}
      />

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label>Tipo</Label>
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as '' | MovementType)}>
            <option value="">Todos</option>
            {MOVEMENT_TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
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
          <Label>Buscar</Label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="SKU, produto ou referência" />
        </div>
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        loading={isLoading}
        searchPlaceholder="Buscar..."
        emptyMessage="Nenhuma movimentação encontrada."
      />

      <FormDialog
        open={!!reverseTarget}
        onOpenChange={(o) => !o && setReverseTarget(null)}
        title="Estornar movimentação"
        description="Cria um movimento inverso (REVERSAL) que restaura o saldo."
        formId="reverse-form"
        submitLabel="Estornar"
        loading={reverse.isPending}
      >
        <form
          id="reverse-form"
          onSubmit={(e) => {
            e.preventDefault();
            submitReverse();
          }}
          className="space-y-3 py-1"
        >
          <div>
            <Label required>Motivo do estorno</Label>
            <Input value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} placeholder="Ex.: lançamento incorreto" />
          </div>
        </form>
      </FormDialog>
    </div>
  );
}
