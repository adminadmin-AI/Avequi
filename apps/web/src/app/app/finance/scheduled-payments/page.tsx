'use client';

import { useMemo, useState } from 'react';
import { Plus, Ban, FlaskConical } from 'lucide-react';
import { useList } from '@/hooks/use-resource';
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
import { formatBRL, formatDate } from '@/lib/format';
import { ScheduleForm, type ScheduleFormValues } from './schedule-form';

/**
 * ⚠️ PREVIEW — backend pendente (issue #241).
 *
 * Esta tela é uma PRÉ-VISUALIZAÇÃO visual do Agendamento de Pagamentos (#98).
 * O backend ainda NÃO expõe o recurso (sem model ScheduledPayment, sem
 * endpoints POST/GET/DELETE /banking/schedule). Por isso:
 *  - A tabela usa dados MOCK (claramente fictícios) só para demonstrar o layout.
 *  - "Novo agendamento" e "Cancelar" NÃO persistem — exibem aviso.
 *
 * Quando o backend existir, basta: (1) trocar MOCK_DATA por
 * useList<ScheduledPayment>('/banking/schedules'); (2) ligar as mutações
 * POST /banking/schedule e DELETE /banking/schedule/:id; (3) remover o banner.
 */
const OPEN_STATUSES = ['OPEN', 'OVERDUE', 'PARTIALLY_PAID'];

const STATUS_META: Record<ScheduledPaymentStatus, { label: string; variant: any }> = {
  PENDING: { label: 'Agendado', variant: 'info' },
  DONE: { label: 'Pago', variant: 'success' },
  CANCELLED: { label: 'Cancelado', variant: 'neutral' },
  FAILED: { label: 'Falhou', variant: 'danger' },
};

const MOCK_DATA: ScheduledPayment[] = [
  {
    id: 'mock-1',
    financialEntryId: 'x',
    bankAccountId: 'y',
    scheduledDate: new Date(Date.now() + 2 * 86400000).toISOString(),
    amount: '4500.00',
    status: 'PENDING',
    financialEntry: { id: 'x', description: 'Aço — lote 42', purchaseOrder: { supplier: { name: 'Metalúrgica Sul' } } },
    bankAccount: { id: 'y', name: 'Bradesco Corrente' },
  },
  {
    id: 'mock-2',
    financialEntryId: 'x2',
    bankAccountId: 'y',
    scheduledDate: new Date(Date.now() + 5 * 86400000).toISOString(),
    amount: '1280.50',
    status: 'PENDING',
    financialEntry: { id: 'x2', description: 'Energia elétrica', purchaseOrder: null },
    bankAccount: { id: 'y', name: 'Bradesco Corrente' },
  },
  {
    id: 'mock-3',
    financialEntryId: 'x3',
    bankAccountId: 'y',
    scheduledDate: new Date(Date.now() - 3 * 86400000).toISOString(),
    amount: '8900.00',
    status: 'DONE',
    financialEntry: { id: 'x3', description: 'Pneus — pedido 118', purchaseOrder: { supplier: { name: 'BorrachaMax' } } },
    bankAccount: { id: 'y', name: 'Bradesco Corrente' },
  },
];

export default function ScheduledPaymentsPage() {
  const toast = useToast();

  // Dados REAIS para os seletores do formulário (esses endpoints existem).
  const { data: allPayables = [] } = useList<FinancialEntry>('/finance', { type: 'PAYABLE' });
  const { data: accounts = [] } = useList<BankAccount>('/finance/bank-accounts');
  const openPayables = useMemo(
    () => allPayables.filter((p) => OPEN_STATUSES.includes(p.status)),
    [allPayables],
  );

  const [dialogOpen, setDialogOpen] = useState(false);

  function handleSubmit(_values: ScheduleFormValues) {
    // Backend pendente (#241): não há endpoint para persistir.
    toast.error('Agendamento indisponível: backend pendente (issue #241).');
    setDialogOpen(false);
  }

  function handleCancel() {
    toast.error('Cancelamento indisponível: backend pendente (issue #241).');
  }

  const columns: Column<ScheduledPayment>[] = [
    {
      key: 'entry',
      header: 'Pagável vinculado',
      cell: (s) => (
        <div>
          <p className="text-sm text-slate-800">{s.financialEntry?.description ?? '—'}</p>
          {s.financialEntry?.purchaseOrder?.supplier?.name && (
            <p className="text-xs text-slate-400">{s.financialEntry.purchaseOrder.supplier.name}</p>
          )}
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
              handleCancel();
            }}
            title="Cancelar agendamento"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-danger"
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

      {/* Banner: deixa explícito que é preview, não funcional */}
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <FlaskConical size={15} className="mt-0.5 shrink-0" />
        <span>
          <strong>Pré-visualização.</strong> O agendamento de pagamentos ainda não tem suporte no
          backend (issue <strong>#241</strong>): não existe o model <code>ScheduledPayment</code> nem
          os endpoints <code>/banking/schedule</code>. A tabela abaixo mostra dados fictícios e as
          ações não persistem. A tela liga automaticamente quando o backend estiver pronto.
        </span>
      </div>

      <DataTable
        data={MOCK_DATA}
        columns={columns}
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
