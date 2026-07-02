'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DollarSign, CalendarClock, ExternalLink, Ban } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type { FinancialEntry, FinancialEntryStatus } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatBRL, formatDate } from '@/lib/format';
import { ManualEntryDialog } from '../manual-entry-dialog';
import { PayablePayForm, type PayFormValues } from './payable-pay-form';

const RESOURCE = '/finance';
const OPEN_STATUSES: FinancialEntryStatus[] = ['OPEN', 'OVERDUE', 'PARTIALLY_PAID'];

function num(v: string | null | undefined): number {
  return v ? Number(v) : 0;
}
function remainingOf(e: FinancialEntry): number {
  return num(e.amount) - num(e.paidAmount);
}
function isOpen(e: FinancialEntry): boolean {
  return OPEN_STATUSES.includes(e.status);
}
function daysOverdue(e: FinancialEntry, today: Date): number {
  const due = new Date(e.dueDate);
  return Math.floor((today.getTime() - due.getTime()) / 86_400_000);
}
function effectiveStatus(e: FinancialEntry, today: Date): FinancialEntryStatus {
  if (isOpen(e) && e.status !== 'PARTIALLY_PAID' && daysOverdue(e, today) > 0) return 'OVERDUE';
  return e.status;
}
/** CP gerado por PO ainda não aprovada (status DRAFT). */
function pendingApproval(e: FinancialEntry): boolean {
  return !!e.purchaseOrder && e.purchaseOrder.status === 'DRAFT';
}

const STATUS_META: Record<FinancialEntryStatus, { label: string; variant: any }> = {
  OPEN: { label: 'Em aberto', variant: 'info' },
  OVERDUE: { label: 'Vencido', variant: 'danger' },
  PARTIALLY_PAID: { label: 'Parcial', variant: 'warning' },
  PAID: { label: 'Pago', variant: 'success' },
  CANCELLED: { label: 'Cancelado', variant: 'neutral' },
};

function KpiCard({
  label,
  value,
  count,
  highlight,
}: {
  label: string;
  value: number;
  count?: number;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? 'border-danger/30 bg-danger/10' : undefined}>
      <CardContent className="py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-content-muted">{label}</p>
        <p
          className={`mt-1 text-2xl font-semibold tracking-tight ${
            highlight ? 'text-danger' : 'text-content'
          }`}
        >
          {formatBRL(value)}
        </p>
        {count != null && (
          <p className="mt-0.5 text-xs text-content-muted">
            {count} {count === 1 ? 'lançamento' : 'lançamentos'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function PayablesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const { data: entries = [], isLoading } = useList<FinancialEntry>(RESOURCE, {
    type: 'PAYABLE',
  });

  const pay = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PayFormValues }) =>
      apiClient.patch(`${RESOURCE}/${id}/pay`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [RESOURCE] }),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => apiClient.patch(`${RESOURCE}/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [RESOURCE] }),
  });

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // ── KPIs (sobre o total) ──
  const summary = useMemo(() => {
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    let toComeValue = 0,
      toComeCount = 0,
      overdueValue = 0,
      overdueCount = 0,
      paidMonth = 0,
      totalOpen = 0;

    for (const e of entries) {
      if (e.paidAt && new Date(e.paidAt) >= monthStart) paidMonth += num(e.paidAmount);
      if (!isOpen(e)) continue;
      const rem = remainingOf(e);
      totalOpen += rem;
      if (daysOverdue(e, today) > 0) {
        overdueValue += rem;
        overdueCount += 1;
      } else {
        toComeValue += rem;
        toComeCount += 1;
      }
    }
    return { toComeValue, toComeCount, overdueValue, overdueCount, paidMonth, totalOpen };
  }, [entries, today]);

  // ── Filtros ──
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | FinancialEntryStatus>('');
  const [supplierFilter, setSupplierFilter] = useState('');

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (dueFrom && e.dueDate < dueFrom) return false;
      if (dueTo && e.dueDate > dueTo + 'T23:59:59') return false;
      if (statusFilter && effectiveStatus(e, today) !== statusFilter) return false;
      if (supplierFilter) {
        const name = e.purchaseOrder?.supplier?.name ?? '';
        if (!name.toLowerCase().includes(supplierFilter.toLowerCase())) return false;
      }
      return true;
    });
  }, [entries, dueFrom, dueTo, statusFilter, supplierFilter, today]);

  // ── Ações ──
  const [payTarget, setPayTarget] = useState<FinancialEntry | null>(null);

  function handlePay(values: PayFormValues) {
    if (!payTarget) return;
    pay.mutate(
      { id: payTarget.id, data: values },
      {
        onSuccess: () => {
          toast.success('Pagamento registrado');
          setPayTarget(null);
        },
        onError: () => toast.error('Erro ao registrar pagamento'),
      },
    );
  }

  async function handleCancel(e: FinancialEntry) {
    const ok = await confirm({
      title: 'Cancelar lançamento?',
      description: `O pagável de ${formatBRL(num(e.amount))} será marcado como cancelado. Esta ação não pode ser desfeita.`,
      confirmLabel: 'Cancelar lançamento',
      variant: 'danger',
    });
    if (!ok) return;
    cancel.mutate(e.id, {
      onSuccess: () => toast.success('Lançamento cancelado'),
      onError: () => toast.error('Erro ao cancelar'),
    });
  }

  const columns: Column<FinancialEntry>[] = [
    {
      key: 'supplier',
      header: 'Fornecedor',
      cell: (e) => (
        <div className="flex items-center gap-2">
          <span>{e.purchaseOrder?.supplier?.name ?? <span className="text-content-muted">—</span>}</span>
          {pendingApproval(e) && (
            <Badge variant="warning" className="whitespace-nowrap">
              Aprovação pendente
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'description',
      header: 'Descrição',
      cell: (e) => e.description || <span className="text-content-muted">—</span>,
    },
    {
      key: 'amount',
      header: 'Valor',
      align: 'right',
      sortable: true,
      accessor: (e) => num(e.amount),
      cell: (e) => <span className="font-medium tabular-nums">{formatBRL(num(e.amount))}</span>,
    },
    {
      key: 'dueDate',
      header: 'Vencimento',
      sortable: true,
      accessor: (e) => e.dueDate,
      cell: (e) => formatDate(e.dueDate),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (e) => effectiveStatus(e, today),
      cell: (e) => {
        const meta = STATUS_META[effectiveStatus(e, today)];
        return <Badge variant={meta.variant}>{meta.label}</Badge>;
      },
    },
    {
      key: 'po',
      header: 'PO vinculada',
      cell: (e) =>
        e.purchaseOrderId ? (
          <Link
            href={`/app/purchase/${e.purchaseOrderId}`}
            onClick={(ev) => ev.stopPropagation()}
            className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 hover:underline"
          >
            <ExternalLink size={13} /> Ver PO
          </Link>
        ) : (
          <span className="text-content-muted">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (e) => {
        const canPay = isOpen(e);
        const canCancel = e.status !== 'PAID' && e.status !== 'CANCELLED';
        return (
          <div className="flex items-center justify-end gap-1">
            {canPay && (
              <button
                onClick={(ev) => {
                  ev.stopPropagation();
                  setPayTarget(e);
                }}
                title="Dar baixa manual"
                className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-success"
              >
                <DollarSign size={15} />
              </button>
            )}
            <Link
              href="/app/finance/scheduled-payments"
              onClick={(ev) => ev.stopPropagation()}
              title="Agendar pagamento"
              className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400"
            >
              <CalendarClock size={15} />
            </Link>
            {canCancel && (
              <button
                onClick={(ev) => {
                  ev.stopPropagation();
                  handleCancel(e);
                }}
                title="Cancelar"
                className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-danger"
              >
                <Ban size={15} />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Carteira de Pagáveis"
        description="Contas a pagar, vencimentos e baixas."
        actions={<ManualEntryDialog defaultType="PAYABLE" />}
      />

      {/* KPIs */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="A vencer" value={summary.toComeValue} count={summary.toComeCount} />
        <KpiCard
          label="Vencido"
          value={summary.overdueValue}
          count={summary.overdueCount}
          highlight
        />
        <KpiCard label="Pago no mês" value={summary.paidMonth} />
        <KpiCard label="Total em aberto" value={summary.totalOpen} />
      </div>

      {/* Filtros */}
      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>Vencimento de</Label>
          <Input type="date" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} />
        </div>
        <div>
          <Label>Vencimento até</Label>
          <Input type="date" value={dueTo} onChange={(e) => setDueTo(e.target.value)} />
        </div>
        <div>
          <Label>Status</Label>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as '' | FinancialEntryStatus)}
          >
            <option value="">Todos</option>
            <option value="OPEN">Em aberto</option>
            <option value="OVERDUE">Vencido</option>
            <option value="PARTIALLY_PAID">Parcial</option>
            <option value="PAID">Pago</option>
            <option value="CANCELLED">Cancelado</option>
          </Select>
        </div>
        <div>
          <Label>Fornecedor</Label>
          <Input
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            placeholder="Nome do fornecedor"
          />
        </div>
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        loading={isLoading}
        searchPlaceholder="Buscar por descrição ou fornecedor..."
        emptyMessage="Nenhum pagável encontrado."
      />

      <FormDialog
        open={!!payTarget}
        onOpenChange={(o) => !o && setPayTarget(null)}
        title="Dar baixa manual"
        description={payTarget?.description ?? 'Registrar pagamento'}
        formId="pay-form"
        submitLabel="Dar baixa"
        loading={pay.isPending}
      >
        {payTarget && (
          <PayablePayForm
            formId="pay-form"
            remaining={remainingOf(payTarget)}
            onSubmit={handlePay}
          />
        )}
      </FormDialog>
    </div>
  );
}
