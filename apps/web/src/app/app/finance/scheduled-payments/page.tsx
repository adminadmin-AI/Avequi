'use client';

import { useMemo, useState } from 'react';
import { Plus, Ban } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useList, useCreate, useDelete } from '@/hooks/use-resource';
import type {
  FinancialEntry,
  BankAccount,
  ScheduledPayment,
  ScheduledPaymentStatus,
} from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatBRL, formatDate } from '@/lib/format';
import { ScheduleForm, type ScheduleFormValues } from './schedule-form';

/**
 * Agendamento de Pagamentos (#98) — ligado ao backend (PR #296).
 *  - Lista:    GET    /banking/schedules
 *  - Criar:    POST   /banking/schedule   (valida saldo projetado)
 *  - Cancelar: DELETE /banking/schedule/:id  (apenas PENDING)
 *
 * As rotas de lista (plural) e mutação (singular) divergem, então
 * invalidamos a queryKey da lista manualmente após cada mutação.
 */
const LIST = '/banking/schedules';
const MUTATE = '/banking/schedule';
const OPEN_STATUSES = ['OPEN', 'OVERDUE', 'PARTIALLY_PAID'];

const STATUS_META: Record<ScheduledPaymentStatus, { label: string; variant: any }> = {
  PENDING: { label: 'Agendado', variant: 'info' },
  DONE: { label: 'Pago', variant: 'success' },
  CANCELLED: { label: 'Cancelado', variant: 'neutral' },
  FAILED: { label: 'Falhou', variant: 'danger' },
};

export default function ScheduledPaymentsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const { data: schedules = [], isLoading } = useList<ScheduledPayment>(LIST);

  // Dados REAIS para os seletores do formulário.
  const { data: allPayables = [] } = useList<FinancialEntry>('/finance', { type: 'PAYABLE' });
  const { data: accounts = [] } = useList<BankAccount>('/finance/bank-accounts');
  const openPayables = useMemo(
    () => allPayables.filter((p) => OPEN_STATUSES.includes(p.status)),
    [allPayables],
  );

  const create = useCreate<ScheduledPayment>(MUTATE);
  const remove = useDelete(MUTATE);

  const [dialogOpen, setDialogOpen] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: [LIST] });

  function handleSubmit(values: ScheduleFormValues) {
    const payable = openPayables.find((p) => p.id === values.financialEntryId);
    if (!payable) {
      toast.error('Pagável selecionado não encontrado.');
      return;
    }
    create.mutate(
      {
        financialEntryId: values.financialEntryId,
        bankAccountId: values.bankAccountId,
        scheduledDate: values.scheduledDate,
        amount: Number(payable.amount),
      } as Partial<ScheduledPayment> & { amount: number },
      {
        onSuccess: () => {
          invalidate();
          toast.success('Pagamento agendado');
          setDialogOpen(false);
        },
        onError: (err: any) => {
          const data = err?.response?.data;
          if (data?.code === 'INSUFFICIENT_BALANCE') {
            toast.error(
              `Saldo projetado insuficiente (faltam ${formatBRL(Number(data.shortfall ?? 0))}).`,
            );
          } else {
            toast.error(data?.message ?? 'Erro ao agendar pagamento');
          }
        },
      },
    );
  }

  async function handleCancel(s: ScheduledPayment) {
    const ok = await confirm({
      title: 'Cancelar agendamento?',
      description: `O débito de ${formatBRL(Number(s.amount))} agendado para ${formatDate(s.scheduledDate)} não será mais processado.`,
      confirmLabel: 'Cancelar agendamento',
      variant: 'danger',
    });
    if (!ok) return;
    remove.mutate(s.id, {
      onSuccess: () => {
        invalidate();
        toast.success('Agendamento cancelado');
      },
      onError: (err: any) =>
        toast.error(err?.response?.data?.message ?? 'Erro ao cancelar agendamento'),
    });
  }

  const columns: Column<ScheduledPayment>[] = [
    {
      key: 'entry',
      header: 'Pagável vinculado',
      cell: (s) => (
        <div>
          <p className="text-sm text-content">{s.financialEntry?.description ?? '—'}</p>
          {s.note && <p className="text-xs text-content-muted">{s.note}</p>}
        </div>
      ),
    },
    { key: 'account', header: 'Conta debitada', cell: (s) => s.bankAccount?.name ?? '—' },
    {
      key: 'scheduledDate',
      header: 'Data agendada',
      sortable: true,
      accessor: (s) => s.scheduledDate,
      cell: (s) => formatDate(s.scheduledDate),
    },
    {
      key: 'amount',
      header: 'Valor',
      align: 'right',
      sortable: true,
      accessor: (s) => Number(s.amount),
      cell: (s) => <span className="font-medium tabular-nums">{formatBRL(Number(s.amount))}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      cell: (s) => {
        const m = STATUS_META[s.status];
        return <Badge variant={m.variant}>{m.label}</Badge>;
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (s) =>
        s.status === 'PENDING' ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleCancel(s);
            }}
            title="Cancelar agendamento"
            className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-danger"
          >
            <Ban size={15} />
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Agendamento de Pagamentos"
        description="Programe débitos de contas a pagar em datas futuras."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus size={16} />
            Novo agendamento
          </Button>
        }
      />

      <DataTable
        data={schedules}
        columns={columns}
        loading={isLoading}
        searchPlaceholder="Buscar..."
        emptyMessage="Nenhum agendamento."
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Novo agendamento"
        description="Programe o débito de um pagável em aberto."
        formId="schedule-form"
        submitLabel="Agendar"
        loading={create.isPending}
      >
        <ScheduleForm
          formId="schedule-form"
          payables={openPayables}
          accounts={accounts}
          onSubmit={handleSubmit}
        />
      </FormDialog>
    </div>
  );
}
