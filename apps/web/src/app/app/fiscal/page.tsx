'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Copy, ExternalLink, LayoutDashboard } from 'lucide-react';
import { useList } from '@/hooks/use-resource';
import type { FiscalDocument, FiscalStatus, FiscalDocumentType } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/ui/data-table';
import { useToast } from '@/components/ui/toast';
import { formatDate } from '@/lib/format';
import { FISCAL_STATUS, FISCAL_STATUS_OPTIONS, FISCAL_TYPE_LABEL } from './fiscal-status';
import { EmitNfeDialog } from './emit-nfe-dialog';

const RESOURCE = '/fiscal';

function Kpi({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <Card className={alert ? 'border-red-200 bg-red-50/40' : undefined}>
      <CardContent className="py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tracking-tight ${alert ? 'text-danger' : 'text-slate-900'}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

export default function FiscalPage() {
  const router = useRouter();
  const toast = useToast();

  const { data: docs = [], isLoading } = useList<FiscalDocument>(RESOURCE);

  const [statusFilter, setStatusFilter] = useState<'' | FiscalStatus>('');
  const [typeFilter, setTypeFilter] = useState<'' | FiscalDocumentType>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const kpis = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    let emittedToday = 0,
      authorizedMonth = 0,
      rejectedMonth = 0;
    for (const d of docs) {
      const created = new Date(d.createdAt);
      if (created >= today) emittedToday += 1;
      if (created >= monthStart) {
        if (d.status === 'AUTHORIZED') authorizedMonth += 1;
        if (d.status === 'REJECTED' || d.status === 'ERROR') rejectedMonth += 1;
      }
    }
    return { emittedToday, authorizedMonth, rejectedMonth };
  }, [docs]);

  const filtered = useMemo(() => {
    return docs.filter((d) => {
      if (statusFilter && d.status !== statusFilter) return false;
      if (typeFilter && d.type !== typeFilter) return false;
      if (from && d.createdAt < from) return false;
      if (to && d.createdAt > to + 'T23:59:59') return false;
      return true;
    });
  }, [docs, statusFilter, typeFilter, from, to]);

  function copyChave(chave: string) {
    navigator.clipboard?.writeText(chave);
    toast.success('Chave copiada');
  }

  const columns: Column<FiscalDocument>[] = [
    { key: 'ref', header: 'Ref', cell: (d) => <span className="font-mono text-xs">{d.focusRef ?? '—'}</span> },
    {
      key: 'type',
      header: 'Tipo',
      align: 'center',
      cell: (d) => <Badge variant={d.type === 'NFE' ? 'brand' : 'info'}>{FISCAL_TYPE_LABEL[d.type]}</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (d) => d.status,
      cell: (d) => <Badge variant={FISCAL_STATUS[d.status].variant}>{FISCAL_STATUS[d.status].label}</Badge>,
    },
    {
      key: 'chave',
      header: 'Chave de acesso',
      cell: (d) =>
        d.chave ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              copyChave(d.chave!);
            }}
            className="inline-flex items-center gap-1 font-mono text-xs text-slate-600 hover:text-brand-600"
            title={d.chave}
          >
            …{d.chave.slice(-12)} <Copy size={12} />
          </button>
        ) : (
          '—'
        ),
    },
    {
      key: 'ov',
      header: 'OV',
      cell: (d) =>
        d.salesOrderId ? (
          <Link
            href={`/app/sales/${d.salesOrderId}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-brand-600 hover:underline"
          >
            <ExternalLink size={12} /> {d.salesOrder?.customer?.name ?? 'Ver OV'}
          </Link>
        ) : (
          '—'
        ),
    },
    { key: 'createdAt', header: 'Emissão', sortable: true, accessor: (d) => d.createdAt, cell: (d) => formatDate(d.createdAt) },
  ];

  return (
    <div>
      <PageHeader
        title="Documentos Fiscais"
        description="NF-e e NFC-e emitidas pela empresa."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => router.push('/app/fiscal/dashboard')}>
              <LayoutDashboard size={16} />
              Dashboard
            </Button>
            <EmitNfeDialog />
          </div>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Kpi label="Emitidos hoje" value={String(kpis.emittedToday)} />
        <Kpi label="Autorizados no mês" value={String(kpis.authorizedMonth)} />
        <Kpi label="Rejeitados no mês" value={String(kpis.rejectedMonth)} alert={kpis.rejectedMonth > 0} />
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>Status</Label>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | FiscalStatus)}>
            <option value="">Todos</option>
            {FISCAL_STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Tipo</Label>
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as '' | FiscalDocumentType)}>
            <option value="">Todos</option>
            <option value="NFE">NF-e</option>
            <option value="NFCE">NFC-e</option>
          </Select>
        </div>
        <div>
          <Label>Emissão de</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label>Emissão até</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        loading={isLoading}
        onRowClick={(d) => router.push(`/app/fiscal/${d.id}`)}
        searchPlaceholder="Buscar..."
        emptyMessage="Nenhum documento fiscal encontrado."
      />
    </div>
  );
}
