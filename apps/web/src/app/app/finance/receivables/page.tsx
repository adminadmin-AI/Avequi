'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DollarSign, Barcode, QrCode, ExternalLink, Ban } from 'lucide-react';
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
import { ReceivablePayForm, type PayFormValues } from './receivable-pay-form';

const RESOURCE = '/finance';
const OPEN_STATUSES: FinancialEntryStatus[] = ['OPEN', 'OVERDUE', 'PARTIALLY_PAID'];
const SOURCE_LABEL: Record<string, string> = {
  AUTO_SALES: 'Venda',
  AUTO_PURCHASE: 'Compra',
  MANUAL: 'Manual',
};

function num(v: string | null | undefined): number {
  return v ? Number(v) : 0;
}
function remainingOf(e: FinancialEntry): number {
  return num(e.amount) - num(e.paidAmount);
}
function isOpen(e: FinancialEntry): boolean {
  return OPEN_STATUSES.includes(e.status);
}
/** Dias de atraso (positivo = vencido há N dias; 0 ou negativo = a vencer). */
function daysOverdue(e: FinancialEntry, today: Date): number {
  const due = new Date(e.dueDate);
  return Math.floor((today.getTime() - due.getTime()) / 86_400_000);
}

function effectiveStatus(e: FinancialEntry, today: Date): FinancialEntryStatus {
  if (isOpen(e) && e.status !== 'PARTIALLY_PAID' && daysOverdue(e, today) > 0) return 'OVERDUE';
  return e.status;
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
    <Card className={highlight ? 'border-red-200 bg-red-50/40' : undefined}>
      <CardContent className="py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
        <p
          className={`mt-1 text-2xl font-semibold tracking-tight ${
            highlight ? 'text-danger' : 'text-slate-900'
          }`}
        >
          {formatBRL(value)}
        </p>
        {count != null && (
          <p className="mt-0.5 text-xs text-slate-400">
            {count} {count === 1 ? 'lançamento' : 'lançamentos'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function ReceivablesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  // Busca todos os recebíveis; KPIs/aging usam o total, a tabela filtra no client.
  const { data: entries = [], isLoading } = useList<FinancialEntry>(RESOURCE, {
    type: 'RECEIVABLE',
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

  // ── KPIs + aging (sobre o total) ──
  const summary = useMemo(() => {
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    let toComeValue = 0,
      toComeCount = 0,
      overdueValue = 0,
      overdueCount = 0,
      receivedMonth = 0,
      totalOpen = 0;
    const aging = { toCome: 0, d1_30: 0, d31_60: 0, d60plus: 0 };

    for (const e of entries) {
      if (e.paidAt && new Date(e.paidAt) >= monthStart) receivedMonth += num(e.paidAmount);
      if (!isOpen(e)) continue;
      const rem = remainingOf(e);
      totalOpen += rem;
      const d = daysOverdue(e, today);
      if (d > 0) {
        overdueValue += rem;
        overdueCount += 1;
        if (d <= 30) aging.d1_30 += rem;
        else if (d <= 60) aging.d31_60 += rem;
        else aging.d60plus += rem;
      } else {
        toComeValue += rem;
        toComeCount += 1;
        aging.toCome += rem;
      }
    }
    return {
      toComeValue,
      toComeCount,
      overdueValue,
      overdueCount,
      receivedMonth,
      totalOpen,
      aging,
    };
  }, [entries, today]);

  // ── Filtros (client-side) ──
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | FinancialEntryStatus>('');
  const [clientFilter, setClientFilter] = useState('');

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (dueFrom && e.dueDate < dueFrom) return false;
      if (dueTo && e.dueDate > dueTo + 'T23:59:59') return false;
      if (statusFilter && effectiveStatus(e, today) !== statusFilter) return false;
      if (clientFilter) {
        const name = e.salesOrder?.customer?.name ?? '';
        if (!name.toLowerCase().includes(clientFilter.toLowerCase())) return false;
      }
      return true;
    });
  }, [entries, dueFrom, dueTo, statusFilter, clientFilter, today]);

  // ── Ações ──
  const [payTarget, setPayTarget] = useState<FinancialEntry | null>(null);

  function handlePay(values: PayFormValues) {
    if (!payTarget) return;
    pay.mutate(
      { id: payTarget.id, data: values },
      {
        onSuccess: () => {
          toast.success('Baixa registrada');
          setPayTarget(null);
        },
        onError: () => toast.error('Erro ao registrar baixa'),
      },
    );
  }

  async function handleCancel(e: FinancialEntry) {
    const ok = await confirm({
      title: 'Cancelar lançamento?',
      description: `O recebível de ${formatBRL(num(e.amount))} será marcado como cancelado. Esta ação não pode ser desfeita.`,
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
      key: 'client',
      header: 'Cliente',
      cell: (e) => e.salesOrder?.customer?.name ?? <span className="text-slate-400">—</span>,
    },
    {
      key: 'description',
      header: 'Descrição',
      cell: (e) => e.description || <span className="text-slate-400">—</span>,
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
      key: 'paidAt',
      header: 'Pago em',
      cell: (e) => (e.paidAt ? formatDate(e.paidAt) : <span className="text-slate-400">—</span>),
    },
    {
      key: 'source',
      header: 'Origem',
      cell: (e) => <span className="text-xs text-slate-500">{SOURCE_LABEL[e.source] ?? e.source}</span>,
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
                title="Dar baixa"
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-success"
              >
                <DollarSign size={15} />
              </button>
            )}
            <button
              disabled
              title="Gerar boleto — em breve (F2-9)"
              className="rounded-md p-1.5 text-slate-300 cursor-not-allowed"
            >
              <Barcode size={15} />
            </button>
            <button
              disabled
              title="Gerar PIX — em breve (F2-9)"
              className="rounded-md p-1.5 text-slate-300 cursor-not-allowed"
            >
              <QrCode size={15} />
            </button>
            {e.salesOrderId && (
              <Link
                href={`/app/sales/${e.salesOrderId}`}
                onClick={(ev) => ev.stopPropagation()}
                title="Ver OV vinculada"
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600"
              >
                <ExternalLink size={15} />
              </Link>
            )}
            {canCancel && (
              <button
                onClick={(ev) => {
                  ev.stopPropagation();
                  handleCancel(e);
                }}
                title="Cancelar"
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-danger"
              >
                <Ban size={15} />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const agingRows = [
    { label: 'A vencer', value: summary.aging.toCome, danger: false },
    { label: 'Vencido 1–30 dias', value: summary.aging.d1_30, danger: true },
    { label: 'Vencido 31–60 dias', value: summary.aging.d31_60, danger: true },
    { label: 'Vencido > 60 dias', value: summary.aging.d60plus, danger: true },
  ];

  return (
    <div>
      <PageHeader
        title="Carteira de Recebíveis"
        description="Contas a receber, vencimentos e baixas."
        actions={<ManualEntryDialog defaultType="RECEIVABLE" />}
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
        <KpiCard label="Recebido no mês" value={summary.receivedMonth} />
        <KpiCard label="Total em aberto" value={summary.totalOpen} />
      </div>

      <div className="grid gap-5 lg:grid-cols-4">
        {/* Tabela + filtros */}
        <div className="lg:col-span-3">
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
              <Label>Cliente</Label>
              <Input
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                placeholder="Nome do cliente"
              />
            </div>
          </div>

          <DataTable
            data={filtered}
            columns={columns}
            loading={isLoading}
            searchPlaceholder="Buscar por descrição ou cliente..."
            emptyMessage="Nenhum recebível encontrado."
          />
        </div>

        {/* Aging report */}
        <Card className="h-fit lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Aging</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {agingRows.map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-2">
                <span className="text-sm text-slate-600">{r.label}</span>
                <span
                  className={`text-sm font-medium tabular-nums ${
                    r.danger && r.value > 0 ? 'text-danger' : 'text-slate-900'
                  }`}
                >
                  {formatBRL(r.value)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <span className="text-sm font-medium text-slate-700">Total em aberto</span>
              <span className="text-sm font-semibold tabular-nums text-slate-900">
                {formatBRL(summary.totalOpen)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <FormDialog
        open={!!payTarget}
        onOpenChange={(o) => !o && setPayTarget(null)}
        title="Dar baixa"
        description={payTarget?.description ?? 'Registrar recebimento'}
        formId="pay-form"
        submitLabel="Dar baixa"
        loading={pay.isPending}
      >
        {payTarget && (
          <ReceivablePayForm
            formId="pay-form"
            remaining={remainingOf(payTarget)}
            onSubmit={handlePay}
          />
        )}
      </FormDialog>
    </div>
  );
}
