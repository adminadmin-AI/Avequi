'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { useList } from '@/hooks/use-resource';
import type { Product, Warehouse, ProductionOrder } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';

export default function NewProductionOrderPage() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const companyId = useAuthStore((s) => s.user?.companyId ?? '');

  const { data: products = [] } = useList<Product>('/products');
  const { data: warehouses = [] } = useList<Warehouse>('/warehouses');

  const [productId, setProductId] = useState('');
  const [plannedQty, setPlannedQty] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [scheduledStart, setScheduledStart] = useState('');
  const [notes, setNotes] = useState('');

  const create = useMutation({
    mutationFn: (payload: any) => apiClient.post<ProductionOrder>('/production', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/production'] }),
  });

  function submit() {
    if (!productId) return toast.error('Selecione o produto');
    const qty = Number(plannedQty);
    if (!(qty > 0)) return toast.error('Quantidade deve ser maior que zero');
    if (!warehouseId) return toast.error('Selecione o depósito de saída');
    create.mutate(
      {
        companyId,
        productId,
        warehouseId,
        plannedQty: qty,
        scheduledStart: scheduledStart || undefined,
        notes: notes || undefined,
      },
      {
        onSuccess: (res) => {
          toast.success('Ordem de produção criada');
          router.push(`/app/production/${res.data.id}`);
        },
        onError: () => toast.error('Erro ao criar OP'),
      },
    );
  }

  return (
    <div>
      <PageHeader
        title="Nova Ordem de Produção"
        description="Cria a OP em rascunho (planejada)."
        actions={
          <Button variant="secondary" onClick={() => router.push('/app/production')}>
            <ArrowLeft size={16} />
            Voltar
          </Button>
        }
      />

      <Card className="mb-5">
        <CardContent className="grid gap-4 py-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label required>Produto a fabricar</Label>
            <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">— Selecione —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label required>Quantidade</Label>
            <Input type="number" min="0.01" step="0.01" value={plannedQty} onChange={(e) => setPlannedQty(e.target.value)} />
          </div>
          <div>
            <Label required>Depósito de saída</Label>
            <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">— Selecione —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Data planejada</Label>
            <Input type="date" value={scheduledStart} onChange={(e) => setScheduledStart(e.target.value)} />
          </div>
          <div>
            <Label>Observações</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={() => router.push('/app/production')} disabled={create.isPending}>
          Cancelar
        </Button>
        <Button onClick={submit} loading={create.isPending}>
          Criar OP
        </Button>
      </div>
    </div>
  );
}
