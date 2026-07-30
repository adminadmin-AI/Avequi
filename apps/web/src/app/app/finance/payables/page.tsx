'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DollarSign, CalendarClock, Ban, Pencil, TrendingDown } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import { usePermission } from '@/hooks/use-permission';
import type { FinancialEntry, FinancialEntryStatus } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { DateRangePicker, type DateRange, dateToISO } from '@/components/ui/date-picker';
import { DataTable, type Column } from '@/components/ui/data-table';
import { StatGroup } from '@/components/ui/stat-group';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatBRL, formatDate, formatCpfCnpj, prettyName } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ManualEntryDialog } from '../manual-entry-dialog';
import { EditEntryDialog } from '../edit-entry-dialog';
import { canEditEntry } from './editable';
import { venceDate, previsaoDate, inRange, toDayStr } from './filters';
import { num, remainingOf } from './detail';
import { EntryDetailSheet } from './entry-detail-sheet';
import { PayablePayForm, type PayFormValues } from './payable-pay-form';

const RESOURCE = '/finance';
const OPEN_STATUSES: FinancialEntryStatus[] = ['OPEN', 'OVERDUE', 'PARTIALLY_PAID'];

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
/** Fornecedor do título: vínculo direto (#785) tem precedência; senão, o da PO. */
function supplierName(e: FinancialEntry): string {
  return e.supplier?.name ?? e.purchaseOrder?.supplier?.name ?? '';
}
/** CNPJ/CPF do fornecedor (mesma precedência do nome); null quando não houver. */
function supplierCnpj(e: FinancialEntry): string | null {
  return e.supplier?.cnpj ?? e.purchaseOrder?.supplier?.cnpj ?? null;
}

const STATUS_META: Record<FinancialEntryStatus, { label: string; variant: any }> = {
  OPEN: { label: 'Em aberto', variant: 'info' },
  OVERDUE: { label: 'Vencido', variant: 'danger' },
  PARTIALLY_PAID: { label: 'Parcial', variant: 'warning' },
  PAID: { label: 'Pago', variant: 'success' },
  CANCELLED: { label: 'Cancelado', variant: 'neutral' },
};

function countSub(count: number): string {
  return `${count} ${count === 1 ? 'lançamento' : 'lançamentos'}`;
}

export default function PayablesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { can } = usePermission();
  const canUpdate = can('finance.entries.update'); // gate do lápis (UX; backend valida de verdade)

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

  // ── Filtros ──
  // Vencimento e Previsão como PERÍODO (um campo cada, calendário de 2 cliques).
  const [dueRange, setDueRange] = useState<DateRange>();
  const [prevRange, setPrevRange] = useState<DateRange>();
  const [statusFilter, setStatusFilter] = useState<'' | FinancialEntryStatus>('');
  const [supplierFilter, setSupplierFilter] = useState('');

  const todayStr = useMemo(() => toDayStr(today), [today]);

  const filtered = useMemo(() => {
    const dueFrom = dateToISO(dueRange?.from);
    const dueTo = dateToISO(dueRange?.to);
    const prevFrom = dateToISO(prevRange?.from);
    const prevTo = dateToISO(prevRange?.to);
    return entries.filter((e) => {
      if (!inRange(venceDate(e), dueFrom, dueTo)) return false;
      if (!inRange(previsaoDate(e), prevFrom, prevTo)) return false;
      if (statusFilter && effectiveStatus(e, today) !== statusFilter) return false;
      if (supplierFilter) {
        if (!supplierName(e).toLowerCase().includes(supplierFilter.toLowerCase())) return false;
      }
      return true;
    });
  }, [entries, dueRange, prevRange, statusFilter, supplierFilter, today]);

  // Atalhos "hoje": marcam o período do respectivo campo como [hoje, hoje].
  const dueIsToday =
    dateToISO(dueRange?.from) === todayStr && dateToISO(dueRange?.to) === todayStr;
  const prevIsToday =
    dateToISO(prevRange?.from) === todayStr && dateToISO(prevRange?.to) === todayStr;
  const toggleDueToday = () =>
    setDueRange(dueIsToday ? undefined : { from: today, to: today });
  const togglePrevToday = () =>
    setPrevRange(prevIsToday ? undefined : { from: today, to: today });

  // ── KPIs (refletem os filtros ativos; sem filtro = totais completos) ──
  const summary = useMemo(() => {
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    let toComeValue = 0,
      toComeCount = 0,
      overdueValue = 0,
      overdueCount = 0,
      paidMonth = 0,
      totalOpen = 0;

    for (const e of filtered) {
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
  }, [filtered, today]);

  // ── Ações ──
  const [payTarget, setPayTarget] = useState<FinancialEntry | null>(null);
  const [editTarget, setEditTarget] = useState<FinancialEntry | null>(null);
  const [detailTarget, setDetailTarget] = useState<FinancialEntry | null>(null);

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
      // Descrição e PO saíram da tabela (moram no painel de detalhe) — o
      // accessor mantém a BUSCA cobrindo nome, CNPJ e descrição (OMIE#/doc).
      accessor: (e) => `${supplierName(e)} ${supplierCnpj(e) ?? ''} ${e.description ?? ''}`,
      cell: (e) => {
        const cnpj = supplierCnpj(e);
        return (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span>{prettyName(supplierName(e)) || <span className="text-content-muted">—</span>}</span>
              {pendingApproval(e) && (
                <Badge variant="warning" className="whitespace-nowrap">
                  Aprovação pendente
                </Badge>
              )}
            </div>
            {cnpj && (
              <span className="text-xs tabular-nums text-content-muted">{formatCpfCnpj(cnpj)}</span>
            )}
          </div>
        );
      },
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
      key: 'expectedPaymentDate',
      header: 'Previsão',
      sortable: true,
      // #788 — previsão de pagamento; cai pro vencimento quando não informada.
      accessor: (e) => e.expectedPaymentDate ?? e.dueDate,
      cell: (e) => formatDate(e.expectedPaymentDate ?? e.dueDate),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (e) => effectiveStatus(e, today),
      cell: (e) => {
        const meta = STATUS_META[effectiveStatus(e, today)];
        return <StatusDot variant={meta.variant}>{meta.label}</StatusDot>;
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
            {canEditEntry(e.status, canUpdate) && (
              <button
                onClick={(ev) => {
                  ev.stopPropagation();
                  setEditTarget(e);
                }}
                title="Editar lançamento"
                className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400"
              >
                <Pencil size={15} />
              </button>
            )}
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
      <StatGroup
        className="mb-6"
        stats={[
          { label: 'A vencer', value: formatBRL(summary.toComeValue), sub: countSub(summary.toComeCount) },
          {
            label: 'Vencido',
            value: formatBRL(summary.overdueValue),
            sub: countSub(summary.overdueCount),
            tone: 'danger',
            icon: TrendingDown,
          },
          { label: 'Pago no mês', value: formatBRL(summary.paidMonth) },
          { label: 'Total em aberto', value: formatBRL(summary.totalOpen) },
        ]}
      />

      {/* Filtros */}
      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>Vencimento</Label>
          <DateRangePicker
            value={dueRange}
            onValueChange={setDueRange}
            clearable
            placeholder="Qualquer período"
          />
        </div>
        <div>
          <Label>Previsão</Label>
          <DateRangePicker
            value={prevRange}
            onValueChange={setPrevRange}
            clearable
            placeholder="Qualquer período"
          />
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

      {/* Atalhos rápidos */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-content-muted">Atalhos:</span>
        {[
          { label: 'Vence hoje', active: dueIsToday, onClick: toggleDueToday },
          { label: 'Previsão hoje', active: prevIsToday, onClick: togglePrevToday },
        ].map((chip) => (
          <button
            key={chip.label}
            type="button"
            aria-pressed={chip.active}
            onClick={chip.onClick}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              chip.active
                ? 'border-brand-600 bg-brand-600/10 text-brand-700 dark:border-brand-500 dark:text-brand-300'
                : 'border-line text-content-secondary hover:bg-neutral-100 dark:hover:bg-neutral-800',
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        loading={isLoading}
        onRowClick={setDetailTarget}
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

      <EditEntryDialog entry={editTarget} onOpenChange={(o) => !o && setEditTarget(null)} />

      <EntryDetailSheet
        entry={detailTarget}
        onOpenChange={(o) => !o && setDetailTarget(null)}
        statusBadge={
          detailTarget &&
          (() => {
            const meta = STATUS_META[effectiveStatus(detailTarget, today)];
            return <StatusDot variant={meta.variant}>{meta.label}</StatusDot>;
          })()
        }
      />
    </div>
  );
}
