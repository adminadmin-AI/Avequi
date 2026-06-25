'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Copy, Info } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type { Boleto, PixCharge, BankAccount, BoletoStatus } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { formatBRL, formatDate } from '@/lib/format';
import {
  BoletoForm,
  PixForm,
  type BoletoFormValues,
  type PixFormValues,
} from './cobranca-forms';

interface Paginated<T> {
  data: T[];
  total: number;
}

const BOLETO_STATUS: Record<BoletoStatus, { label: string; variant: any }> = {
  PENDING: { label: 'Pendente', variant: 'warning' },
  REGISTERED: { label: 'Registrado', variant: 'info' },
  PAID: { label: 'Pago', variant: 'success' },
  CANCELLED: { label: 'Cancelado', variant: 'neutral' },
  OVERDUE: { label: 'Vencido', variant: 'danger' },
  WRITTEN_OFF: { label: 'Baixado', variant: 'neutral' },
};

function Tabs({ tab, setTab }: { tab: string; setTab: (t: string) => void }) {
  const items = [
    { id: 'boletos', label: 'Boletos' },
    { id: 'pix', label: 'PIX Cobrança' },
  ];
  return (
    <div className="mb-5 flex gap-1 border-b border-slate-200">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => setTab(it.id)}
          className={cn(
            'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
            tab === it.id
              ? 'border-brand-600 text-brand-700'
              : 'border-transparent text-slate-500 hover:text-slate-700',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export default function CollectionToolsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState('boletos');
  const [boletoDialog, setBoletoDialog] = useState(false);
  const [pixDialog, setPixDialog] = useState(false);

  const { data: accounts = [] } = useList<BankAccount>('/finance/bank-accounts');

  const boletos = useQuery({
    queryKey: ['/banking/boletos'],
    queryFn: async () => (await apiClient.get<Paginated<Boleto>>('/banking/boletos')).data,
  });
  const pixCharges = useQuery({
    queryKey: ['/banking/pix/charges'],
    queryFn: async () => (await apiClient.get<Paginated<PixCharge>>('/banking/pix/charges')).data,
  });

  const createBoleto = useMutation({
    mutationFn: (v: BoletoFormValues) => apiClient.post('/banking/boletos', v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/banking/boletos'] }),
  });
  const createPix = useMutation({
    mutationFn: (v: PixFormValues) => apiClient.post('/banking/pix/charges', v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/banking/pix/charges'] }),
  });

  function submitBoleto(v: BoletoFormValues) {
    createBoleto.mutate(v, {
      onSuccess: () => {
        toast.success('Boleto gerado');
        setBoletoDialog(false);
      },
      onError: () =>
        toast.error('Falha ao gerar boleto — verifique se a conta tem integração configurada.'),
    });
  }
  function submitPix(v: PixFormValues) {
    createPix.mutate(v, {
      onSuccess: () => {
        toast.success('Cobrança PIX gerada');
        setPixDialog(false);
      },
      onError: () =>
        toast.error('Falha ao gerar PIX — verifique se a conta tem integração configurada.'),
    });
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text);
    toast.success('Copiado!');
  }

  const boletoColumns: Column<Boleto>[] = [
    { key: 'nossoNumero', header: 'Nosso número', cell: (b) => <span className="font-mono text-xs">{b.nossoNumero}</span> },
    { key: 'payerName', header: 'Pagador', cell: (b) => b.payerName },
    {
      key: 'amount',
      header: 'Valor',
      align: 'right',
      sortable: true,
      accessor: (b) => Number(b.amount),
      cell: (b) => <span className="font-medium tabular-nums">{formatBRL(Number(b.amount))}</span>,
    },
    { key: 'dueDate', header: 'Vencimento', cell: (b) => formatDate(b.dueDate) },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      cell: (b) => {
        const m = BOLETO_STATUS[b.status] ?? { label: b.status, variant: 'neutral' };
        return <Badge variant={m.variant}>{m.label}</Badge>;
      },
    },
  ];

  const pixColumns: Column<PixCharge>[] = [
    { key: 'txId', header: 'TxID', cell: (p) => <span className="font-mono text-xs">{p.txId}</span> },
    { key: 'description', header: 'Descrição', cell: (p) => p.description || '—' },
    {
      key: 'amount',
      header: 'Valor',
      align: 'right',
      sortable: true,
      accessor: (p) => Number(p.amount),
      cell: (p) => <span className="font-medium tabular-nums">{formatBRL(Number(p.amount))}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      cell: (p) => <Badge variant={p.status === 'PAID' ? 'success' : 'info'}>{p.status}</Badge>,
    },
    {
      key: 'copy',
      header: 'Copia e cola',
      align: 'right',
      cell: (p) =>
        p.qrCode ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              copy(p.qrCode);
            }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-brand-600 hover:bg-brand-50"
          >
            <Copy size={13} /> Copiar
          </button>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Cobranças — Boleto e PIX"
        description="Emissão e acompanhamento de boletos e cobranças PIX."
        actions={
          tab === 'boletos' ? (
            <Button onClick={() => setBoletoDialog(true)}>
              <Plus size={16} /> Gerar boleto
            </Button>
          ) : (
            <Button onClick={() => setPixDialog(true)}>
              <Plus size={16} /> Gerar PIX
            </Button>
          )
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <Info size={15} className="mt-0.5 shrink-0" />
        <span>
          A emissão real depende de uma <strong>conta bancária com integração configurada</strong>{' '}
          (provedor/credenciais), que ainda não existe no backend. Sem isso, a geração retornará
          erro. O backend também não fornece <strong>linha digitável/PDF do boleto</strong> nem
          imagem de QR Code do PIX (apenas o código copia-e-cola).
        </span>
      </div>

      <Tabs tab={tab} setTab={setTab} />

      {tab === 'boletos' ? (
        <DataTable
          data={boletos.data?.data ?? []}
          columns={boletoColumns}
          loading={boletos.isLoading}
          searchPlaceholder="Buscar por pagador ou nosso número..."
          emptyMessage="Nenhum boleto emitido."
        />
      ) : (
        <DataTable
          data={pixCharges.data?.data ?? []}
          columns={pixColumns}
          loading={pixCharges.isLoading}
          searchPlaceholder="Buscar por descrição ou TxID..."
          emptyMessage="Nenhuma cobrança PIX emitida."
        />
      )}

      <FormDialog
        open={boletoDialog}
        onOpenChange={setBoletoDialog}
        title="Gerar boleto"
        formId="boleto-form"
        submitLabel="Gerar"
        loading={createBoleto.isPending}
      >
        <BoletoForm formId="boleto-form" accounts={accounts} onSubmit={submitBoleto} />
      </FormDialog>

      <FormDialog
        open={pixDialog}
        onOpenChange={setPixDialog}
        title="Gerar cobrança PIX"
        formId="pix-form"
        submitLabel="Gerar"
        loading={createPix.isPending}
      >
        <PixForm formId="pix-form" accounts={accounts} onSubmit={submitPix} />
      </FormDialog>
    </div>
  );
}
