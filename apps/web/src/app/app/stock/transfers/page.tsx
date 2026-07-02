'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Send, PackageCheck, Ban, ArrowRight } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type { StoreTransfer, TransferStatus } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatDate } from '@/lib/format';

const RESOURCE = '/transfers';

const STATUS_META: Record<TransferStatus, { label: string; variant: any }> = {
  DRAFT: { label: 'Rascunho', variant: 'neutral' },
  DISPATCHED: { label: 'Em trânsito', variant: 'info' },
  RECEIVED: { label: 'Recebida', variant: 'success' },
  CANCELLED: { label: 'Cancelada', variant: 'neutral' },
};

function shortId(id: string) {
  return id.slice(-6).toUpperCase();
}

export default function TransfersPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const { data: transfers = [], isLoading } = useList<StoreTransfer>(RESOURCE);

  const transition = useMutation({
    mutationFn: ({ id, endpoint }: { id: string; endpoint: string }) =>
      apiClient.patch(`${RESOURCE}/${id}/${endpoint}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: [RESOURCE] }),
  });

  function runAction(t: StoreTransfer, endpoint: 'dispatch' | 'receive' | 'cancel') {
    const labels: Record<string, string> = {
      dispatch: 'Despachar transferência?',
      receive: 'Confirmar recebimento?',
      cancel: 'Cancelar transferência?',
    };
    const ok2 = () =>
      transition.mutate(
        { id: t.id, endpoint },
        {
          onSuccess: () => toast.success('Status atualizado'),
          onError: () => toast.error('Não foi possível executar a ação'),
        },
      );
    if (endpoint === 'cancel') {
      confirm({ title: labels[endpoint], description: 'Esta ação não pode ser desfeita.', confirmLabel: 'Cancelar', variant: 'danger' }).then((ok) => ok && ok2());
    } else {
      confirm({ title: labels[endpoint], confirmLabel: 'Confirmar' }).then((ok) => ok && ok2());
    }
  }

  const columns: Column<StoreTransfer>[] = [
    { key: 'number', header: 'Nº', cell: (t) => <span className="font-mono text-xs font-medium">#{shortId(t.id)}</span> },
    {
      key: 'route',
      header: 'Origem → Destino',
      cell: (t) => (
        <span className="inline-flex items-center gap-1.5 text-sm">
          {t.fromWarehouse?.code ?? '—'}
          <ArrowRight size={13} className="text-content-muted" />
          {t.toWarehouse?.code ?? '—'}
        </span>
      ),
    },
    { key: 'items', header: 'Itens', align: 'right', cell: (t) => (t.items?.length ?? 0) },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (t) => t.status,
      cell: (t) => <Badge variant={STATUS_META[t.status].variant}>{STATUS_META[t.status].label}</Badge>,
    },
    { key: 'createdAt', header: 'Data', sortable: true, accessor: (t) => t.createdAt, cell: (t) => formatDate(t.createdAt) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (t) => (
        <div className="flex items-center justify-end gap-1">
          {t.status === 'DRAFT' && (
            <button onClick={(e) => { e.stopPropagation(); runAction(t, 'dispatch'); }} title="Despachar" className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400">
              <Send size={15} />
            </button>
          )}
          {t.status === 'DISPATCHED' && (
            <button onClick={(e) => { e.stopPropagation(); runAction(t, 'receive'); }} title="Confirmar recebimento" className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-success">
              <PackageCheck size={15} />
            </button>
          )}
          {(t.status === 'DRAFT' || t.status === 'DISPATCHED') && (
            <button onClick={(e) => { e.stopPropagation(); runAction(t, 'cancel'); }} title="Cancelar" className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-danger">
              <Ban size={15} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Transferências entre Depósitos"
        description="Movimentação de estoque entre depósitos/lojas."
        actions={
          <Button onClick={() => router.push('/app/stock/transfers/new')}>
            <Plus size={16} />
            Nova transferência
          </Button>
        }
      />

      <DataTable
        data={transfers}
        columns={columns}
        loading={isLoading}
        searchPlaceholder="Buscar..."
        emptyMessage="Nenhuma transferência encontrada."
      />
    </div>
  );
}
