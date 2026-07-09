'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CreditCard, Plus, ScanBarcode, Store, Trash2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type { Customer, Warehouse, Product, SalesOrder } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { FormSection } from '@/components/ui/form-section';
import { useToast } from '@/components/ui/toast';
import { formatBRL } from '@/lib/format';
import {
  PaymentPlanEditor,
  isCardMethod as isCard,
  validatePlan,
  type DraftPayment,
} from '../payment-plan-editor';

/**
 * Venda balcão da filial (PDV) — Fluxo B do épico de pagamentos (#595).
 * O vendedor fecha a venda com o cliente presente: escaneia o chassi no ato,
 * monta o plano de pagamento e fatura direto — sem separação/conferência.
 *
 * Fluxo: montar → Fechar venda (create COUNTER + counter-checkout) →
 * [se cartão] Autorizar TEF (#596) → Faturar (NF-e).
 */

interface DraftItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  serialNumberId?: string;
}

interface CounterSerial {
  id: string;
  serial: string;
  chassi?: string | null;
  descricaoCor?: string | null;
}

type Phase = 'building' | 'closed' | 'authorized';

export default function CounterSalePage() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();

  const { data: customers = [] } = useList<Customer>('/customers');
  const { data: warehouses = [] } = useList<Warehouse>('/warehouses');
  const { data: products = [] } = useList<Product>('/products');

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const [customerId, setCustomerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [payments, setPayments] = useState<DraftPayment[]>([]);

  // pós-fechamento: a venda existe no backend e o fluxo segue por etapas
  const [phase, setPhase] = useState<Phase>('building');
  const [saleId, setSaleId] = useState<string | null>(null);

  // Linha de adição de item
  const [newProductId, setNewProductId] = useState('');
  const [newQty, setNewQty] = useState('1');

  const total = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
  const hasCard = payments.some((p) => isCard(p.method));
  const locked = phase !== 'building';

  const apiError = (err: any, fallback: string) =>
    toast.error(err?.response?.data?.message ?? fallback);

  // ─── Itens ────────────────────────────────────────────────────────────────

  function addItem() {
    const product = productMap.get(newProductId);
    if (!product) {
      toast.error('Selecione um produto');
      return;
    }
    const tracks = Boolean(product.tracksSerial);
    const qty = tracks ? 1 : Number(newQty);
    if (!(qty > 0)) {
      toast.error('Quantidade deve ser maior que zero');
      return;
    }
    setItems((prev) => [
      ...prev,
      { productId: product.id, quantity: qty, unitPrice: Number(product.salePrice ?? 0) },
    ]);
    setNewProductId('');
    setNewQty('1');
  }

  function updateItem(idx: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  // ─── Fechamento (create + counter-checkout) ─────────────────────────────

  const close = useMutation({
    mutationFn: async () => {
      const payload = {
        channel: 'COUNTER',
        warehouseId,
        customerId: customerId || undefined,
        notes: notes || undefined,
        items: items.map((it) => ({
          productId: it.productId,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          serialNumberId: it.serialNumberId || undefined,
        })),
        payments: payments.map((p) => ({
          method: p.method,
          amount: p.amount,
          installments: p.installments,
          acquirerId: p.acquirerId || undefined,
          brand: p.brand || undefined,
        })),
      };
      const created = await apiClient.post<SalesOrder>('/sales', payload);
      await apiClient.post(`/sales/${created.data.id}/counter-checkout`);
      return created.data;
    },
    onSuccess: (sale) => {
      qc.invalidateQueries({ queryKey: ['/sales'] });
      setSaleId(sale.id);
      setPhase('closed');
      toast.success(hasCard ? 'Venda fechada — passe o cartão' : 'Venda fechada — pronta pra faturar');
    },
    onError: (err: any) => apiError(err, 'Erro ao fechar a venda'),
  });

  function validateAndClose() {
    if (!customerId) {
      toast.error('Selecione o cliente — a NF-e do reboque precisa do destinatário');
      return;
    }
    if (!warehouseId) {
      toast.error('Selecione o depósito da loja');
      return;
    }
    if (items.length === 0) {
      toast.error('Adicione ao menos um item');
      return;
    }
    if (items.some((it) => !(it.quantity > 0) || !(it.unitPrice > 0))) {
      toast.error('Quantidade e preço devem ser maiores que zero');
      return;
    }
    const missingSerial = items.find(
      (it) => productMap.get(it.productId)?.tracksSerial && !it.serialNumberId,
    );
    if (missingSerial) {
      toast.error(
        `Escaneie o chassi de "${productMap.get(missingSerial.productId)?.name}" antes de fechar`,
      );
      return;
    }
    const planError = validatePlan(payments, total);
    if (planError) {
      toast.error(planError);
      return;
    }
    close.mutate();
  }

  // ─── Autorização TEF (#596) + Faturamento ────────────────────────────────

  const authorize = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ authorized: number; denied: number; message: string }>(
        `/sales/${saleId}/authorize`,
      );
      return res.data;
    },
    onSuccess: (res) => {
      if (res.denied > 0) {
        toast.error(res.message || 'Cartão negado — tente outro cartão ou forma');
        return;
      }
      setPhase('authorized');
      toast.success('Cartão autorizado');
    },
    onError: (err: any) => apiError(err, 'Erro ao autorizar o cartão'),
  });

  const invoice = useMutation({
    mutationFn: async () => apiClient.patch(`/sales/${saleId}/invoice`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/sales'] });
      toast.success('Venda faturada — NF-e em emissão');
      router.push(`/app/sales/${saleId}`);
    },
    onError: (err: any) => apiError(err, 'Erro ao faturar — verifique o pagamento e o chassi'),
  });

  const canInvoice = phase === 'authorized' || (phase === 'closed' && !hasCard);

  // ─── UI ──────────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        title="Venda Balcão"
        description="Cliente presente na loja: escaneie o chassi, monte o pagamento e fature direto — sem separação."
        actions={
          <Button variant="secondary" onClick={() => router.push('/app/sales')}>
            <ArrowLeft size={16} />
            Voltar
          </Button>
        }
      />

      {/* Dados */}
      <FormSection
        title="Cliente e loja"
        description="A NF-e do reboque exige o destinatário; o depósito é o estoque físico da loja."
        className="mb-5"
      >
        <div>
          <Label required>Cliente</Label>
          <Select
            aria-label="Cliente"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            disabled={locked}
          >
            <option value="">— Selecione —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.document ? ` — ${c.document}` : ''}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label required>Depósito da loja</Label>
          <Select
            aria-label="Depósito"
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              // trocar de depósito invalida os chassis já escolhidos
              setItems((prev) => prev.map((it) => ({ ...it, serialNumberId: undefined })));
            }}
            disabled={locked}
          >
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
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Opcional"
            disabled={locked}
          />
        </div>
      </FormSection>

      {/* Itens */}
      <Card className="mb-5">
        <CardContent className="py-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-content-secondary">
            <ScanBarcode size={16} />
            Itens
          </h3>

          {!locked && (
            <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg bg-surface-secondary p-3">
              <div className="min-w-[240px] flex-1">
                <Label>Produto</Label>
                <Select
                  aria-label="Produto"
                  value={newProductId}
                  onChange={(e) => setNewProductId(e.target.value)}
                >
                  <option value="">— Selecione —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.name}
                      {p.tracksSerial ? ' (chassi)' : ''}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-28">
                <Label>Quantidade</Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={productMap.get(newProductId)?.tracksSerial ? '1' : newQty}
                  onChange={(e) => setNewQty(e.target.value)}
                  disabled={Boolean(productMap.get(newProductId)?.tracksSerial)}
                  title={
                    productMap.get(newProductId)?.tracksSerial
                      ? 'Produto rastreável: 1 chassi por linha'
                      : undefined
                  }
                />
              </div>
              <Button type="button" variant="secondary" onClick={addItem}>
                <Plus size={16} />
                Adicionar
              </Button>
            </div>
          )}

          {items.length === 0 ? (
            <p className="py-6 text-center text-sm text-content-muted">Nenhum item adicionado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-content-muted">
                    <th className="py-2 text-left font-medium">Produto</th>
                    <th className="py-2 text-left font-medium">Chassi</th>
                    <th className="py-2 text-right font-medium">Qtd</th>
                    <th className="py-2 text-right font-medium">Preço unit.</th>
                    <th className="py-2 text-right font-medium">Subtotal</th>
                    {!locked && <th className="py-2"></th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => {
                    const p = productMap.get(it.productId);
                    return (
                      <tr key={idx} className="border-b border-line">
                        <td className="py-2">
                          <p className="text-content">{p?.name ?? '—'}</p>
                          <p className="font-mono text-xs text-content-muted">{p?.sku}</p>
                        </td>
                        <td className="py-2">
                          {p?.tracksSerial ? (
                            <ChassiSelect
                              productId={it.productId}
                              warehouseId={warehouseId}
                              value={it.serialNumberId ?? ''}
                              onChange={(v) => updateItem(idx, { serialNumberId: v || undefined })}
                              excluded={items
                                .filter((_, i) => i !== idx)
                                .map((x) => x.serialNumberId)
                                .filter(Boolean) as string[]}
                              disabled={locked}
                            />
                          ) : (
                            <span className="text-xs text-content-muted">—</span>
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {p?.tracksSerial || locked ? (
                            it.quantity
                          ) : (
                            <Input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={it.quantity}
                              onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                              className="ml-auto w-24 text-right"
                            />
                          )}
                        </td>
                        <td className="py-2 text-right">
                          {locked ? (
                            <span className="tabular-nums">{formatBRL(it.unitPrice)}</span>
                          ) : (
                            <Input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={it.unitPrice}
                              onChange={(e) => updateItem(idx, { unitPrice: Number(e.target.value) })}
                              className="ml-auto w-28 text-right"
                            />
                          )}
                        </td>
                        <td className="py-2 text-right font-medium tabular-nums">
                          {formatBRL(it.quantity * it.unitPrice)}
                        </td>
                        {!locked && (
                          <td className="py-2 text-right">
                            <button
                              onClick={() => removeItem(idx)}
                              title="Remover"
                              className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-danger"
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="py-3 text-right text-sm font-medium text-content-secondary">
                      Total
                    </td>
                    <td className="py-3 text-right text-base font-semibold tabular-nums text-content">
                      {formatBRL(total)}
                    </td>
                    {!locked && <td></td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagamento — editor compartilhado (#584) */}
      <Card className="mb-5">
        <CardContent className="py-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-content-secondary">
            <CreditCard size={16} />
            Plano de pagamento
          </h3>
          <PaymentPlanEditor payments={payments} onChange={setPayments} total={total} disabled={locked} />
        </CardContent>
      </Card>

      {/* Ações do fluxo */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {phase === 'building' && (
          <Button onClick={validateAndClose} loading={close.isPending}>
            <Store size={16} />
            Fechar venda
          </Button>
        )}
        {phase !== 'building' && hasCard && phase !== 'authorized' && (
          <Button onClick={() => authorize.mutate()} loading={authorize.isPending}>
            <CreditCard size={16} />
            Autorizar cartão (TEF)
          </Button>
        )}
        {phase !== 'building' && (
          <Button
            onClick={() => invoice.mutate()}
            loading={invoice.isPending}
            disabled={!canInvoice}
            title={!canInvoice ? 'Autorize o cartão antes de faturar' : undefined}
          >
            Faturar (NF-e)
          </Button>
        )}
      </div>
    </div>
  );
}

/** Select de chassi disponível (IN_STOCK, livre) no depósito da venda (#595) */
function ChassiSelect({
  productId,
  warehouseId,
  value,
  onChange,
  excluded,
  disabled,
}: {
  productId: string;
  warehouseId: string;
  value: string;
  onChange: (v: string) => void;
  excluded: string[];
  disabled?: boolean;
}) {
  const { data: serials = [], isLoading } = useList<CounterSerial>(
    '/sales/counter-serials',
    { productId, warehouseId },
    { enabled: Boolean(productId && warehouseId) },
  );

  if (!warehouseId) {
    return <span className="text-xs text-content-muted">Selecione o depósito</span>;
  }
  const options = serials.filter((s) => s.id === value || !excluded.includes(s.id));
  return (
    <Select
      aria-label="Chassi"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || isLoading}
      className="min-w-[220px]"
    >
      <option value="">{isLoading ? 'Carregando…' : options.length === 0 ? 'Sem chassi disponível' : '— Escanear/selecionar —'}</option>
      {options.map((s) => (
        <option key={s.id} value={s.id}>
          {s.chassi ?? s.serial}
          {s.descricaoCor ? ` — ${s.descricaoCor}` : ''}
        </option>
      ))}
    </Select>
  );
}
