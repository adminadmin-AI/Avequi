'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Search, X } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from './popover';
import { Spinner } from './spinner';
import { cn } from '@/lib/utils';

/**
 * Combobox — F2.2 (#308)
 *
 * Select pesquisável construído sobre o Popover do design system (sem
 * dependência nova). Para listas longas (produtos, clientes, fornecedores)
 * onde o <Select> nativo não escala.
 *
 *  - Busca com filtro acento-insensível
 *  - Single (Combobox) e multi-select com tags (MultiCombobox)
 *  - Groups opcionais, empty state, loading state, clear button
 *  - Teclado: ↑/↓ navega, Enter seleciona, Esc fecha
 *  - Dark mode via tokens
 */

export interface ComboboxOption {
  value: string;
  label: string;
  /** Cabeçalho de grupo opcional (opções com mesmo group ficam juntas). */
  group?: string;
  disabled?: boolean;
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

interface PanelProps {
  options: ComboboxOption[];
  selected: Set<string>;
  onSelect: (value: string) => void;
  searchPlaceholder?: string;
  emptyMessage?: string;
  loading?: boolean;
  searchRef?: React.Ref<HTMLInputElement>;
}

/** Painel interno compartilhado (busca + lista) do Combobox e MultiCombobox. */
function ComboboxPanel({
  options,
  selected,
  onSelect,
  searchPlaceholder = 'Buscar...',
  emptyMessage = 'Nenhum resultado',
  loading,
  searchRef,
}: PanelProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = norm(query);
    return options.filter((o) => norm(o.label).includes(q));
  }, [options, query]);

  // agrupa preservando a ordem (sem grupo primeiro)
  const groups = useMemo(() => {
    const map = new Map<string, ComboboxOption[]>();
    for (const o of filtered) {
      const key = o.group ?? '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }
    return [...map.entries()];
  }, [filtered]);

  const enabled = filtered.filter((o) => !o.disabled);

  useEffect(() => setActive(0), [query]);

  // mantém a opção ativa visível ao navegar com teclado
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, enabled.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = enabled[active];
      if (opt) onSelect(opt.value);
    }
  };

  return (
    <div onKeyDown={onKeyDown}>
      <div className="relative border-b border-line">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted" />
        <input
          ref={searchRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-10 w-full bg-transparent pl-9 pr-3 text-sm text-content placeholder:text-content-muted focus:outline-none"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
        />
      </div>
      <div ref={listRef} role="listbox" className="avequi-scroll max-h-64 overflow-y-auto p-1">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-content-muted">
            <Spinner size="sm" /> Carregando...
          </div>
        ) : enabled.length === 0 ? (
          <p className="py-6 text-center text-sm text-content-muted">{emptyMessage}</p>
        ) : (
          groups.map(([group, opts]) => (
            <div key={group || '__nogroup'}>
              {group && (
                <p className="px-2.5 py-1.5 text-caption font-semibold text-content-muted">
                  {group}
                </p>
              )}
              {opts.map((opt) => {
                const idx = enabled.indexOf(opt);
                const isActive = idx === active;
                const isSelected = selected.has(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={opt.disabled}
                    data-active={isActive || undefined}
                    onMouseEnter={() => idx >= 0 && setActive(idx)}
                    onClick={() => onSelect(opt.value)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-content',
                      'disabled:pointer-events-none disabled:opacity-50',
                      // highlight forte (teclado e hover) — tinta brand visível nos 2 temas
                      isActive &&
                        'bg-brand-600/10 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300',
                    )}
                  >
                    <span className="flex-1 truncate">{opt.label}</span>
                    {isSelected && (
                      <Check className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
                    )}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const triggerClass = (error?: boolean, disabled?: boolean) =>
  cn(
    'flex h-10 w-full items-center gap-2 rounded-lg border bg-surface px-3 text-left text-sm',
    'transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
    error ? 'border-danger focus-visible:ring-danger' : 'border-line focus-visible:ring-brand-600',
    disabled && 'cursor-not-allowed bg-surface-secondary text-content-muted',
  );

interface BaseProps {
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  loading?: boolean;
  disabled?: boolean;
  error?: boolean;
  /** Botão X no trigger para limpar a seleção. */
  clearable?: boolean;
  className?: string;
}

export interface ComboboxProps extends BaseProps {
  value: string;
  onValueChange: (value: string) => void;
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = 'Selecione...',
  searchPlaceholder,
  emptyMessage,
  loading,
  disabled,
  error,
  clearable,
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedOption = options.find((o) => o.value === value);

  return (
    // modal: necessário p/ funcionar dentro de Dialog (o Dialog bloqueia
    // pointer-events fora dele; o painel do popover é portalizado pro body)
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} className={cn(triggerClass(error, disabled), className)}>
          <span className={cn('flex-1 truncate', !selectedOption && 'text-content-muted')}>
            {selectedOption?.label ?? placeholder}
          </span>
          {clearable && value && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Limpar seleção"
              onClick={(e) => {
                e.stopPropagation();
                onValueChange('');
              }}
              className="rounded text-content-muted transition-colors hover:text-content"
            >
              <X className="h-4 w-4" />
            </span>
          )}
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-content-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
        // foca a busca DEPOIS do focus-trap do Dialog agir (rAF) — dentro de
        // modais, o autoFocus de mount perde a disputa e as setas iam pro Dialog
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          requestAnimationFrame(() => searchRef.current?.focus());
        }}
      >
        <ComboboxPanel
          options={options}
          selected={new Set(value ? [value] : [])}
          onSelect={(v) => {
            onValueChange(v);
            setOpen(false);
          }}
          searchPlaceholder={searchPlaceholder}
          emptyMessage={emptyMessage}
          loading={loading}
          searchRef={searchRef}
        />
      </PopoverContent>
    </Popover>
  );
}

export interface MultiComboboxProps extends BaseProps {
  values: string[];
  onValuesChange: (values: string[]) => void;
  /** Máximo de tags visíveis no trigger antes de virar "+N" (default 3). */
  maxTags?: number;
}

export function MultiCombobox({
  options,
  values,
  onValuesChange,
  placeholder = 'Selecione...',
  searchPlaceholder,
  emptyMessage,
  loading,
  disabled,
  error,
  clearable,
  maxTags = 3,
  className,
}: MultiComboboxProps) {
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedSet = useMemo(() => new Set(values), [values]);
  const selectedOptions = options.filter((o) => selectedSet.has(o.value));
  const visibleTags = selectedOptions.slice(0, maxTags);
  const extraCount = selectedOptions.length - visibleTags.length;

  const toggle = (v: string) => {
    onValuesChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  };

  return (
    // modal: necessário p/ funcionar dentro de Dialog (o Dialog bloqueia
    // pointer-events fora dele; o painel do popover é portalizado pro body)
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(triggerClass(error, disabled), 'h-auto min-h-10 flex-wrap py-1.5', className)}
        >
          {selectedOptions.length === 0 ? (
            <span className="flex-1 truncate text-content-muted">{placeholder}</span>
          ) : (
            <span className="flex flex-1 flex-wrap items-center gap-1">
              {visibleTags.map((o) => (
                <span
                  key={o.value}
                  className="inline-flex items-center gap-1 rounded-md bg-surface-secondary px-1.5 py-0.5 text-caption text-content-secondary"
                >
                  {o.label}
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`Remover ${o.label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(o.value);
                    }}
                    className="rounded text-content-muted transition-colors hover:text-content"
                  >
                    <X className="h-3 w-3" />
                  </span>
                </span>
              ))}
              {extraCount > 0 && (
                <span className="text-caption text-content-muted">+{extraCount}</span>
              )}
            </span>
          )}
          {clearable && selectedOptions.length > 0 && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Limpar seleção"
              onClick={(e) => {
                e.stopPropagation();
                onValuesChange([]);
              }}
              className="rounded text-content-muted transition-colors hover:text-content"
            >
              <X className="h-4 w-4" />
            </span>
          )}
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-content-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          requestAnimationFrame(() => searchRef.current?.focus());
        }}
      >
        <ComboboxPanel
          options={options}
          selected={selectedSet}
          onSelect={toggle}
          searchPlaceholder={searchPlaceholder}
          emptyMessage={emptyMessage}
          loading={loading}
          searchRef={searchRef}
        />
      </PopoverContent>
    </Popover>
  );
}
