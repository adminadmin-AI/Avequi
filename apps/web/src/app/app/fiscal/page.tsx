'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Copy, ExternalLink, FileDown, LayoutDashboard, Ban } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type { FiscalDocument, FiscalStatus, FiscalDocumentType, FiscalFinalidade } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { DateRangePicker, dateToISO, isoToDate } from '@/components/ui/date-picker';
import { DataTable, type Column } from '@/components/ui/data-table';
import { StatGroup } from '@/components/ui/stat-group';
import { useToast } from '@/components/ui/toast';
import { Can } from '@/components/can';
import { formatDate } from '@/lib/format';
import { erroDeAcao } from '@/lib/feedback';
import { FISCAL_STATUS, FISCAL_STATUS_OPTIONS, FISCAL_TYPE_LABEL, FISCAL_FINALIDADE_LABEL, FISCAL_FINALIDADE_FILTER_OPTIONS } from './fiscal-status';
import { EmitNfeDialog } from './emit-nfe-dialog';
import { VoidRangeDialog } from './void-range-dialog';

const RESOURCE = '/fiscal';

export default function FiscalPage() {
  const router = useRouter();
  const toast = useToast();

  const { data: docs = [], isLoading } = useList<FiscalDocument>(RESOURCE);

  const [statusFilter, setStatusFilter] = useState<'' | FiscalStatus>('');
  const [typeFilter, setTypeFilter] = useState<'' | FiscalDocumentType>('');
  // #758 — filtro por finalidade (Reforma Tributária: devolução/débito/crédito)
  const [finalidadeFilter, setFinalidadeFilter] = useState<'' | FiscalFinalidade>('');
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
      if (finalidadeFilter && d.finalidade !== finalidadeFilter) return false;
      if (from && d.createdAt < from) return false;
      if (to && d.createdAt > to + 'T23:59:59') return false;
      return true;
    });
  }, [docs, statusFilter, typeFilter, finalidadeFilter, from, to]);

  function copyChave(chave: string) {
    navigator.clipboard?.writeText(chave);
    toast.success('Chave copiada');
  }

  const [voidRangeOpen, setVoidRangeOpen] = useState(false);

  // #482 — ZIP com os XMLs do período filtrado (default: mês corrente) p/ o contador
  const [exporting, setExporting] = useState(false);
  async function exportXmls() {
    const now = new Date();
    const f = from || dateToISO(new Date(now.getFullYear(), now.getMonth(), 1));
    const t = to || dateToISO(now);
    setExporting(true);
    try {
      const res = await apiClient.get('/fiscal/export', {
        params: { from: f, to: t, ...(typeFilter && { type: typeFilter }) },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `xmls-nfe-${f}_${t}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('XMLs exportados');
    } catch (err: any) {
      if (err?.response?.status === 404) {
        toast.error('Nenhum XML no período selecionado');
      } else {
        toast.error(erroDeAcao('exportar os XMLs', err));
      }
    } finally {
      setExporting(false);
    }
  }

  const columns: Column<FiscalDocument>[] = [
    { key: 'ref', header: 'Ref', cell: (d) => <span className="font-mono text-xs">{d.focusRef ?? '—'}</span> },
    {
      key: 'number',
      header: 'Nº / Série',
      sortable: true,
      accessor: (d) => d.number ?? 0,
      cell: (d) => (d.number != null ? <span className="font-mono text-xs">{d.number}/{d.series ?? 1}</span> : '—'),
    },
    {
      key: 'type',
      header: 'Tipo',
      align: 'center',
      cell: (d) => (
        <div className="flex items-center justify-center gap-1.5">
          <Badge variant={d.type === 'NFE' ? 'brand' : 'info'}>{FISCAL_TYPE_LABEL[d.type]}</Badge>
          {/* #758 — badge de finalidade só quando ≠ NORMAL (venda comum não precisa de destaque) */}
          {d.finalidade && d.finalidade !== 'NORMAL' && (
            <Badge variant={FISCAL_FINALIDADE_LABEL[d.finalidade].variant}>
              {FISCAL_FINALIDADE_LABEL[d.finalidade].label}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (d) => d.status,
      cell: (d) => <StatusDot variant={FISCAL_STATUS[d.status].variant}>{FISCAL_STATUS[d.status].label}</StatusDot>,
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
            className="inline-flex items-center gap-1 font-mono text-xs text-content-secondary hover:text-brand-600 dark:hover:text-brand-400"
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
            className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 hover:underline"
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
        title="Documentos fiscais"
        description="NF-e e NFC-e emitidas pela empresa."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={exportXmls}
              loading={exporting}
              title="Baixa um ZIP com os XMLs do período filtrado (default: mês corrente)"
            >
              <FileDown size={16} />
              Exportar XMLs
            </Button>
            <Button variant="secondary" onClick={() => router.push('/app/fiscal/dashboard')}>
              <LayoutDashboard size={16} />
              Dashboard
            </Button>
            {/* #758 (extra) — inutilização de faixa de numeração */}
            <Can permission="fiscal.nfe.void-range">
              <Button variant="secondary" onClick={() => setVoidRangeOpen(true)}>
                <Ban size={16} />
                Inutilizar numeração
              </Button>
            </Can>
            <EmitNfeDialog />
          </div>
        }
      />

      <StatGroup
        className="mb-6"
        stats={[
          { label: 'Emitidos hoje', value: String(kpis.emittedToday) },
          { label: 'Autorizados no mês', value: String(kpis.authorizedMonth) },
          {
            label: 'Rejeitados no mês',
            value: String(kpis.rejectedMonth),
            tone: kpis.rejectedMonth > 0 ? 'danger' : 'neutral',
          },
        ]}
      />

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>Status</Label>
          <Select aria-label="Filtrar por status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | FiscalStatus)}>
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
          <Select aria-label="Filtrar por tipo" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as '' | FiscalDocumentType)}>
            <option value="">Todos</option>
            <option value="NFE">NF-e</option>
            <option value="NFCE">NFC-e</option>
          </Select>
        </div>
        <div>
          <Label>Finalidade</Label>
          <Select
            aria-label="Filtrar por finalidade"
            value={finalidadeFilter}
            onChange={(e) => setFinalidadeFilter(e.target.value as '' | FiscalFinalidade)}
          >
            <option value="">Todas</option>
            {FISCAL_FINALIDADE_FILTER_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[260px]">
          <Label>Período de emissão</Label>
          <DateRangePicker
            value={from || to ? { from: isoToDate(from), to: isoToDate(to) } : undefined}
            onValueChange={(r) => {
              setFrom(dateToISO(r?.from));
              setTo(dateToISO(r?.to));
            }}
            clearable
          />
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

      <VoidRangeDialog open={voidRangeOpen} onOpenChange={setVoidRangeOpen} />
    </div>
  );
}
