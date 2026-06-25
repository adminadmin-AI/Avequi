'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Info } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useDetail, useList } from '@/hooks/use-resource';
import type { PurchaseOrder, Warehouse } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';

const RESOURCE = '/purchases/orders';

export default function ReceivePOPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();

  const { data: po, isLoading } = useDetail<PurchaseOrder>(RESOURCE, id);
  const { data: warehouses = [] } = useList<Warehouse>('/warehouses');

  const [warehouseId, setWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  // qtdRecebida por poItemId
  const [received, setReceived] = useState<Record<string, number>>({});

  // Pré-preenche cada item com a quantidade pendente.
  useEffect(() => {
    if (!po?.items) return;
    const init: Record<string, number> = {};
    for (const it of po.items) {
      init[it.id] = Math.max(0, Number(it.quantity) - Number(it.receivedQuantity ?? 0));
    }
    setReceived(init);
  }, [po]);

  const create = useMutation({
    mutationFn: (payload: any) => apiClient.post('/purchases/receipts', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: [RESOURCE] }),
  });

  function submit() {
    if (!warehouseId) return toast.error('Selecione o depósito de destino');
    const items = Object.entries(received)
      .filter(([, qty]) => qty > 0)
      .map(([poItemId, qtyReceived]) => ({ poItemId, qtyReceived }));
    if (items.length === 0) return toast.error('Informe ao menos um item com quantidade recebida');

    create.mutate(
      { purchaseOrderId: id, warehouseId, notes: notes || undefined, items },
      {
        onSuccess: () => {
          toast.success('Recebimento registrado');
          router.push(`/app/purchases/${id}`);
        },
        onError: () => toast.error('Erro ao registrar recebimento'),
      },
    );
  }

  if (isLoading || !po) {
    return (
      <div>
        <PageHeader title="Recebimento de Mercadoria" />
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Recebimento de Mercadoria"
        description={`PO #${id.slice(-6).toUpperCase()} — ${po.supplier?.name ?? 'Sem fornecedor'}`}
        actions={
          <Button variant="secondary" onClick={() => router.push(`/app/purchases/${id}`)}>
            <ArrowLeft size={16} />
            Voltar
          </Button>
        }
      />

      <Card className="mb-5">
        <CardContent className="grid gap-4 py-5 sm:grid-cols-2">
          <div>
            <Label required>Depósito de destino</Label>
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
            <Label>Observações</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
          </div>
        </CardContent>
      </Card>

      <Card className="mb-5">
        <CardContent className="py-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Itens a receber</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 text-left font-medium">Produto</th>
                  <th className="py-2 text-right font-medium">Pedido</th>
                  <th className="py-2 text-right font-medium">Já recebido</th>
                  <th className="py-2 text-right font-medium">Pendente</th>
                  <th className="py-2 text-right font-medium">Receber agora</th>
                </tr>
              </thead>
              <tbody>
                {(po.items ?? []).map((it) => {
                  const ordered = Number(it.quantity);
                  const already = Number(it.receivedQuantity ?? 0);
                  const pending = Math.max(0, ordered - already);
                  return (
                    <tr key={it.id} className="border-b border-slate-50">
                      <td className="py-2">
                        <p className="text-slate-800">{it.product?.name ?? '—'}</p>
                        <p className="font-mono text-xs text-slate-400">{it.product?.sku}</p>
                      </td>
                      <td className="py-2 text-right tabular-nums">{ordered}</td>
                      <td className="py-2 text-right tabular-nums text-slate-500">{already}</td>
                      <td className="py-2 text-right tabular-nums font-medium">{pending}</td>
                      <td className="py-2 text-right">
                        <Input
                          type="number"
                          min="0"
                          max={pending}
                          step="0.01"
                          value={received[it.id] ?? 0}
                          onChange={(e) =>
                            setReceived((prev) => ({
                              ...prev,
                              [it.id]: Math.min(Number(e.target.value), pending),
                            }))
                          }
                          disabled={pending === 0}
                          className="ml-auto w-24 text-right"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <Info size={14} className="mt-0.5 shrink-0" />
            <span>
              Permite <strong>recebimento parcial</strong> (PO fica como "Recebida parcial" até
              completar). O backend atualiza o estoque e gera a conta a pagar automaticamente.
              A associação de NF-e de entrada (XML/chave) é feita na tela de NF-e de Entrada.
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={() => router.push(`/app/purchases/${id}`)} disabled={create.isPending}>
          Cancelar
        </Button>
        <Button onClick={submit} loading={create.isPending}>
          Confirmar recebimento
        </Button>
      </div>
    </div>
  );
}
