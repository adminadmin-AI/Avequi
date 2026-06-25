'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { useList } from '@/hooks/use-resource';
import type { Product, Warehouse, StockBalance } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { formatNumber } from '@/lib/format';

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label required={required}>{label}</Label>
      {children}
    </div>
  );
}

/**
 * Botão "Nova movimentação" + FormDialog para registrar entrada/saída manual.
 * Consome POST /stock/move. Alerta se a saída exceder o saldo disponível.
 */
export function NewMovementDialog() {
  const toast = useToast();
  const qc = useQueryClient();
  const companyId = useAuthStore((s) => s.user?.companyId ?? '');
  const [open, setOpen] = useState(false);

  const { data: products = [] } = useList<Product>('/products');
  const { data: warehouses = [] } = useList<Warehouse>('/warehouses');
  const { data: balances = [] } = useList<StockBalance>('/stock/balances');

  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [type, setType] = useState<'ENTRY' | 'EXIT'>('ENTRY');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');

  // Saldo disponível do produto no depósito selecionado.
  const available = useMemo(() => {
    const b = balances.find((x) => x.productId === productId && x.warehouseId === warehouseId);
    return b ? Number(b.available) : 0;
  }, [balances, productId, warehouseId]);

  const exceedsStock = type === 'EXIT' && Number(quantity) > available;

  const move = useMutation({
    mutationFn: (payload: any) => apiClient.post('/stock/move', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/stock/movements'] });
      qc.invalidateQueries({ queryKey: ['/stock/balances'] });
    },
  });

  function reset() {
    setProductId('');
    setWarehouseId('');
    setType('ENTRY');
    setQuantity('');
    setReason('');
    setReference('');
  }

  function submit() {
    if (!productId) return toast.error('Selecione o produto');
    if (!warehouseId) return toast.error('Selecione o depósito');
    const qty = Number(quantity);
    if (!(qty > 0)) return toast.error('Quantidade deve ser maior que zero');
    if (reason.trim().length < 3) return toast.error('Informe o motivo (mín. 3 caracteres)');

    move.mutate(
      {
        companyId,
        productId,
        warehouseId,
        type,
        quantity: qty,
        reason,
        reference: reference || undefined,
      },
      {
        onSuccess: () => {
          toast.success('Movimentação registrada');
          setOpen(false);
          reset();
        },
        onError: () => toast.error('Erro ao registrar movimentação'),
      },
    );
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={16} />
        Nova movimentação
      </Button>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Nova movimentação manual"
        description="Registra uma entrada ou saída de estoque."
        formId="new-movement-form"
        loading={move.isPending}
      >
        <form
          id="new-movement-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-4 py-1"
        >
          <Field label="Produto" required>
            <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">— Selecione —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Depósito" required>
              <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                <option value="">— Selecione —</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tipo" required>
              <div className="flex gap-4 pt-2">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="radio" checked={type === 'ENTRY'} onChange={() => setType('ENTRY')} /> Entrada
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="radio" checked={type === 'EXIT'} onChange={() => setType('EXIT')} /> Saída
                </label>
              </div>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Quantidade" required>
              <Input type="number" min="0.01" step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} error={exceedsStock} />
              {productId && warehouseId && (
                <p className={`mt-1 text-xs ${exceedsStock ? 'text-danger' : 'text-slate-400'}`}>
                  Disponível: {formatNumber(available)}
                  {exceedsStock && ' — saída excede o saldo!'}
                </p>
              )}
            </Field>
            <Field label="Referência externa">
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Opcional" />
            </Field>
          </div>

          <Field label="Motivo" required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: ajuste de inventário" />
          </Field>
        </form>
      </FormDialog>
    </>
  );
}
