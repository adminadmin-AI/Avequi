'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Check, X, ArrowRightCircle, Send } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type { Quotation, QuotationStatus, Customer } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatBRL, formatDate } from '@/lib/format';
import {
  QUOTATION_STATUS,
  QUOTATION_STATUS_OPTIONS,
  quotationTotal,
  availableQuotationActions,
  type QuotationAction,
} from './quotation-status';

const RESOURCE = '/quotations';

function shortId(id: string) {
  return id.slice(-6).toUpperCase();
}

const ACTION_ICON: Record<QuotationAction['endpoint'], React.ReactNode> = {
  send: <Send size={15} />,
  approve: <Check size={15} />,
  reject: <X size={15} />,
  convert: <ArrowRightCircle size={15} />,
};

export default function QuotationsPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const { data: quotations = [], isLoading } = useList<Quotation>(RESOURCE);
  const { data: customers = [] } = useList<Customer>('/customers');

  const [statusFilter, setStatusFilter] = useState<'' | QuotationStatus>('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Rejeição (motivo)
  const [rejectTarget, setRejectTarget] = useState<Quotation | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const action = useMutation({
    mutationFn: ({ id, endpoint, body }: { id: string; endpoint: string; body?: any }) =>
      apiClient.patch(`${RESOURCE}/${id}/${endpoint}`, body ?? {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: [RESOURCE] }),
  });

  const filtered = useMemo(() => {
    return quotations.filter((q) => {
      if (statusFilter && q.status !== statusFilter) return false;
      if (customerFilter && q.customerId !== customerFilter) return false;
      if (from && q.createdAt < from) return false;
      if (to && q.createdAt > to + 'T23:59:59') return false;
      return true;
    });
  }, [quotations, statusFilter, customerFilter, from, to]);

  function runAction(q: Quotation, a: QuotationAction) {
    if (a.endpoint === 'reject') {
      setRejectTarget(q);
      setRejectReason('');
      return;
    }
    const labels: Record<string, { ok: string; confirm?: string }> = {
      send: { ok: 'Cotação enviada' },
      approve: { ok: 'Cotação aprovada' },
      convert: { ok: 'Convertida em OV', confirm: 'Converter esta cotação em uma ordem de venda?' },
    };
    const meta = labels[a.endpoint];
    const doIt = () =>
      action.mutate(
        { id: q.id, endpoint: a.endpoint },
        {
          onSuccess: () => toast.success(meta.ok),
          onError: () => toast.error('Não foi possível executar a ação'),
        },
      );
    if (meta.confirm) {
      confirm({ title: 'Confirmar', description: meta.confirm, confirmLabel: 'Confirmar' }).then(
        (ok) => ok && doIt(),
      );
    } else {
      doIt();
    }
  }

  function submitReject() {
    if (!rejectTarget) return;
    action.mutate(
      { id: rejectTarget.id, endpoint: 'reject', body: { rejectionReason: rejectReason || undefined } },
      {
        onSuccess: () => {
          toast.success('Cotação rejeitada');
          setRejectTarget(null);
        },
        onError: () => toast.error('Não foi possível rejeitar'),
      },
    );
  }

  const columns: Column<Quotation>[] = [
    { key: 'number', header: 'Nº', cell: (q) => <span className="font-mono text-xs font-medium">#{shortId(q.id)}</span> },
    { key: 'customer', header: 'Cliente', cell: (q) => q.customer?.name ?? <span className="text-content-muted">—</span> },
    {
      key: 'total',
      header: 'Valor total',
      align: 'right',
      sortable: true,
      accessor: (q) => quotationTotal(q),
      cell: (q) => <span className="font-medium tabular-nums">{formatBRL(quotationTotal(q))}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (q) => q.status,
      cell: (q) => <Badge variant={QUOTATION_STATUS[q.status].variant}>{QUOTATION_STATUS[q.status].label}</Badge>,
    },
    {
      key: 'validUntil',
      header: 'Validade',
      cell: (q) => (q.validUntil ? formatDate(q.validUntil) : <span className="text-content-muted">—</span>),
    },
    { key: 'createdAt', header: 'Data', sortable: true, accessor: (q) => q.createdAt, cell: (q) => formatDate(q.createdAt) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (q) => {
        const actions = availableQuotationActions(q.status);
        if (actions.length === 0) return null;
        return (
          <div className="flex items-center justify-end gap-1">
            {actions.map((a) => (
              <button
                key={a.endpoint}
                onClick={(e) => {
                  e.stopPropagation();
                  runAction(q, a);
                }}
                title={a.label}
                className={`rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                  a.variant === 'danger' ? 'hover:text-danger' : 'hover:text-brand-600 dark:hover:text-brand-400'
                }`}
              >
                {ACTION_ICON[a.endpoint]}
              </button>
            ))}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Cotações"
        description="Propostas comerciais para clientes — do rascunho à conversão em venda."
        actions={
          <Button onClick={() => router.push('/app/quotations/new')}>
            <Plus size={16} />
            Nova cotação
          </Button>
        }
      />

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>Status</Label>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | QuotationStatus)}>
            <option value="">Todos</option>
            {QUOTATION_STATUS_OPTIONS.map((s) => (
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
          <Label>De</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label>Até</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        loading={isLoading}
        searchPlaceholder="Buscar por cliente..."
        emptyMessage="Nenhuma cotação encontrada."
      />

      <FormDialog
        open={!!rejectTarget}
        onOpenChange={(o) => !o && setRejectTarget(null)}
        title="Rejeitar cotação"
        description={rejectTarget ? `Cotação #${shortId(rejectTarget.id)}` : ''}
        formId="reject-form"
        submitLabel="Rejeitar"
        loading={action.isPending}
      >
        <form
          id="reject-form"
          onSubmit={(e) => {
            e.preventDefault();
            submitReject();
          }}
          className="space-y-3 py-1"
        >
          <div>
            <Label>Motivo da rejeição</Label>
            <Input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Opcional"
            />
          </div>
        </form>
      </FormDialog>
    </div>
  );
}
