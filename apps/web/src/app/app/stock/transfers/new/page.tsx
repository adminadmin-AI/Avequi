'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { useList } from '@/hooks/use-resource';
import type { Product, Warehouse, StockBalance, StoreTransfer } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { formatNumber } from '@/lib/format';

interface DraftItem {
  productId: string;
  quantity: number;
}

export default function NewTransferPage() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const companyId = useAuthStore((s) => s.user?.companyId ?? '');

  const { data: warehouses = [] } = useList<Warehouse>('/warehouses');
  const { data: products = [] } = useList<Product>('/products');
  const { data: balances = [] } = useList<StockBalance>('/stock/balances');
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [newProductId, setNewProductId] = useState('');
  const [newQty, setNewQty] = useState('1');

  const availableAtOrigin = (productId: string) => {
    const b = balances.find((x) => x.productId === productId && x.warehouseId === fromWarehouseId);
    return b ? Number(b.available) : 0;
  };

  const create = useMutation({
    mutationFn: (payload: any) => apiClient.post<StoreTransfer>('/transfers', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/transfers'] }),
  });

  function addItem() {
    if (!newProductId) return toast.error('Selecione um produto');
    const qty = Number(newQty);
    if (!(qty > 0)) return toast.error('Quantidade deve ser maior que zero');
    setItems((prev) => [...prev, { productId: newProductId, quantity: qty }]);
    setNewProductId('');
    setNewQty('1');
  }
  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function submit() {
    if (!fromWarehouseId) return toast.error('Selecione o depósito de origem');
    if (!toWarehouseId) return toast.error('Selecione o depósito de destino');
    if (fromWarehouseId === toWarehouseId) return toast.error('Origem e destino devem ser diferentes');
    if (items.length === 0) return toast.error('Adicione ao menos um item');
    const over = items.find((it) => it.quantity > availableAtOrigin(it.productId));
    if (over) return toast.error('Há item com quantidade acima do saldo na origem');

    create.mutate(
      {
        companyId,
        fromWarehouseId,
        toWarehouseId,
        notes: notes || undefined,
        items: items.map((it) => ({ productId: it.productId, quantity: it.quantity })),
      },
      {
        onSuccess: () => {
          toast.success('Transferência criada');
          router.push('/app/stock/transfers');
        },
        onError: () => toast.error('Erro ao criar transferência'),
      },
    );
  }

  return (
    <div>
      <PageHeader
        title="Nova Transferência"
        description="Transfere itens entre dois depósitos."
        actions={
          <Button variant="secondary" onClick={() => router.push('/app/stock/transfers')}>
            <ArrowLeft size={16} />
            Voltar
          </Button>
        }
      />

      <Card className="mb-5">
        <CardContent className="grid gap-4 py-5 sm:grid-cols-2">
          <div>
            <Label required>Depósito de origem</Label>
            <Select value={fromWarehouseId} onChange={(e) => setFromWarehouseId(e.target.value)}>
              <option value="">— Selecione —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label required>Depósito de destino</Label>
            <Select value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)}>
              <option value="">— Selecione —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-2">
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
              <Select value={newProductId} onChange={(e) => setNewProductId(e.target.value)} disabled={!fromWarehouseId}>
                <option value="">{fromWarehouseId ? '— Selecione —' : 'Escolha a origem primeiro'}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-28">
              <Label>Quantidade</Label>
              <Input type="number" min="0.01" step="0.01" value={newQty} onChange={(e) => setNewQty(e.target.value)} />
            </div>
            <Button type="button" variant="secondary" onClick={addItem} disabled={!fromWarehouseId}>
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
                    <th className="py-2 text-right font-medium">Quantidade</th>
                    <th className="py-2 text-right font-medium">Saldo origem</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => {
                    const p = productMap.get(it.productId);
                    const avail = availableAtOrigin(it.productId);
                    const over = it.quantity > avail;
                    return (
                      <tr key={idx} className="border-b border-line">
                        <td className="py-2">
                          <p className="text-content">{p?.name ?? '—'}</p>
                          <p className="font-mono text-xs text-content-muted">{p?.sku}</p>
                        </td>
                        <td className={`py-2 text-right tabular-nums ${over ? 'font-medium text-danger' : ''}`}>{formatNumber(it.quantity)}</td>
                        <td className="py-2 text-right tabular-nums text-content-muted">{formatNumber(avail)}</td>
                        <td className="py-2 text-right">
                          <button onClick={() => removeItem(idx)} title="Remover" className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-danger">
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={() => router.push('/app/stock/transfers')} disabled={create.isPending}>
          Cancelar
        </Button>
        <Button onClick={submit} loading={create.isPending} disabled={items.length === 0}>
          Criar transferência
        </Button>
      </div>
    </div>
  );
}
