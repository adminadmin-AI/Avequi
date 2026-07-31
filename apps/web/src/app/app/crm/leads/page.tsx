'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Download,
  Loader2,
  ShieldOff,
  Users2,
  X,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DateRangePicker, dateToISO, isoToDate } from '@/components/ui/date-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { SOURCE_LABEL, StageRef } from '../inbox/inbox-types';
import { LOST_REASON_OPTIONS, type LostReasonCategory } from '@/lib/crm-lost-reasons';

interface LeadRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  source: string;
  interest: string | null;
  estimatedValue: string | null;
  lostReason: string | null;
  createdAt: string;
  lastInteractionAt: string | null;
  stage: { id: string; name: string; type: string; color: string | null } | null;
  assignedTo: { id: string; name: string } | null;
  salesOrderId: string | null;
}

interface Seller {
  id: string;
  name: string;
}

type SortBy = 'createdAt' | 'name' | 'lastInteractionAt' | 'estimatedValue';

const PAGE_SIZE = 25;

// Casca convergida ao <DataTable> (F3 — visual only; engine server-side intacto)
const CHECKBOX_CLASS = 'h-4 w-4 cursor-pointer rounded border-line accent-brand-600';
const NAV_BTN = 'rounded-md p-1.5 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800';

/**
 * Lista de leads em tabela (F3.5-C7 #557) — a visão que o kanban não dá:
 * "leads do Meta em Proposta este mês" → filtra, seleciona, age em lote, exporta.
 */
export default function LeadListPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState({
    search: '',
    source: '',
    stageId: '',
    assignedToId: '',
    from: '',
    to: '',
  });
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<SortBy>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStage, setBulkStage] = useState('');
  const [bulkSeller, setBulkSeller] = useState('');
  const [lostReason, setLostReason] = useState('');
  const [lostCategory, setLostCategory] = useState<LostReasonCategory | ''>('');
  const [confirmLgpd, setConfirmLgpd] = useState(false);

  const params = useMemo(
    () => ({
      ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortBy,
      sortDir,
    }),
    [filters, page, sortBy, sortDir],
  );

  const { data, isLoading } = useQuery<{ items: LeadRow[]; total: number }>({
    queryKey: ['crm-lead-list', params],
    queryFn: async () => (await apiClient.get('/crm/leads', { params })).data,
  });
  const { data: stages = [] } = useQuery<StageRef[]>({
    queryKey: ['crm-stages'],
    queryFn: async () => (await apiClient.get('/crm/stages')).data,
    staleTime: 5 * 60_000,
  });
  const { data: sellers = [] } = useQuery<Seller[]>({
    queryKey: ['crm-sellers'],
    queryFn: async () => (await apiClient.get('/crm/settings/sellers')).data,
    staleTime: 5 * 60_000,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  const bulkStageIsLost = stages.find((s) => s.id === bulkStage)?.type === 'LOST';

  function setFilter(key: keyof typeof filters, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
    setSelected(new Set());
  }

  function toggleSort(col: SortBy) {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(col);
      setSortDir('desc');
    }
  }

  function toggleAll() {
    setConfirmLgpd(false); // seleção mudou → refaz a confirmação da LGPD
    setSelected((s) => (s.size === items.length ? new Set() : new Set(items.map((l) => l.id))));
  }

  function toggle(id: string) {
    setConfirmLgpd(false);
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const afterBulk = (res: { ok: number; failed: number }) => {
    queryClient.invalidateQueries({ queryKey: ['crm-lead-list'] });
    setSelected(new Set());
    setBulkStage('');
    setBulkSeller('');
    setLostReason('');
    if (res.failed > 0) toast.error(`${res.ok} ok, ${res.failed} falharam`);
    else toast.success(`${res.ok} lead(s) atualizados`);
  };

  const reassign = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post('/crm/leads/bulk/reassign', {
          leadIds: [...selected],
          toUserId: bulkSeller,
        })
      ).data,
    onSuccess: afterBulk,
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Falha na reatribuição'),
  });

  // LGPD (#558): anonimização a pedido do titular — irreversível, 2 passos
  const anonymize = useMutation({
    mutationFn: async () => {
      let ok = 0;
      let failed = 0;
      for (const id of selected) {
        try {
          await apiClient.post(`/crm/leads/${id}/anonymize`);
          ok++;
        } catch {
          failed++;
        }
      }
      return { ok, failed };
    },
    onSuccess: (res) => {
      setConfirmLgpd(false);
      afterBulk(res);
    },
  });

  const changeStage = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post('/crm/leads/bulk/stage', {
          leadIds: [...selected],
          stageId: bulkStage,
          ...(bulkStageIsLost
            ? {
                lostReasonCategory: lostCategory,
                ...(lostReason.trim() ? { lostReason: lostReason.trim() } : {}),
              }
            : {}),
        })
      ).data,
    onSuccess: afterBulk,
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Falha na mudança de estágio'),
  });

  async function exportCsv() {
    const res = await apiClient.get('/crm/leads.csv', {
      params: Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
      responseType: 'blob',
    });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'crm-leads.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Leads" description="Tabela filtrável: busca em massa, ações em lote e export" />

      {/* Filtros */}
      <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-3 lg:grid-cols-6">
        <input
          className="rounded-md border bg-surface px-2 py-1.5 text-sm"
          placeholder="Buscar nome/telefone/email..."
          value={filters.search}
          onChange={(e) => setFilter('search', e.target.value)}
        />
        <select
          className="rounded-md border bg-surface px-2 py-1.5 text-sm"
          value={filters.source}
          onChange={(e) => setFilter('source', e.target.value)}
        >
          <option value="">Todas as origens</option>
          {Object.entries(SOURCE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border bg-surface px-2 py-1.5 text-sm"
          value={filters.stageId}
          onChange={(e) => setFilter('stageId', e.target.value)}
        >
          <option value="">Todos os estágios</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border bg-surface px-2 py-1.5 text-sm"
          value={filters.assignedToId}
          onChange={(e) => setFilter('assignedToId', e.target.value)}
        >
          <option value="">Todos os vendedores</option>
          {sellers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {/* Período de criação (padrão #881): um campo, calendário de 2 cliques */}
        <div className="flex gap-1 sm:col-span-2">
          <DateRangePicker
            className="h-auto min-w-0 flex-1 px-2 py-1.5 text-sm"
            value={{ from: isoToDate(filters.from), to: isoToDate(filters.to) }}
            onValueChange={(r) => {
              setFilter('from', dateToISO(r?.from));
              setFilter('to', dateToISO(r?.to));
            }}
            clearable
            placeholder="Qualquer período"
          />
          <Button variant="secondary" size="sm" onClick={exportCsv} title="Exportar CSV">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Barra de ações em lote */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-600/30 bg-brand-600/10 px-4 py-2.5 text-sm">
          <span className="font-medium text-brand-700 dark:text-brand-300">
            {selected.size} selecionado{selected.size === 1 ? '' : 's'}
          </span>
          <select
            className="rounded-md border bg-surface px-2 py-1.5 text-sm"
            value={bulkSeller}
            onChange={(e) => setBulkSeller(e.target.value)}
          >
            <option value="">Reatribuir para...</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={!bulkSeller || reassign.isPending} onClick={() => reassign.mutate()}>
            {reassign.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Reatribuir
          </Button>
          <select
            className="rounded-md border bg-surface px-2 py-1.5 text-sm"
            value={bulkStage}
            onChange={(e) => setBulkStage(e.target.value)}
          >
            <option value="">Mudar estágio para...</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {bulkStageIsLost && (
            <>
              <select
                className="rounded-md border bg-surface px-2 py-1.5 text-sm"
                value={lostCategory}
                onChange={(e) => setLostCategory(e.target.value as LostReasonCategory | '')}
              >
                <option value="">Categoria da perda…</option>
                {LOST_REASON_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                className="rounded-md border bg-surface px-2 py-1.5 text-sm"
                placeholder="Detalhe opcional"
                value={lostReason}
                maxLength={300}
                onChange={(e) => setLostReason(e.target.value)}
              />
            </>
          )}
          <Button
            size="sm"
            disabled={!bulkStage || (bulkStageIsLost && !lostCategory) || changeStage.isPending}
            onClick={() => changeStage.mutate()}
          >
            {changeStage.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Aplicar
          </Button>
          <Button
            size="sm"
            variant={confirmLgpd ? 'danger' : 'ghost'}
            title="LGPD: apaga nome/telefone/conversa; preserva métricas agregadas. Irreversível."
            disabled={anonymize.isPending}
            onClick={() => (confirmLgpd ? anonymize.mutate() : setConfirmLgpd(true))}
          >
            {anonymize.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldOff className="mr-1 h-3.5 w-3.5" />
            )}
            {confirmLgpd ? `Confirmar anonimização (${selected.size})` : 'Anonimizar LGPD'}
          </Button>
          {confirmLgpd && (
            <Button size="sm" variant="ghost" onClick={() => setConfirmLgpd(false)}>
              Cancelar
            </Button>
          )}
          <button
            className="ml-auto rounded-md p-1 text-content-muted transition-colors hover:text-content"
            onClick={() => setSelected(new Set())}
            aria-label="Limpar seleção"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Tabela */}
      <div className="avequi-scroll surface-sheen shadow-soft max-h-[70vh] overflow-auto rounded-xl bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="sticky top-0 z-10 w-10 bg-surface px-5 py-3.5">
                <input
                  type="checkbox"
                  className={CHECKBOX_CLASS}
                  checked={items.length > 0 && selected.size === items.length}
                  onChange={toggleAll}
                  aria-label="Selecionar todos"
                />
              </th>
              <SortableTh label="Nome" col="name" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
              <th className="sticky top-0 z-10 bg-surface px-5 py-3 text-left text-xs font-medium text-content-muted">
                Telefone
              </th>
              <th className="sticky top-0 z-10 bg-surface px-5 py-3 text-left text-xs font-medium text-content-muted">
                Origem
              </th>
              <th className="sticky top-0 z-10 bg-surface px-5 py-3 text-left text-xs font-medium text-content-muted">
                Estágio
              </th>
              <th className="sticky top-0 z-10 bg-surface px-5 py-3 text-left text-xs font-medium text-content-muted">
                Vendedor
              </th>
              <SortableTh label="Valor" col="estimatedValue" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
              <SortableTh label="Criado" col="createdAt" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
              <SortableTh
                label="Últ. interação"
                col="lastInteractionAt"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={toggleSort}
              />
            </tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <tr
                key={l.id}
                className={cn(
                  'border-quiet border-b transition-colors duration-micro last:border-0 hover:bg-neutral-500/[0.04]',
                  selected.has(l.id) && 'bg-brand-600/10',
                )}
              >
                <td className="w-10 px-4">
                  <input
                    type="checkbox"
                    className={CHECKBOX_CLASS}
                    checked={selected.has(l.id)}
                    onChange={() => toggle(l.id)}
                    aria-label={`Selecionar ${l.name ?? l.phone}`}
                  />
                </td>
                <td className="max-w-48 truncate px-4 py-3.5 font-medium">{l.name ?? '—'}</td>
                <td className="px-4 py-3.5 tabular-nums">{l.phone ?? '—'}</td>
                <td className="px-4 py-3.5">{SOURCE_LABEL[l.source] ?? l.source}</td>
                <td className="px-4 py-3.5">
                  {l.stage && (
                    <Badge variant={l.stage.type === 'WON' ? 'success' : l.stage.type === 'LOST' ? 'warning' : 'neutral'}>
                      {l.stage.name}
                    </Badge>
                  )}
                </td>
                <td className="max-w-32 truncate px-4 py-3.5">{l.assignedTo?.name ?? '—'}</td>
                <td className="px-4 py-3.5 tabular-nums">
                  {l.estimatedValue
                    ? Number(l.estimatedValue).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                    : '—'}
                </td>
                <td className="px-4 py-3.5 text-xs text-content-muted">
                  {new Date(l.createdAt).toLocaleDateString('pt-BR')}
                </td>
                <td className="px-4 py-3.5 text-xs text-content-muted">
                  {l.lastInteractionAt ? new Date(l.lastInteractionAt).toLocaleDateString('pt-BR') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isLoading && (
          <div className="flex justify-center p-8">
            <Loader2 className="h-5 w-5 animate-spin text-content-muted" />
          </div>
        )}
        {!isLoading && items.length === 0 && (
          <EmptyState icon={Users2} title="Nenhum lead" description="Ajuste os filtros ou aguarde novas captações." />
        )}
      </div>

      {/* Paginação (server-side: page/PAGE_SIZE fixos; casca visual = DataTable) */}
      {total > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-content-secondary">
          <span>
            Mostrando {from}–{to} de {total}
          </span>
          {pages > 1 && (
            <div className="ml-auto flex items-center gap-1">
              <button onClick={() => setPage(1)} disabled={page <= 1} aria-label="Primeira página" className={NAV_BTN}>
                <ChevronsLeft size={16} />
              </button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="Página anterior"
                className={NAV_BTN}
              >
                <ChevronLeft size={16} />
              </button>
              <span className="px-2 tabular-nums">
                {page} / {pages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page >= pages}
                aria-label="Próxima página"
                className={NAV_BTN}
              >
                <ChevronRight size={16} />
              </button>
              <button onClick={() => setPage(pages)} disabled={page >= pages} aria-label="Última página" className={NAV_BTN}>
                <ChevronsRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SortableTh({
  label,
  col,
  sortBy,
  sortDir,
  onSort,
}: {
  label: string;
  col: SortBy;
  sortBy: SortBy;
  sortDir: 'asc' | 'desc';
  onSort: (col: SortBy) => void;
}) {
  const active = sortBy === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={cn(
        'group/th sticky top-0 z-10 cursor-pointer select-none bg-surface px-5 py-3 text-left text-xs font-medium text-content-muted hover:text-content-secondary',
        active && 'text-brand-600 dark:text-brand-400',
      )}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {!active ? (
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-0 transition-opacity duration-micro group-hover/th:opacity-40" />
        ) : sortDir === 'asc' ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </span>
    </th>
  );
}
