'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Check,
  Download,
  MoreVertical,
  Search,
  SearchX,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from './input';
import { Skeleton } from './skeleton';
import { EmptyState } from './empty-state';
import { Button } from './button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './dropdown-menu';

/**
 * DataTable enterprise — F2.4 (#310)
 *
 * Novos recursos (todos opt-in — API 100% compatível com as telas atuais):
 *  - `selectable` + `bulkActions`: checkbox por linha, select-all da página,
 *    "selecionar todos os N filtrados" e barra de ações em massa
 *  - `rowActions`: menu ⋮ por linha (Editar/Excluir/etc. via DropdownMenu)
 *  - Toolbar ⚙: densidade (compacta/normal/ampla) + visibilidade de colunas
 *  - `exportCsv`: exporta o resultado filtrado/ordenado (CSV ; com BOM,
 *    abre direto no Excel pt-BR)
 *  - Paginação completa: page size (10/25/50/100), "Mostrando x–y de z",
 *    botões primeira/última página
 *  - Zebra striping sutil + sort indicator em cor brand
 *
 * Fora de escopo (follow-up na #310): column resizing, virtualização
 * (>100 linhas já paginadas), filtros por coluna (as telas têm filter bars
 * próprias acima da tabela).
 *
 * ─── Modo servidor (#1028 parte 3) ──────────────────────────────────────────
 * Aditivo, mesma filosofia do `serverSideSearch` do `Combobox` (#1028 parte
 * 2): default é `serverMode` ausente/false, e o componente continua 100%
 * client-side — as ~48 telas que já usam <DataTable> não mudam nem uma
 * linha. Com `serverMode`, `data` deve ser SÓ a página atual (já filtrada/
 * ordenada pelo servidor); o componente para de refiltrar/reordenar/paginar
 * em memória e delega isso a `onSearchChange`/`onSortChange`/`onPageChange`/
 * `onPageSizeChange`, usando `page`/`pageSize`/`total` (controlados) para
 * desenhar o rodapé. viewOptions (densidade/colunas), seleção + bulkActions
 * (sobre a página carregada) e a card view mobile continuam funcionando
 * iguais — só o ESCOPO dos dados muda, não os recursos. CSV em modo
 * servidor exporta só a página atual (ver rótulo do botão).
 */

export interface Column<T> {
  /** chave do dado ou id sintético da coluna */
  key: string;
  header: string;
  /** render customizado da célula */
  cell?: (row: T) => React.ReactNode;
  /** valor usado para ordenar/filtrar/exportar; default = row[key] */
  accessor?: (row: T) => string | number | null | undefined;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

export interface RowAction<T> {
  label: string;
  icon?: React.ReactNode;
  onClick: (row: T) => void;
  danger?: boolean;
}

type Density = 'compact' | 'comfortable' | 'spacious';

// Soft Surfaces: separação por espaço, não por linha — mais respiro
const DENSITY_PAD: Record<Density, string> = {
  compact: 'py-2',
  comfortable: 'py-3.5',
  spacious: 'py-5',
};

const DENSITY_LABEL: Record<Density, string> = {
  compact: 'Compacta',
  comfortable: 'Normal',
  spacious: 'Ampla',
};

const PAGE_SIZES = [10, 25, 50, 100];

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  loading?: boolean;
  /** chave única por linha; default = (row as any).id */
  rowKey?: (row: T) => string;
  onRowClick?: (row: T) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  pageSize?: number;
  emptyMessage?: string;
  /** estado vazio rico p/ "sem dados" (ex.: <EmptyState .../>); fallback = emptyMessage */
  empty?: React.ReactNode;
  /** checkbox por linha + barra de ações em massa */
  selectable?: boolean;
  /** renderiza as ações da barra em massa; receba as linhas e um clear() */
  bulkActions?: (selected: T[], clear: () => void) => React.ReactNode;
  /** menu ⋮ por linha */
  rowActions?: (row: T) => RowAction<T>[];
  /** toolbar ⚙ com densidade + visibilidade de colunas */
  viewOptions?: boolean;
  /** botão de exportar CSV (true = "export.csv" ou passe o nome do arquivo) */
  exportCsv?: boolean | string;

  // ─── Modo servidor (#1028 parte 3) — ver comentário no topo do arquivo ────
  /** liga o modo servidor. Default false: comportamento 100% client-side, igual a antes. */
  serverMode?: boolean;
  /** página atual, 1-based (mesma convenção do usePagedList — #1028) */
  page?: number;
  /** total de registros no servidor (não só os desta página) */
  total?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  /** valor controlado do campo de busca — sem isto o campo fica sem estado em serverMode */
  searchValue?: string;
  onSearchChange?: (search: string) => void;
  sortKey?: string | null;
  sortDir?: 'asc' | 'desc';
  onSortChange?: (key: string, dir: 'asc' | 'desc') => void;
}

export function DataTable<T>({
  data,
  columns,
  loading,
  rowKey = (row) => (row as { id: string }).id,
  onRowClick,
  searchable = true,
  searchPlaceholder = 'Buscar...',
  pageSize: pageSizeProp,
  emptyMessage = 'Nenhum registro encontrado.',
  empty,
  selectable,
  bulkActions,
  rowActions,
  viewOptions,
  exportCsv,
  serverMode,
  page: pageProp,
  total,
  onPageChange,
  onPageSizeChange,
  searchValue,
  onSearchChange,
  sortKey: sortKeyProp,
  sortDir: sortDirProp,
  onSortChange,
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [sortKeyState, setSortKeyState] = useState<string | null>(null);
  const [sortDirState, setSortDirState] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);
  const [pageSizeState, setPageSizeState] = useState(pageSizeProp ?? 10);
  const [density, setDensity] = useState<Density>('comfortable');
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const headerCheckRef = useRef<HTMLInputElement>(null);

  // ─── modo servidor: valores efetivos (controlados pelo chamador) ──────────
  const effectiveSearch = serverMode ? (searchValue ?? '') : search;
  const effectiveSortKey = serverMode ? (sortKeyProp ?? null) : sortKeyState;
  const effectiveSortDir = serverMode ? (sortDirProp ?? 'asc') : sortDirState;
  const effectivePageSize = serverMode ? (pageSizeProp ?? 10) : pageSizeState;

  // navegação real (page/search/sort) muda → a seleção não pode continuar
  // referenciando linhas que talvez nem estejam mais carregadas
  useEffect(() => {
    if (serverMode) setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverMode, pageProp, effectivePageSize, searchValue, sortKeyProp, sortDirProp]);

  const visibleColumns = columns.filter((c) => !hiddenCols.has(c.key));

  const accessorFor = (col: Column<T>) =>
    col.accessor ?? ((row: T) => (row as Record<string, unknown>)[col.key] as string | number);

  const filtered = useMemo(() => {
    if (serverMode) return data; // já filtrado no servidor
    if (!effectiveSearch.trim()) return data;
    const q = effectiveSearch.toLowerCase();
    return data.filter((row) =>
      columns.some((col) => {
        const v = accessorFor(col)(row);
        return v != null && String(v).toLowerCase().includes(q);
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, effectiveSearch, columns, serverMode]);

  const sorted = useMemo(() => {
    if (serverMode) return filtered; // já ordenado no servidor
    if (!effectiveSortKey) return filtered;
    const col = columns.find((c) => c.key === effectiveSortKey);
    if (!col) return filtered;
    const acc = accessorFor(col);
    return [...filtered].sort((a, b) => {
      const av = acc(a);
      const bv = acc(b);
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), 'pt-BR', { numeric: true });
      return effectiveSortDir === 'asc' ? cmp : -cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, effectiveSortKey, effectiveSortDir, columns, serverMode]);

  const totalCount = serverMode ? (total ?? data.length) : sorted.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / effectivePageSize));
  const safePage = serverMode
    ? Math.max(0, Math.min((pageProp ?? 1) - 1, pageCount - 1))
    : Math.min(page, pageCount - 1);
  const paged = serverMode
    ? data
    : sorted.slice(safePage * effectivePageSize, safePage * effectivePageSize + effectivePageSize);

  function goToPage(newSafePage0: number) {
    if (serverMode) onPageChange?.(newSafePage0 + 1);
    else setPage(newSafePage0);
  }

  // ─── seleção ────────────────────────────────────────────────────────────────
  const selectedRows = useMemo(
    () => sorted.filter((row) => selected.has(rowKey(row))),
    [sorted, selected, rowKey],
  );
  const pageKeys = paged.map(rowKey);
  const allPageSelected = pageKeys.length > 0 && pageKeys.every((k) => selected.has(k));
  const somePageSelected = pageKeys.some((k) => selected.has(k));
  if (headerCheckRef.current) {
    headerCheckRef.current.indeterminate = somePageSelected && !allPageSelected;
  }

  const clearSelection = () => setSelected(new Set());

  function togglePageSelection() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageKeys.forEach((k) => next.delete(k));
      else pageKeys.forEach((k) => next.add(k));
      return next;
    });
  }

  function toggleRow(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSort(col: Column<T>) {
    if (!col.sortable) return;
    if (serverMode) {
      const nextDir: 'asc' | 'desc' =
        effectiveSortKey === col.key && effectiveSortDir === 'asc' ? 'desc' : 'asc';
      onSortChange?.(col.key, nextDir);
      return;
    }
    if (sortKeyState === col.key) {
      setSortDirState((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKeyState(col.key);
      setSortDirState('asc');
    }
  }

  // ─── export CSV (resultado filtrado/ordenado, colunas visíveis) ─────────────
  // Em modo servidor, `sorted` já é só a página atual — exporta só o que está
  // carregado (rótulo/tooltip do botão avisa; ver comentário no topo do arquivo).
  function downloadCsv() {
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = visibleColumns.map((c) => esc(c.header)).join(';');
    const lines = sorted.map((row) =>
      visibleColumns.map((c) => esc(accessorFor(c)(row))).join(';'),
    );
    // BOM p/ Excel pt-BR reconhecer UTF-8; separador ; (padrão pt-BR)
    const blob = new Blob(['﻿' + [header, ...lines].join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = typeof exportCsv === 'string' ? exportCsv : 'export.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const colSpan =
    visibleColumns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0);
  const checkboxClass =
    'h-4 w-4 cursor-pointer rounded border-line accent-brand-600';
  const from = totalCount === 0 ? 0 : safePage * effectivePageSize + 1;
  const to = Math.min(totalCount, (safePage + 1) * effectivePageSize);
  // condição de "sem resultado por causa da busca" (vs. "sem dados mesmo") —
  // em modo servidor `data` já É o resultado filtrado, então o sinal é só ter busca ativa
  const noResultFromSearch = serverMode ? effectiveSearch.trim().length > 0 : data.length > 0 && effectiveSearch.trim().length > 0;

  function clearSearch() {
    if (serverMode) onSearchChange?.('');
    else setSearch('');
  }

  return (
    <div className="space-y-3">
      {(searchable || viewOptions || exportCsv) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchable && (
            <div className="relative max-w-xs flex-1 basis-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted" />
              <Input
                value={effectiveSearch}
                onChange={(e) => {
                  if (serverMode) {
                    onSearchChange?.(e.target.value);
                  } else {
                    setSearch(e.target.value);
                    setPage(0);
                  }
                }}
                placeholder={searchPlaceholder}
                className="pl-9"
              />
            </div>
          )}
          {/* F2: contexto ao lado da busca — a linha da toolbar trabalha
              em telas largas em vez de deixar um vazio até as ações */}
          <span className="whitespace-nowrap text-caption tabular-nums text-content-muted">
            {serverMode
              ? `${totalCount} ${totalCount === 1 ? 'registro' : 'registros'}`
              : effectiveSearch.trim()
                ? `${sorted.length} de ${data.length} registros`
                : `${sorted.length} ${sorted.length === 1 ? 'registro' : 'registros'}`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {exportCsv && (
              <Button
                variant="ghost"
                size="sm"
                onClick={downloadCsv}
                leftIcon={<Download size={15} />}
                title={
                  serverMode
                    ? 'Exporta só a página atual carregada. Os demais registros não foram baixados.'
                    : undefined
                }
              >
                {serverMode ? 'CSV (página atual)' : 'CSV'}
              </Button>
            )}
            {viewOptions && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" leftIcon={<SlidersHorizontal size={15} />}>
                    Exibição
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Densidade</DropdownMenuLabel>
                  {(Object.keys(DENSITY_LABEL) as Density[]).map((d) => (
                    <DropdownMenuItem
                      key={d}
                      icon={density === d ? <Check /> : <span className="w-4" />}
                      onSelect={(e) => {
                        e.preventDefault();
                        setDensity(d);
                      }}
                    >
                      {DENSITY_LABEL[d]}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Colunas</DropdownMenuLabel>
                  {columns.map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c.key}
                      checked={!hiddenCols.has(c.key)}
                      onSelect={(e) => e.preventDefault()}
                      onCheckedChange={(checked) => {
                        setHiddenCols((prev) => {
                          const next = new Set(prev);
                          if (checked) next.delete(c.key);
                          else next.add(c.key);
                          // nunca esconder todas
                          return next.size >= columns.length ? prev : next;
                        });
                      }}
                    >
                      {c.header || c.key}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      )}

      {/* barra de ações em massa (sobre a página carregada, em modo servidor) */}
      {selectable && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand-600/30 bg-brand-600/10 px-4 py-2.5 text-sm">
          <span className="font-medium text-brand-700 dark:text-brand-300">
            {selected.size} selecionado{selected.size === 1 ? '' : 's'}
          </span>
          {/* "selecionar todos os N filtrados" só faz sentido client-side —
              em modo servidor o resto dos filtrados não está carregado */}
          {!serverMode && selected.size < sorted.length && (
            <button
              onClick={() => setSelected(new Set(sorted.map(rowKey)))}
              className="text-brand-600 hover:underline dark:text-brand-400"
            >
              Selecionar todos os {sorted.length} filtrados
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {bulkActions?.(selectedRows, clearSelection)}
            <button
              onClick={clearSelection}
              aria-label="Limpar seleção"
              className="rounded-md p-1 text-content-muted transition-colors hover:text-content"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* mobile (< sm): card view — tabela é ilegível em 375px (F5.1 #321) */}
      <div className="space-y-2 sm:hidden">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={`card-skel-${i}`} className="rounded-xl border border-line bg-surface p-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-3 h-3 w-1/2" />
              <Skeleton className="mt-2 h-3 w-1/3" />
            </div>
          ))
        ) : paged.length === 0 ? (
          <div className="shadow-soft rounded-xl border border-line bg-surface px-5">
            {noResultFromSearch ? (
              <EmptyState
                compact
                icon={SearchX}
                title="Nenhum resultado"
                description={`Nada encontrado para “${effectiveSearch.trim()}”.`}
                action={{ label: 'Limpar busca', onClick: clearSearch }}
              />
            ) : empty ? (
              empty
            ) : (
              <div className="py-12 text-center text-content-muted">{emptyMessage}</div>
            )}
          </div>
        ) : (
          paged.map((row) => {
            const key = rowKey(row);
            const isSelected = selected.has(key);
            // 1ª coluna visível vira o título do card; colunas sem header
            // (ações inline) vão pro rodapé
            const [titleCol, ...restCols] = visibleColumns.filter((c) => c.header);
            const footerCols = visibleColumns.filter((c) => !c.header);
            return (
              <div
                key={key}
                onClick={() => onRowClick?.(row)}
                className={cn(
                  'shadow-soft rounded-xl border border-line bg-surface p-5',
                  onRowClick && 'cursor-pointer active:bg-brand-50/60 dark:active:bg-brand-600/10',
                  isSelected && 'border-brand-600/40 bg-brand-600/10',
                )}
              >
                <div className="flex items-start gap-3">
                  {selectable && (
                    <span onClick={(e) => e.stopPropagation()} className="mt-0.5">
                      <input
                        type="checkbox"
                        aria-label="Selecionar"
                        checked={isSelected}
                        onChange={() => toggleRow(key)}
                        className={checkboxClass}
                      />
                    </span>
                  )}
                  <div className="min-w-0 flex-1 text-sm font-medium text-content">
                    {titleCol &&
                      (titleCol.cell
                        ? titleCol.cell(row)
                        : String(accessorFor(titleCol)(row) ?? ''))}
                  </div>
                  {rowActions && (
                    <span onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            aria-label="Ações"
                            className="rounded-md p-1 text-content-muted hover:text-content"
                          >
                            <MoreVertical size={16} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {rowActions(row).map((a) => (
                            <DropdownMenuItem
                              key={a.label}
                              icon={a.icon}
                              danger={a.danger}
                              onSelect={() => a.onClick(row)}
                            >
                              {a.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </span>
                  )}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {restCols.map((col) => (
                    <div key={col.key} className="min-w-0">
                      <dt className="text-helper uppercase tracking-wide text-content-muted">
                        {col.header}
                      </dt>
                      <dd className="truncate text-sm text-content-secondary">
                        {col.cell ? col.cell(row) : String(accessorFor(col)(row) ?? '')}
                      </dd>
                    </div>
                  ))}
                </dl>
                {footerCols.length > 0 && (
                  <div
                    className="mt-2 flex justify-end border-t border-line pt-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {footerCols.map((col) => (
                      <span key={col.key}>{col.cell?.(row)}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* desktop (>= sm): tabela */}
      <div className="avequi-scroll surface-sheen shadow-soft hidden max-h-[70vh] overflow-auto rounded-xl bg-surface sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              {selectable && (
                <th className="sticky top-0 z-10 w-10 bg-surface px-5 py-3.5">
                  <input
                    ref={headerCheckRef}
                    type="checkbox"
                    aria-label="Selecionar página"
                    checked={allPageSelected}
                    onChange={togglePageSelection}
                    className={checkboxClass}
                  />
                </th>
              )}
              {visibleColumns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col)}
                  className={cn(
                    'sticky top-0 z-10 bg-surface px-5 py-3 text-xs font-medium text-content-muted',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                    !col.align && 'text-left',
                    col.sortable && 'group/th cursor-pointer select-none hover:text-content-secondary',
                    effectiveSortKey === col.key && 'text-brand-600 dark:text-brand-400',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex items-center gap-1',
                      col.align === 'right' && 'flex-row-reverse',
                    )}
                  >
                    {col.header}
                    {col.sortable &&
                      (effectiveSortKey !== col.key ? (
                        <ChevronsUpDown className="h-3.5 w-3.5 opacity-0 transition-opacity duration-micro group-hover/th:opacity-40" />
                      ) : effectiveSortDir === 'asc' ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ))}
                  </span>
                </th>
              ))}
              {rowActions && <th className="sticky top-0 z-10 w-12 bg-surface" />}
            </tr>
          </thead>
          <tbody className={loading ? undefined : 'duration-flow animate-in fade-in'}>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`skeleton-${i}`} className="border-quiet border-b last:border-0">
                  {selectable && (
                    <td className="px-5 py-3.5">
                      <Skeleton className="h-4 w-4" />
                    </td>
                  )}
                  {visibleColumns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        'px-5 py-3.5',
                        col.align === 'right' && 'text-right',
                        col.align === 'center' && 'text-center',
                      )}
                    >
                      <Skeleton
                        className={cn(
                          'h-4',
                          col.align === 'right'
                            ? 'ml-auto w-16'
                            : col.align === 'center'
                              ? 'mx-auto w-10'
                              : 'w-3/4',
                        )}
                      />
                    </td>
                  ))}
                  {rowActions && <td />}
                </tr>
              ))
            ) : paged.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-5">
                  {noResultFromSearch ? (
                    <EmptyState
                      compact
                      icon={SearchX}
                      title="Nenhum resultado"
                      description={`Nada encontrado para “${effectiveSearch.trim()}”.`}
                      action={{ label: 'Limpar busca', onClick: clearSearch }}
                    />
                  ) : empty ? (
                    empty
                  ) : (
                    <div className="py-12 text-center text-content-muted">{emptyMessage}</div>
                  )}
                </td>
              </tr>
            ) : (
              paged.map((row) => {
                const key = rowKey(row);
                const isSelected = selected.has(key);
                return (
                  <tr
                    key={key}
                    onClick={() => onRowClick?.(row)}
                    className={cn(
                      // Soft Surfaces: linha quase invisível + zebra de ~3% —
                      // o dado é o protagonista, a grade desaparece
                      'border-quiet border-b transition-colors duration-micro last:border-0',
                      'group/row hover:bg-neutral-500/[0.04]',
                      onRowClick &&
                        'cursor-pointer hover:bg-brand-600/[0.05] dark:hover:bg-brand-400/[0.07]',
                      isSelected && 'bg-brand-600/10',
                    )}
                  >
                    {selectable && (
                      <td className="w-10 px-4" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label="Selecionar linha"
                          checked={isSelected}
                          onChange={() => toggleRow(key)}
                          className={checkboxClass}
                        />
                      </td>
                    )}
                    {visibleColumns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          'px-4 text-content-secondary',
                          DENSITY_PAD[density],
                          col.align === 'right' && 'text-right tabular-nums',
                          col.align === 'center' && 'text-center',
                          col.className,
                        )}
                      >
                        {col.cell ? col.cell(row) : String(accessorFor(col)(row) ?? '')}
                      </td>
                    ))}
                    {rowActions && (
                      <td className="w-12 px-2 text-right" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              aria-label="Ações da linha"
                              className="rounded-md p-1.5 text-content-muted opacity-0 transition-[color,background-color,opacity] duration-micro focus-visible:opacity-100 group-hover/row:opacity-100 hover:bg-neutral-500/[0.08] hover:text-content"
                            >
                              <MoreVertical size={16} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {rowActions(row).map((a) => (
                              <DropdownMenuItem
                                key={a.label}
                                icon={a.icon}
                                danger={a.danger}
                                onSelect={() => a.onClick(row)}
                              >
                                {a.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* rodapé: contagem + page size + navegação */}
      {totalCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-content-secondary">
          <span>
            Mostrando {from}–{to} de {totalCount}
          </span>
          <label className="flex items-center gap-1.5">
            <span className="text-content-muted">Por página:</span>
            <select
              value={effectivePageSize}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (serverMode) {
                  onPageSizeChange?.(v);
                } else {
                  setPageSizeState(v);
                  setPage(0);
                }
              }}
              className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-sm text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          {pageCount > 1 && (
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => goToPage(0)}
                disabled={safePage === 0}
                aria-label="Primeira página"
                className="rounded-md p-1.5 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
              >
                <ChevronsLeft size={16} />
              </button>
              <button
                onClick={() => goToPage(Math.max(0, safePage - 1))}
                disabled={safePage === 0}
                aria-label="Página anterior"
                className="rounded-md p-1.5 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="px-2 tabular-nums">
                {safePage + 1} / {pageCount}
              </span>
              <button
                onClick={() => goToPage(Math.min(pageCount - 1, safePage + 1))}
                disabled={safePage >= pageCount - 1}
                aria-label="Próxima página"
                className="rounded-md p-1.5 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
              >
                <ChevronRight size={16} />
              </button>
              <button
                onClick={() => goToPage(pageCount - 1)}
                disabled={safePage >= pageCount - 1}
                aria-label="Última página"
                className="rounded-md p-1.5 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
              >
                <ChevronsRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
