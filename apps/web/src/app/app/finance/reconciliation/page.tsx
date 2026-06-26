'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Info, Download, FileCheck2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type { ReconciliationItem } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { formatBRL, formatDate } from '@/lib/format';

const UNMATCHED = '/banking/reconciliation/unmatched';
const RETORNOS = '/banking/cnab/retornos';

type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const RETORNO_STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  PENDING: { label: 'Pendente', variant: 'neutral' },
  PROCESSING: { label: 'Processando', variant: 'info' },
  PROCESSED: { label: 'Processado', variant: 'success' },
  ERROR: { label: 'Erro', variant: 'danger' },
};

interface CnabRetorno {
  id: string;
  fileName: string;
  status: string;
  matchedCount: number;
  unmatchedCount: number;
  totalAmount: string | null;
  processedAt: string | null;
  createdAt: string;
  bankAccount?: { id: string; name: string; bankCode?: string } | null;
  _count?: { items: number };
}

function num(v: string | null | undefined) {
  return v ? Number(v) : 0;
}

export default function ReconciliationPage() {
  const toast = useToast();
  const qc = useQueryClient();

  const retornosQ = useQuery({
    queryKey: [RETORNOS],
    queryFn: async () => (await apiClient.get<CnabRetorno[]>(RETORNOS)).data,
  });
  const { data: items = [], isLoading } = useList<ReconciliationItem>(UNMATCHED);

  const importMut = useMutation({
    mutationFn: (retornoId: string) =>
      apiClient.post<{ created: number }>(`/banking/reconciliation/import/${retornoId}`, {}),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: [UNMATCHED] });
      qc.invalidateQueries({ queryKey: [RETORNOS] });
      const created = res.data?.created ?? 0;
      toast.success(created > 0 ? `${created} item(ns) importado(s) para conciliação` : 'Nenhum item novo a importar');
    },
    onError: () => toast.error('Não foi possível importar o retorno'),
  });

  const retornos = retornosQ.data ?? [];

  const retornoColumns: Column<CnabRetorno>[] = [
    { key: 'fileName', header: 'Arquivo', cell: (r) => <span className="font-mono text-xs">{r.fileName}</span> },
    { key: 'account', header: 'Conta', cell: (r) => r.bankAccount?.name ?? '—' },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      cell: (r) => {
        const s = RETORNO_STATUS[r.status] ?? { label: r.status, variant: 'neutral' as BadgeVariant };
        return <Badge variant={s.variant}>{s.label}</Badge>;
      },
    },
    { key: 'matched', header: 'Conciliados', align: 'right', cell: (r) => `${r.matchedCount}/${r._count?.items ?? r.matchedCount + r.unmatchedCount}` },
    { key: 'total', header: 'Valor', align: 'right', cell: (r) => formatBRL(num(r.totalAmount)) },
    { key: 'date', header: 'Processado', sortable: true, accessor: (r) => r.processedAt ?? r.createdAt, cell: (r) => formatDate(r.processedAt ?? r.createdAt) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) => (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => importMut.mutate(r.id)}
          loading={importMut.isPending && importMut.variables === r.id}
          disabled={r.status !== 'PROCESSED'}
        >
          <Download size={14} /> Importar conciliação
        </Button>
      ),
    },
  ];

  const itemColumns: Column<ReconciliationItem>[] = [
    { key: 'date', header: 'Data', sortable: true, accessor: (i) => i.date, cell: (i) => formatDate(i.date) },
    { key: 'description', header: 'Descrição do banco', cell: (i) => i.description || '—' },
    { key: 'account', header: 'Conta', cell: (i) => i.bankAccount?.name ?? '—' },
    {
      key: 'type',
      header: 'Tipo',
      align: 'center',
      cell: (i) => {
        const credit = (i.type ? i.type === 'CREDIT' : num(i.amount) >= 0);
        return <Badge variant={credit ? 'success' : 'danger'}>{credit ? 'Crédito' : 'Débito'}</Badge>;
      },
    },
    {
      key: 'amount',
      header: 'Valor',
      align: 'right',
      sortable: true,
      accessor: (i) => num(i.amount),
      cell: (i) => <span className="font-medium tabular-nums">{formatBRL(num(i.amount))}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Conciliação Bancária"
        description="Importe os retornos CNAB e acompanhe as transações ainda não conciliadas."
      />

      <div className="mb-5 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          Ao <strong>importar</strong> um retorno CNAB processado, os boletos liquidados são conciliados
          automaticamente (vinculados pelo Nosso Número); o que não casar aparece em
          <strong> Itens não conciliados</strong>. A confirmação manual de matches ainda depende de um
          endpoint do backend (#247).
        </span>
      </div>

      {/* Retornos CNAB */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><FileCheck2 size={16} /> Retornos CNAB</CardTitle>
        </CardHeader>
        <CardContent>
          {retornosQ.isLoading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : retornos.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">Nenhum arquivo de retorno CNAB processado.</p>
          ) : (
            <DataTable
              data={retornos}
              columns={retornoColumns}
              searchable={false}
              emptyMessage="Nenhum retorno."
            />
          )}
        </CardContent>
      </Card>

      {/* Itens não conciliados */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>Itens não conciliados</span>
            {items.length > 0 && <Badge variant="warning">{items.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            data={items}
            columns={itemColumns}
            loading={isLoading}
            searchPlaceholder="Buscar por descrição..."
            emptyMessage="Nenhuma transação pendente de conciliação."
          />
        </CardContent>
      </Card>
    </div>
  );
}
