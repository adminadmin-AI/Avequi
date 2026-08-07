'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import { useCustomerOptions, useProductOptions } from '@/hooks/use-product-customer-options';
import type { Warehouse, Quotation } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { erroDeAcao } from '@/lib/feedback';
import { formatBRL } from '@/lib/format';

interface DraftItem {
  productId: string;
  // capturados na seleção (#1028 parte 2) — combobox busca no servidor
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export default function NewQuotationPage() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();

  const { data: warehouses = [] } = useList<Warehouse>('/warehouses');

  // Cliente (#1028 parte 2) — busca server-side
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerLabel, setCustomerLabel] = useState<string | undefined>();
  const { options: customerOptions, isLoading: customersLoading, items: customerItems } = useCustomerOptions({
    search: customerSearch,
  });

  // Produto (#1028 parte 2) — busca server-side
  const [productSearch, setProductSearch] = useState('');
  const { items: productItems, options: productOptions, isLoading: productsLoading } = useProductOptions({
    search: productSearch,
  });

  const [customerId, setCustomerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [newProductId, setNewProductId] = useState('');
  const [newProductLabel, setNewProductLabel] = useState<string | undefined>();
  const [newQty, setNewQty] = useState('1');

  const create = useMutation({
    mutationFn: (payload: any) => apiClient.post<Quotation>('/quotations', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/quotations'] }),
  });

  function addItem() {
    const product = productItems.find((p) => p.id === newProductId);
    if (!product) return toast.error('Selecione um produto');
    const qty = Number(newQty);
    if (!(qty > 0)) return toast.error('Quantidade deve ser maior que zero');
    setItems((prev) => [
      ...prev,
      { productId: product.id, sku: product.sku, name: product.name, quantity: qty, unitPrice: Number(product.salePrice ?? 0) },
    ]);
    setNewProductId('');
    setNewProductLabel(undefined);
    setNewQty('1');
  }
  function updateItem(idx: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  const total = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);

  function submit() {
    if (!warehouseId) return toast.error('Selecione o depósito');
    if (items.length === 0) return toast.error('Adicione ao menos um item');
    if (items.some((it) => !(it.quantity > 0) || !(it.unitPrice >= 0))) {
      return toast.error('Quantidade e preço inválidos');
    }
    const payload = {
      warehouseId,
      customerId: customerId || undefined,
      validUntil: validUntil || undefined,
      notes: notes || undefined,
      items: items.map((it) => ({ productId: it.productId, quantity: it.quantity, unitPrice: it.unitPrice })),
    };
    create.mutate(payload, {
      onSuccess: (res) => {
        toast.success(`Orçamento #${res.data.id.slice(-6).toUpperCase()} criado`);
        router.push('/app/quotations');
      },
      onError: (err) => toast.error(erroDeAcao('criar o orçamento', err)),
    });
  }

  return (
    <div>
      <PageHeader
        title="Novo orçamento"
        description="Proposta comercial em rascunho."
        actions={
          <Button variant="secondary" onClick={() => router.push('/app/quotations')}>
            <ArrowLeft size={16} />
            Voltar
          </Button>
        }
      />

      <Card className="mb-5">
        <CardContent className="grid gap-4 py-5 sm:grid-cols-2">
          <div>
            <Label>Cliente</Label>
            <Combobox
              options={customerOptions}
              value={customerId}
              onValueChange={(v) => {
                setCustomerId(v);
                const c = customerItems.find((i) => i.id === v);
                setCustomerLabel(c ? (c.document ? `${c.name} · ${c.document}` : c.name) : undefined);
              }}
              onQueryChange={setCustomerSearch}
              serverSideSearch
              selectedLabel={customerLabel}
              loading={customersLoading}
              placeholder="Sem cliente"
              searchPlaceholder="Buscar por nome ou documento..."
              clearable
            />
          </div>
          <div>
            <Label required>Depósito</Label>
            <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Selecione</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Validade</Label>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
          <div>
            <Label>Observações</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
          </div>
        </CardContent>
      </Card>

      <Card className="mb-5">
        <CardContent className="py-5">
          <h3 className="mb-3 text-sm font-semibold text-content-secondary">Itens</h3>
          <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg bg-surface-secondary p-3">
            <div className="min-w-[240px] flex-1">
              <Label>Produto</Label>
              <Combobox
                options={productOptions}
                value={newProductId}
                onValueChange={(v) => {
                  setNewProductId(v);
                  const p = productItems.find((i) => i.id === v);
                  setNewProductLabel(p ? `${p.sku} · ${p.name}` : undefined);
                }}
                onQueryChange={setProductSearch}
                serverSideSearch
                selectedLabel={newProductLabel}
                loading={productsLoading}
                placeholder="Selecione"
                searchPlaceholder="Buscar por SKU ou nome..."
              />
            </div>
            <div className="w-28">
              <Label>Quantidade</Label>
              <Input type="number" min="0.01" step="0.01" value={newQty} onChange={(e) => setNewQty(e.target.value)} />
            </div>
            <Button type="button" variant="secondary" onClick={addItem}>
              <Plus size={16} />
              Adicionar
            </Button>
          </div>

          {items.length === 0 ? (
            <p className="py-6 text-center text-sm text-content-muted">Nenhum item adicionado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-content-muted">
                    <th className="py-2 text-left font-medium">Produto</th>
                    <th className="py-2 text-right font-medium">Qtd</th>
                    <th className="py-2 text-right font-medium">Preço unit.</th>
                    <th className="py-2 text-right font-medium">Subtotal</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => {
                    return (
                      <tr key={idx} className="border-b border-line">
                        <td className="py-2">
                          <p className="text-content">{it.name}</p>
                          <p className="font-mono text-xs text-content-muted">{it.sku}</p>
                        </td>
                        <td className="py-2 text-right">
                          <Input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={it.quantity}
                            onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                            className="ml-auto w-24 text-right"
                          />
                        </td>
                        <td className="py-2 text-right">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={it.unitPrice}
                            onChange={(e) => updateItem(idx, { unitPrice: Number(e.target.value) })}
                            className="ml-auto w-28 text-right"
                          />
                        </td>
                        <td className="py-2 text-right font-medium tabular-nums">
                          {formatBRL(it.quantity * it.unitPrice)}
                        </td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() => removeItem(idx)}
                            title="Remover"
                            className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-danger"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="py-3 text-right text-sm font-medium text-content-secondary">
                      Total geral
                    </td>
                    <td className="py-3 text-right text-base font-semibold tabular-nums text-content">
                      {formatBRL(total)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={() => router.push('/app/quotations')} disabled={create.isPending}>
          Cancelar
        </Button>
        <Button onClick={submit} loading={create.isPending} disabled={items.length === 0}>
          Criar orçamento
        </Button>
      </div>
    </div>
  );
}
