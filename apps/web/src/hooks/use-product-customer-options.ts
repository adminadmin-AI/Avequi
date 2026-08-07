'use client';

import { useMemo } from 'react';
import { useOptions } from './use-resource';
import type { ComboboxOption } from '@/components/ui/combobox';
import type { CustomerOption, ProductOption } from '@/types/api';

/**
 * Wrappers finos sobre `useOptions` para os dois combobox mais usados no app
 * (#1028 parte 2 — GET /products/options e /customers/options). Cuidam só do
 * mapeamento para `ComboboxOption[]`; o chamador ainda controla `search` e
 * `selectedLabel` (ver comentário em `combobox.tsx` sobre por que o item
 * selecionado precisa de um rótulo próprio quando a busca muda).
 *
 *   const [search, setSearch] = useState('');
 *   const { options, items, isLoading } = useProductOptions({ search });
 *   <Combobox options={options} onQueryChange={setSearch} serverSideSearch ... />
 */

type OptionsParams = { search?: string; isActive?: boolean; take?: number };

export function useProductOptions(params?: OptionsParams) {
  const { data: items = [], isLoading } = useOptions<ProductOption>('/products', params);
  const options = useMemo<ComboboxOption[]>(
    () => items.map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` })),
    [items],
  );
  return { items, options, isLoading };
}

export function useCustomerOptions(params?: OptionsParams) {
  const { data: items = [], isLoading } = useOptions<CustomerOption>('/customers', params);
  const options = useMemo<ComboboxOption[]>(
    () => items.map((c) => ({ value: c.id, label: c.document ? `${c.name} · ${c.document}` : c.name })),
    [items],
  );
  return { items, options, isLoading };
}
