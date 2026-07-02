'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Play, ShoppingCart, Factory, Info } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { useToast } from '@/components/ui/toast';
import { formatNumber, formatDateTime } from '@/lib/format';

interface MrpRun {
  id: string;
  horizonDays: number;
  status: string;
  createdAt: string;
}
interface MrpSuggestion {
  id: string;
  type: 'PURCHASE' | 'PRODUCTION';
  status: 'PENDING' | 'CONVERTED' | 'DISMISSED';
  grossQty: string;
  stockOnHand: string;
  netQty: string;
  product?: { id: string; sku: string; name: string } | null;
}
interface RunDetail extends MrpRun {
  suggestions?: MrpSuggestion[];
}

export default function MrpPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [runId, setRunId] = useState<string | null>(null);

  const runsQ = useQuery({
    queryKey: ['/mrp/runs'],
    queryFn: async () => (await apiClient.get<MrpRun[]>('/mrp/runs')).data,
  });

  // Seleciona automaticamente a rodada mais recente.
  useEffect(() => {
    if (!runId && runsQ.data && runsQ.data.length > 0) setRunId(runsQ.data[0].id);
  }, [runsQ.data, runId]);

  const detailQ = useQuery({
    queryKey: ['/mrp/runs', runId],
    queryFn: async () => (await apiClient.get<RunDetail>(`/mrp/runs/${runId}`)).data,
    enabled: !!runId,
  });

  const run = useMutation({
    mutationFn: () => apiClient.post<{ runId: string }>('/mrp/run', {}),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['/mrp/runs'] });
      setRunId(res.data.runId);
    },
  });
  const convert = useMutation({
    mutationFn: (id: string) => apiClient.post(`/mrp/suggestions/${id}/convert`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/mrp/runs', runId] });
    },
  });

  function calcMrp() {
    run.mutate(undefined, {
      onSuccess: () => toast.success('MRP calculado'),
      onError: () => toast.error('Falha ao calcular MRP'),
    });
  }
  function doConvert(s: MrpSuggestion) {
    convert.mutate(s.id, {
      onSuccess: () => toast.success(s.type === 'PURCHASE' ? 'PO gerada da sugestão' : 'OP gerada da sugestão'),
      onError: () => toast.error('Não foi possível converter'),
    });
  }

  const suggestions = detailQ.data?.suggestions ?? [];

  const columns: Column<MrpSuggestion>[] = [
    { key: 'sku', header: 'SKU', cell: (s) => <span className="font-mono text-xs">{s.product?.sku ?? '—'}</span> },
    { key: 'product', header: 'Produto', cell: (s) => s.product?.name ?? '—' },
    { key: 'gross', header: 'Necessidade bruta', align: 'right', cell: (s) => <span className="tabular-nums">{formatNumber(Number(s.grossQty))}</span> },
    { key: 'onHand', header: 'Em estoque', align: 'right', cell: (s) => <span className="tabular-nums text-content-muted">{formatNumber(Number(s.stockOnHand))}</span> },
    {
      key: 'net',
      header: 'Necessidade líquida',
      align: 'right',
      sortable: true,
      accessor: (s) => Number(s.netQty),
      cell: (s) => <span className="font-medium tabular-nums">{formatNumber(Number(s.netQty))}</span>,
    },
    {
      key: 'suggestion',
      header: 'Sugestão',
      cell: (s) => (
        <span className="inline-flex items-center gap-1.5 text-sm">
          {s.type === 'PURCHASE' ? <ShoppingCart size={14} className="text-info" /> : <Factory size={14} className="text-brand-600 dark:text-brand-400" />}
          {s.type === 'PURCHASE' ? 'Comprar' : 'Produzir'} {formatNumber(Number(s.netQty))}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (s) =>
        s.status === 'CONVERTED' ? (
          <Badge variant="success">Convertida</Badge>
        ) : s.status === 'DISMISSED' ? (
          <Badge variant="neutral">Descartada</Badge>
        ) : (
          <Button variant="secondary" onClick={() => doConvert(s)} loading={convert.isPending}>
            {s.type === 'PURCHASE' ? 'Gerar PO' : 'Gerar OP'}
          </Button>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="MRP — Planejamento de Materiais"
        description="Calcula necessidades de compra e produção."
        actions={
          <Button onClick={calcMrp} loading={run.isPending}>
            <Play size={16} />
            Calcular MRP
          </Button>
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-surface-secondary px-3 py-2 text-xs text-content-muted">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          O horizonte de planejamento é definido pelo backend ao rodar o MRP (não selecionável aqui);
          a rodada mais recente é exibida. A coluna "Em pedido (POs abertas)" não é fornecida pelo
          backend. Converter uma sugestão gera automaticamente a PO (compra) ou OP (produção).
        </span>
      </div>

      {detailQ.data && (
        <p className="mb-3 text-sm text-content-muted">
          Rodada de <strong>{formatDateTime(detailQ.data.createdAt)}</strong> — horizonte {detailQ.data.horizonDays} dias
        </p>
      )}

      <DataTable
        data={suggestions}
        columns={columns}
        loading={runsQ.isLoading || detailQ.isLoading || run.isPending}
        searchPlaceholder="Buscar por produto..."
        emptyMessage='Nenhuma sugestão. Clique em "Calcular MRP" para gerar.'
      />
    </div>
  );
}
