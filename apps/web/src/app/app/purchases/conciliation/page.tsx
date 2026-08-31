'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Lightbulb, Layers, Coins } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList, usePagedList } from '@/hooks/use-resource';
import { usePermission } from '@/hooks/use-permission';
import type { Supplier } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatGroup, type StatItem } from '@/components/ui/stat-group';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { DataTable, type Column } from '@/components/ui/data-table';
import { formatBRL, formatCNPJ, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  SPM_RESOURCE,
  PERM_RESOLVE,
  STATUS_META,
  KIND_LABEL,
  FILTER_PRESETS,
  DEFAULT_PAGE_SIZE,
  type BomComponentCoverage,
  type CoverageSummary,
  type FilterPreset,
  type PairView,
  bomCoverageStats,
  bomLabel,
  buildListParams,
  effectiveBomOnly,
  pendingCount,
  primaryActionLabel,
  productLabel,
  rowHighlight,
  sourceLabel,
  unresolvedValue,
} from './conciliation';
import { ResolveDialog } from './resolve-dialog';
import { PairDetailSheet } from './pair-detail-sheet';

/**
 * Conciliação de compras — fila de trabalho (Fase 2, #609, UI V1).
 *
 * Cada linha é um par (fornecedor + cProd) vindo das NF-e recebidas. A pessoa
 * decide, um par por vez: confirma o Product sugerido, escolhe outro, ou
 * classifica como não-produto. A ordem vem do backend (BOM ativa → valor →
 * recorrência) — a UI não reordena.
 *
 * Company: sempre a do usuário logado (JWT). Nenhum companyId sai daqui.
 */
export default function ConciliationPage() {
  const { can, isLoading: permLoading } = usePermission();
  const canResolve = can(PERM_RESOLVE);
  const canListSuppliers = can('suppliers.registry.view');

  // filtros
  const [preset, setPreset] = useState<FilterPreset>('PENDING');
  const [bomOnlyUser, setBomOnlyUser] = useState<boolean | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // busca com debounce (a listagem filtra em memória no servidor; sem spam de requests)
  useEffect(() => {
    const t = setTimeout(() => setQ(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // resumo + cobertura de BOM (métricas do backend, sem recálculo aqui)
  const summaryQ = useQuery({
    queryKey: [SPM_RESOURCE, 'summary'],
    queryFn: async () => (await apiClient.get<CoverageSummary>(`${SPM_RESOURCE}/summary`)).data,
  });
  const coverageQ = useQuery({
    queryKey: [SPM_RESOURCE, 'bom-coverage'],
    queryFn: async () => (await apiClient.get<BomComponentCoverage[]>(`${SPM_RESOURCE}/bom-coverage`)).data,
  });

  const bomOnly = effectiveBomOnly(bomOnlyUser, coverageQ.data);
  const coverage = bomCoverageStats(coverageQ.data);

  const params = useMemo(
    () => buildListParams({ preset, bomOnly, supplierId, q }, page, pageSize),
    [preset, bomOnly, supplierId, q, page, pageSize],
  );
  const listQ = usePagedList<PairView>(SPM_RESOURCE, params, { placeholderData: (prev) => prev });

  const { data: suppliers = [] } = useList<Supplier>('/suppliers', undefined, { enabled: canListSuppliers });

  // seleção / diálogos
  const [detail, setDetail] = useState<PairView | null>(null);
  const [resolving, setResolving] = useState<PairView | null>(null);

  function resetPage() {
    setPage(1);
  }

  const stats: StatItem[] = [
    { label: 'Pendentes', value: String(pendingCount(summaryQ.data)), icon: AlertTriangle, tone: pendingCount(summaryQ.data) > 0 ? 'warning' : 'neutral', sub: summaryQ.data ? `${summaryQ.data.pendingBomRelevant} ligados a BOM ativa` : undefined },
    { label: 'Com sugestão', value: String(summaryQ.data?.byStatus.SUGGESTED ?? 0), icon: Lightbulb, tone: 'info' },
    {
      label: 'Componentes de BOM cobertos',
      value: coverageQ.data ? `${coverage.covered}/${coverage.total}` : '—',
      icon: Layers,
      tone: coverage.pending > 0 ? 'danger' : 'success',
      sub: coverage.total === 0 ? 'sem BOM ativa com componente comprado' : 'confirmados / comprados em BOM ativa',
    },
    {
      label: 'Valor comprado sem decisão',
      value: formatBRL(unresolvedValue(summaryQ.data)),
      icon: Coins,
      tone: 'neutral',
      sub: summaryQ.data ? `${summaryQ.data.resolvedValuePct.toFixed(1)}% resolvido · faltam ${summaryQ.data.pairsToReachTarget} pares p/ ${summaryQ.data.targetPct}%` : undefined,
    },
  ];

  const columns: Column<PairView>[] = [
    {
      key: 'item',
      header: 'Item do fornecedor',
      cell: (r) => {
        const h = rowHighlight(r);
        return (
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs text-content">{r.supplierProductCode}</span>
              {h === 'BLOCKS_BOM' && (
                <Badge variant="danger" dot>
                  Bloqueia BOM
                </Badge>
              )}
            </p>
            <p className="truncate text-sm text-content" title={r.lastDescription ?? undefined}>
              {r.lastDescription ?? '—'}
            </p>
            <p className="text-xs text-content-muted">
              {r.lastNcm ? `NCM ${r.lastNcm}` : 'sem NCM'}
              {r.lastUnit ? ` · ${r.lastUnit}` : ''}
              {r.descriptionVariants > 1 ? ` · ${r.descriptionVariants} descrições` : ''}
            </p>
          </div>
        );
      },
    },
    {
      key: 'supplier',
      header: 'Fornecedor',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-content">{r.supplierName ?? '—'}</p>
          {r.supplierCnpj && <p className="font-mono text-xs text-content-muted">{formatCNPJ(r.supplierCnpj)}</p>}
        </div>
      ),
    },
    {
      key: 'purchases',
      header: 'Compras',
      align: 'right',
      cell: (r) => (
        <div className="text-right">
          <p className="font-medium tabular-nums">{formatBRL(r.totalValue)}</p>
          <p className="text-xs text-content-muted tabular-nums">
            {r.documentCount} nota{r.documentCount === 1 ? '' : 's'}
          </p>
        </div>
      ),
    },
    {
      key: 'last',
      header: 'Última',
      align: 'right',
      cell: (r) => (
        <div className="text-right">
          <p className="text-sm tabular-nums">{r.lastPurchaseAt ? formatDate(r.lastPurchaseAt) : '—'}</p>
          <p className="text-xs text-content-muted tabular-nums">{r.lastUnitPrice != null ? `${formatBRL(r.lastUnitPrice)}/un` : ''}</p>
        </div>
      ),
    },
    {
      key: 'bom',
      header: 'BOM',
      cell: (r) => {
        const label = bomLabel(r.bomRelevance);
        if (!label) return <span className="text-xs text-content-muted">—</span>;
        return (
          <span
            className={cn('whitespace-nowrap text-xs', r.priorityTier === 0 ? 'font-medium text-danger' : 'text-content-secondary')}
            title={r.bomRelevance?.via === 'SUGGESTED' ? 'Relevância pela sugestão (ainda não confirmada)' : 'Relevância pelo Product confirmado'}
          >
            {label}
            {r.bomRelevance?.via === 'SUGGESTED' && <span className="text-content-muted">*</span>}
          </span>
        );
      },
    },
    {
      key: 'decision',
      header: 'Situação',
      cell: (r) => (
        <div className="min-w-0 space-y-0.5">
          <Badge variant={STATUS_META[r.status].variant}>{STATUS_META[r.status].label}</Badge>
          {r.canonical && (
            <p className="truncate text-xs text-content" title="Decisão confirmada">
              {r.canonical.kind === 'PRODUCT' ? productLabel(r.canonical.productSku, r.canonical.productName) : KIND_LABEL[r.canonical.kind]}
            </p>
          )}
          {r.suggestion && r.status !== 'CONFIRMED' && (
            <p className="truncate text-xs text-info" title={sourceLabel(r.suggestion.source) ?? undefined}>
              Sugestão:{' '}
              {r.suggestion.productId ? productLabel(r.suggestion.productSku, r.suggestion.productName) : r.suggestion.kind ? KIND_LABEL[r.suggestion.kind] : '—'}
            </p>
          )}
          {r.status === 'REVIEW' && r.reviewReason && <p className="truncate text-xs text-warning">{r.reviewReason}</p>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          {canResolve ? (
            <Button
              type="button"
              size="xs"
              variant={r.needsDecision ? 'primary' : 'outline'}
              onClick={(e) => {
                e.stopPropagation();
                setResolving(r);
              }}
            >
              {primaryActionLabel(r)}
            </Button>
          ) : (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                setDetail(r);
              }}
            >
              Ver
            </Button>
          )}
        </div>
      ),
    },
  ];

  const total = listQ.data?.total ?? 0;
  const items = listQ.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Conciliação de compras"
        description="Cada item comprado do fornecedor vira um Product do catálogo (ou é classificado como consumo, ativo ou frete). Decisão humana, um item por vez, com histórico."
      />

      <StatGroup stats={stats} loading={summaryQ.isLoading || coverageQ.isLoading} className="mb-5" />

      {!permLoading && !canResolve && (
        <p className="mb-3 text-xs text-content-muted">Você pode consultar a fila; confirmar ou classificar itens exige a permissão de resolução.</p>
      )}

      {/* filtros */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0">
            <Label>Situação</Label>
            {/* rola dentro do próprio controle em telas estreitas — a página nunca ganha scroll horizontal */}
            <div className="max-w-full overflow-x-auto">
              <SegmentedControl
                options={FILTER_PRESETS}
                value={preset}
                onValueChange={(v) => {
                  setPreset(v);
                  resetPage();
                }}
                size="sm"
              />
            </div>
          </div>
          <div className="min-w-[220px]">
            <Label>Fornecedor</Label>
            <Select
              value={supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value);
                resetPage();
              }}
              disabled={!canListSuppliers}
            >
              <option value="">Todos</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.cnpj ? ` · ${s.cnpj}` : ''}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <Toggle
          size="sm"
          checked={bomOnly}
          disabled={coverage.total === 0 && !bomOnly}
          onCheckedChange={(v) => {
            setBomOnlyUser(v);
            resetPage();
          }}
          label={
            <span className={cn('text-sm', bomOnly ? 'text-content' : 'text-content-secondary')}>
              Só o que bloqueia custo de BOM
              {coverage.total > 0 && <span className="text-content-muted"> · {coverage.pending} componente{coverage.pending === 1 ? '' : 's'} sem par confirmado</span>}
            </span>
          }
        />
      </div>

      {listQ.isError ? (
        <ErrorState title="Não foi possível carregar a fila" error={listQ.error} onRetry={() => listQ.refetch()} />
      ) : (
        <DataTable
          data={items}
          columns={columns}
          loading={listQ.isLoading}
          rowKey={(r) => `${r.supplierId}::${r.supplierProductCode}`}
          onRowClick={(r) => setDetail(r)}
          serverMode
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            resetPage();
          }}
          searchValue={search}
          onSearchChange={(v) => {
            setSearch(v);
            resetPage();
          }}
          searchPlaceholder="Buscar por cProd, descrição ou fornecedor..."
          viewOptions={false}
          empty={
            <EmptyState
              icon={Layers}
              title={bomOnly ? 'Nada bloqueando BOM neste filtro' : 'Nenhum item neste filtro'}
              description={bomOnly ? 'Desligue "Só o que bloqueia custo de BOM" para ver o restante da fila.' : 'Ajuste os filtros ou a busca.'}
              compact
            />
          }
        />
      )}

      <PairDetailSheet
        row={detail}
        canResolve={canResolve}
        onOpenChange={(o) => !o && setDetail(null)}
        onResolve={(r) => {
          setDetail(null);
          setResolving(r);
        }}
      />

      <ResolveDialog row={resolving} onOpenChange={(o) => !o && setResolving(null)} />
    </div>
  );
}
