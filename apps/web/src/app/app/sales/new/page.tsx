'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type { Customer, Warehouse, Product, SalesOrder } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Stepper, type Step } from '@/components/ui/stepper';
import { FormSection } from '@/components/ui/form-section';
import { useToast } from '@/components/ui/toast';
import { formatBRL } from '@/lib/format';

// wizard F3.1 (#316): dados → itens → revisão
const STEPS: Step[] = [
  { id: 'dados', label: 'Dados da venda' },
  { id: 'itens', label: 'Itens' },
  { id: 'revisao', label: 'Revisão' },
];

interface DraftItem {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export default function NewSalePage() {
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
  const [paymentMethod, setPaymentMethod] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [step, setStep] = useState(0);

  // Linha de adição de item
  const [newProductId, setNewProductId] = useState('');
  const [newQty, setNewQty] = useState('1');

  const create = useMutation({
    mutationFn: (payload: any) => apiClient.post<SalesOrder>('/sales', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/sales'] }),
  });

  function addItem() {
    const product = productMap.get(newProductId);
    if (!product) {
      toast.error('Selecione um produto');
      return;
    }
    const qty = Number(newQty);
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

  const total = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);

  // validação por etapa: não avança se a etapa atual estiver inválida
  function validateStep(s: number): boolean {
    if (s === 0 && !warehouseId) {
      toast.error('Selecione o depósito');
      return false;
    }
    if (s === 1) {
      if (items.length === 0) {
        toast.error('Adicione ao menos um item');
        return false;
      }
      if (items.some((it) => !(it.quantity > 0) || !(it.unitPrice > 0))) {
        toast.error('Quantidade e preço devem ser maiores que zero');
        return false;
      }
    }
    return true;
  }

  function next() {
    if (!validateStep(step)) return;
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }

  function submit() {
    if (!validateStep(0) || !validateStep(1)) return;
    const payload = {
      warehouseId,
      customerId: customerId || undefined,
      notes: notes || undefined,
      paymentMethod: paymentMethod || undefined,
      items: items.map((it) => ({
        productId: it.productId,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
      })),
    };
    create.mutate(payload, {
      onSuccess: (res) => {
        toast.success('Ordem de venda criada');
        router.push(`/app/sales/${res.data.id}`);
      },
      onError: () => toast.error('Erro ao criar ordem de venda'),
    });
  }

  return (
    <div>
      <PageHeader
        title="Nova Ordem de Venda"
        description="Cria a OV em rascunho. As etapas do pipeline são feitas no detalhe."
        actions={
          <Button variant="secondary" onClick={() => router.push('/app/sales')}>
            <ArrowLeft size={16} />
            Voltar
          </Button>
        }
      />

      {/* Wizard F3.1 (#316) */}
      <Stepper steps={STEPS} current={step} onStepClick={setStep} className="mx-auto mb-6 max-w-2xl" />

      {/* Etapa 1 — Dados */}
      {step === 0 && (
        <FormSection
          title="Dados da venda"
          description="Cliente é opcional; o depósito define de onde sai o estoque."
          className="mb-5"
        >
          <div>
            <Label>Cliente</Label>
            <Select aria-label="Cliente" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— Sem cliente —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.document ? ` — ${c.document}` : ''}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label required>Depósito</Label>
            <Select aria-label="Depósito" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">— Selecione —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Forma de pagamento</Label>
            <Select aria-label="Forma de pagamento" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="">— Não informar (NF-e sai como Outros) —</option>
              <option value="PIX">PIX</option>
              <option value="BOLETO">Boleto</option>
              <option value="DINHEIRO">Dinheiro</option>
              <option value="CARTAO">Cartão</option>
              <option value="TED">TED</option>
              <option value="CHEQUE">Cheque</option>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>Observações</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
          </div>
        </FormSection>
      )}

      {/* Etapa 2 — Itens */}
      {step === 1 && (
      <Card className="mb-5">
        <CardContent className="py-5">
          <h3 className="mb-3 text-sm font-semibold text-content-secondary">Itens</h3>

          {/* Linha de adição */}
          <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg bg-surface-secondary p-3">
            <div className="min-w-[240px] flex-1">
              <Label>Produto</Label>
              <Select aria-label="Produto" value={newProductId} onChange={(e) => setNewProductId(e.target.value)}>
                <option value="">— Selecione —</option>
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
            <Button type="button" variant="secondary" onClick={addItem}>
              <Plus size={16} />
              Adicionar
            </Button>
          </div>

          {/* Tabela de itens */}
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
                    const p = productMap.get(it.productId);
                    return (
                      <tr key={idx} className="border-b border-line">
                        <td className="py-2">
                          <p className="text-content">{p?.name ?? '—'}</p>
                          <p className="font-mono text-xs text-content-muted">{p?.sku}</p>
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
                            min="0.01"
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
      )}

      {/* Etapa 3 — Revisão */}
      {step === 2 && (
        <div className="mb-5 space-y-5">
          <FormSection title="Dados da venda" columns={3}>
            <Summary label="Cliente" value={customers.find((c) => c.id === customerId)?.name ?? 'Sem cliente'} />
            <Summary
              label="Depósito"
              value={(() => {
                const w = warehouses.find((x) => x.id === warehouseId);
                return w ? `${w.code} — ${w.name}` : '—';
              })()}
            />
            <Summary label="Observações" value={notes || '—'} />
          </FormSection>
          <FormSection title={`Itens (${items.length})`} columns={1}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-content-muted">
                  <th className="py-2 text-left font-medium">Produto</th>
                  <th className="py-2 text-right font-medium">Qtd</th>
                  <th className="py-2 text-right font-medium">Preço unit.</th>
                  <th className="py-2 text-right font-medium">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => {
                  const p = productMap.get(it.productId);
                  return (
                    <tr key={idx} className="border-b border-line/60 last:border-0">
                      <td className="py-2">
                        <p className="text-content">{p?.name ?? '—'}</p>
                        <p className="font-mono text-xs text-content-muted">{p?.sku}</p>
                      </td>
                      <td className="py-2 text-right tabular-nums">{it.quantity}</td>
                      <td className="py-2 text-right tabular-nums">{formatBRL(it.unitPrice)}</td>
                      <td className="py-2 text-right font-medium tabular-nums">
                        {formatBRL(it.quantity * it.unitPrice)}
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
                </tr>
              </tfoot>
            </table>
          </FormSection>
        </div>
      )}

      {/* navegação do wizard */}
      <div className="flex justify-between gap-3">
        <Button
          variant="secondary"
          onClick={() => (step === 0 ? router.push('/app/sales') : setStep((s) => s - 1))}
          disabled={create.isPending}
        >
          {step === 0 ? 'Cancelar' : 'Voltar'}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={next}>Próximo</Button>
        ) : (
          <Button onClick={submit} loading={create.isPending}>
            Criar ordem de venda
          </Button>
        )}
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-caption font-medium uppercase tracking-wide text-content-muted">{label}</p>
      <p className="mt-0.5 text-sm text-content">{value}</p>
    </div>
  );
}
