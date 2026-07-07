'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Download, Loader2, Users2, X } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { SOURCE_LABEL, StageRef } from '../inbox/inbox-types';

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
    setSelected((s) => (s.size === items.length ? new Set() : new Set(items.map((l) => l.id))));
  }

  function toggle(id: string) {
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

  const changeStage = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post('/crm/leads/bulk/stage', {
          leadIds: [...selected],
          stageId: bulkStage,
          ...(bulkStageIsLost ? { lostReason: lostReason.trim() } : {}),
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
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
          placeholder="Buscar nome/telefone/email..."
          value={filters.search}
          onChange={(e) => setFilter('search', e.target.value)}
        />
        <select
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
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
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
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
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
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
        <input
          type="date"
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
          value={filters.from}
          onChange={(e) => setFilter('from', e.target.value)}
        />
        <div className="flex gap-1">
          <input
            type="date"
            className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
            value={filters.to}
            onChange={(e) => setFilter('to', e.target.value)}
          />
          <Button variant="secondary" size="sm" onClick={exportCsv} title="Exportar CSV">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Barra de ações em lote */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2 text-sm">
          <Badge variant="neutral">{selected.size} selecionado(s)</Badge>
          <select
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
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
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
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
            <input
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
              placeholder="Motivo da perda (obrigatório)"
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
            />
          )}
          <Button
            size="sm"
            disabled={!bulkStage || (bulkStageIsLost && !lostReason.trim()) || changeStage.isPending}
            onClick={() => changeStage.mutate()}
          >
            {changeStage.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Aplicar
          </Button>
          <button className="ml-auto p-1" onClick={() => setSelected(new Set())} aria-label="Limpar seleção">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Tabela */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2">
                <input
                  type="checkbox"
                  checked={items.length > 0 && selected.size === items.length}
                  onChange={toggleAll}
                  aria-label="Selecionar todos"
                />
              </th>
              <SortableTh label="Nome" col="name" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
              <th className="p-2">Telefone</th>
              <th className="p-2">Origem</th>
              <th className="p-2">Estágio</th>
              <th className="p-2">Vendedor</th>
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
          <tbody className="divide-y">
            {items.map((l) => (
              <tr key={l.id} className={`hover:bg-muted/30 ${selected.has(l.id) ? 'bg-muted/40' : ''}`}>
                <td className="p-2">
                  <input
                    type="checkbox"
                    checked={selected.has(l.id)}
                    onChange={() => toggle(l.id)}
                    aria-label={`Selecionar ${l.name ?? l.phone}`}
                  />
                </td>
                <td className="max-w-48 truncate p-2 font-medium">{l.name ?? '—'}</td>
                <td className="p-2 tabular-nums">{l.phone ?? '—'}</td>
                <td className="p-2">{SOURCE_LABEL[l.source] ?? l.source}</td>
                <td className="p-2">
                  {l.stage && (
                    <Badge variant={l.stage.type === 'WON' ? 'success' : l.stage.type === 'LOST' ? 'warning' : 'neutral'}>
                      {l.stage.name}
                    </Badge>
                  )}
                </td>
                <td className="max-w-32 truncate p-2">{l.assignedTo?.name ?? '—'}</td>
                <td className="p-2 tabular-nums">
                  {l.estimatedValue
                    ? Number(l.estimatedValue).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                    : '—'}
                </td>
                <td className="p-2 text-xs text-muted-foreground">
                  {new Date(l.createdAt).toLocaleDateString('pt-BR')}
                </td>
                <td className="p-2 text-xs text-muted-foreground">
                  {l.lastInteractionAt ? new Date(l.lastInteractionAt).toLocaleDateString('pt-BR') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isLoading && (
          <div className="flex justify-center p-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!isLoading && items.length === 0 && (
          <EmptyState icon={Users2} title="Nenhum lead" description="Ajuste os filtros ou aguarde novas captações." />
        )}
      </div>

      {/* Paginação */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total} lead(s) · página {page} de {pages}
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Próxima
          </Button>
        </div>
      </div>
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
  return (
    <th className="cursor-pointer select-none p-2 hover:text-foreground" onClick={() => onSort(col)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {sortBy === col &&
          (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </span>
    </th>
  );
}
