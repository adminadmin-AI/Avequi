'use client';

import { useState } from 'react';
import { RefreshCw, Info } from 'lucide-react';
import { useList } from '@/hooks/use-resource';
import type { ReconciliationItem } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { cn } from '@/lib/utils';
import { formatBRL, formatDate } from '@/lib/format';

const RESOURCE = '/banking/reconciliation/unmatched';

function num(v: string | null | undefined) {
  return v ? Number(v) : 0;
}

function Tabs({ tab, setTab }: { tab: string; setTab: (t: string) => void }) {
  const items = [
    { id: 'unmatched', label: 'Não identificados' },
    { id: 'pending', label: 'Pendentes (com sugestão)' },
    { id: 'matched', label: 'Conciliados' },
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

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-16 text-center">
      <Info className="text-slate-300" size={32} />
      <p className="max-w-md text-sm text-slate-500">{children}</p>
    </div>
  );
}

export default function ReconciliationPage() {
  const [tab, setTab] = useState('unmatched');
  const { data: items = [], isLoading } = useList<ReconciliationItem>(RESOURCE);

  const columns: Column<ReconciliationItem>[] = [
    { key: 'date', header: 'Data', sortable: true, accessor: (i) => i.date, cell: (i) => formatDate(i.date) },
    { key: 'description', header: 'Descrição do banco', cell: (i) => i.description || '—' },
    { key: 'account', header: 'Conta', cell: (i) => i.bankAccount?.name ?? '—' },
    {
      key: 'type',
      header: 'Tipo',
      align: 'center',
      cell: (i) => {
        const credit = num(i.amount) >= 0;
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
        description="Transações bancárias importadas a conciliar com os lançamentos."
        actions={
          <div className="flex items-center gap-2">
            {tab === 'unmatched' && items.length > 0 && (
              <Badge variant="warning">{items.length} não identificados</Badge>
            )}
            <Button variant="secondary" disabled title="Conciliação automática depende do backend (issue separada)">
              <RefreshCw size={16} />
              Rodar conciliação
            </Button>
          </div>
        }
      />

      <Tabs tab={tab} setTab={setTab} />

      {tab === 'unmatched' && (
        <DataTable
          data={items}
          columns={columns}
          loading={isLoading}
          searchPlaceholder="Buscar por descrição..."
          emptyMessage="Nenhuma transação não identificada."
        />
      )}

      {tab === 'pending' && (
        <Placeholder>
          A aba <strong>Pendentes</strong> (sugestão de match com % de confiança, confirmar/ignorar)
          depende de endpoints de conciliação automática que ainda não existem no backend. Hoje o
          backend só expõe a lista de transações <em>não identificadas</em>.
        </Placeholder>
      )}

      {tab === 'matched' && (
        <Placeholder>
          O histórico de <strong>Conciliados</strong> depende de um endpoint de listagem de itens já
          conciliados que ainda não existe no backend.
        </Placeholder>
      )}
    </div>
  );
}
