'use client';

import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, Check, Info, ExternalLink } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatBRL, formatDate } from '@/lib/format';

const ALLOWED_ROLES = ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER'];

interface PendingApproval {
  id: string;
  totalAmount: number;
  createdAt: string;
  supplier?: { id: string; name: string } | null;
  createdBy?: { id: string; name: string } | null;
}

function shortId(id: string) {
  return id.slice(-6).toUpperCase();
}

export default function ApprovalsPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canApprove = !!user && ALLOWED_ROLES.includes(user.role);

  const { data: pending = [], isLoading } = useQuery({
    queryKey: ['/approvals/pending'],
    queryFn: async () => (await apiClient.get<PendingApproval[]>('/approvals/pending')).data,
    enabled: canApprove,
  });

  const approve = useMutation({
    mutationFn: (documentId: string) =>
      apiClient.post(`/approvals/${documentId}/approve`, {}, { params: { documentType: 'PO' } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/approvals/pending'] });
      qc.invalidateQueries({ queryKey: ['/purchases/orders'] });
    },
  });

  async function handleApprove(item: PendingApproval) {
    const ok = await confirm({
      title: 'Aprovar pedido de compra?',
      description: `PO #${shortId(item.id)} — ${formatBRL(item.totalAmount)} (${item.supplier?.name ?? 'sem fornecedor'}).`,
      confirmLabel: 'Aprovar',
      variant: 'primary',
    });
    if (!ok) return;
    approve.mutate(item.id, {
      onSuccess: () => toast.success('Pedido aprovado'),
      onError: () => toast.error('Não foi possível aprovar'),
    });
  }

  const columns: Column<PendingApproval>[] = [
    { key: 'type', header: 'Tipo', cell: () => <Badge variant="info">Compra</Badge> },
    {
      key: 'ref',
      header: 'Referência',
      cell: (i) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/app/purchases/${i.id}`);
          }}
          className="inline-flex items-center gap-1 font-mono text-xs text-brand-600 dark:text-brand-400 hover:underline"
        >
          <ExternalLink size={12} /> PO #{shortId(i.id)}
        </button>
      ),
    },
    { key: 'requester', header: 'Solicitante', cell: (i) => i.createdBy?.name ?? '—' },
    { key: 'supplier', header: 'Fornecedor', cell: (i) => i.supplier?.name ?? '—' },
    {
      key: 'amount',
      header: 'Valor',
      align: 'right',
      sortable: true,
      accessor: (i) => i.totalAmount,
      cell: (i) => <span className="font-medium tabular-nums">{formatBRL(i.totalAmount)}</span>,
    },
    { key: 'createdAt', header: 'Data', cell: (i) => formatDate(i.createdAt) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (i) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleApprove(i);
          }}
          title="Aprovar"
          className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-success"
        >
          <Check size={16} />
        </button>
      ),
    },
  ];

  if (!canApprove) {
    return (
      <div>
        <PageHeader title="Aprovações" description="Pedidos pendentes de aprovação por alçada." />
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-line bg-surface py-16 text-center">
          <ShieldAlert className="text-content-muted" size={40} />
          <div>
            <p className="text-sm font-medium text-content-secondary">Acesso restrito</p>
            <p className="text-xs text-content-muted">Apenas aprovadores (Gerente, Diretor, Super Admin).</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Aprovações" description="Pedidos de compra pendentes de aprovação por alçada." />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-surface-secondary px-3 py-2 text-xs text-content-muted">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          O backend expõe aprovação de <strong>Pedidos de Compra</strong> por alçada. Rejeição com
          motivo e aprovações de <strong>pagamento</strong> ainda não têm endpoint — serão ligadas
          quando o backend disponibilizar.
        </span>
      </div>

      <DataTable
        data={pending}
        columns={columns}
        loading={isLoading}
        searchPlaceholder="Buscar por fornecedor ou solicitante..."
        emptyMessage="Nenhuma aprovação pendente."
      />
    </div>
  );
}
