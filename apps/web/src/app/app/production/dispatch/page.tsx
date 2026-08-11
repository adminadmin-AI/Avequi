'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Factory,
  Package,
  Plus,
  Send,
  Trash2,
  Truck,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { erroDeAcao } from '@/lib/feedback';
import { useProductOptions } from '@/hooks/use-product-customer-options';

/**
 * #1056 — Despacho da Fábrica (sucessora do épico #815).
 *
 * Consulta POST /production/dispatch com um carrinho de modelos e mostra, por
 * centro de trabalho, o que cada operação PRODUZ (OS) e o que ela RECEBE (OC).
 *
 * Regras herdadas do contrato da API (documentadas no controller):
 * - Todas as quantidades chegam como STRING decimal exata (até 4 casas).
 *   NUNCA converter para number para exibir — reintroduziria erro de float.
 * - O POST é consulta: não grava nada. Sem toast de "salvo".
 * - O resultado cobre o tenant inteiro (filtro por centro do usuário é a #1019).
 */

interface CartLine {
  productId: string;
  label: string;
  quantity: number;
}

interface ProductRef {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: string;
}

interface OcItem extends ProductRef {
  sourceType: 'WORK_CENTER' | 'EXTERNAL_OR_STOCK' | 'UNDEFINED';
  fromWorkCenter: { workCenterId: string; code: string; name: string } | null;
}

interface Operation {
  routingStepId: string;
  stepOrder: number;
  stepName: string;
  isFirstStep: boolean;
  os: ProductRef;
  oc: OcItem[];
}

interface WorkCenterBlock {
  workCenterId: string;
  code: string;
  name: string;
  operations: Operation[];
}

interface Pendency {
  code: string;
  sku: string;
  name: string;
  quantity: string;
  detail: string;
}

interface DispatchResponse {
  cart: ProductRef[];
  workCenters: WorkCenterBlock[];
  pendencies: Pendency[];
  inconsistencies: { code: string; detail: string }[];
}

/** Quantidade da API (string decimal exata) sem zeros à direita: '2.0000' → '2'. */
function fmtQty(q: string) {
  return q.includes('.') ? q.replace(/\.?0+$/, '') : q;
}

export default function DispatchPage() {
  const toast = useToast();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [productId, setProductId] = useState('');
  const [productLabel, setProductLabel] = useState<string | undefined>();
  const [productSearch, setProductSearch] = useState('');
  const [qty, setQty] = useState('1');
  const [result, setResult] = useState<DispatchResponse | null>(null);
  // Setores começam RECOLHIDOS (decisão do Rafael 11/08: a lista completa era
  // informação demais); o planejador abre só o que interessa.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleCenter(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const { items: productItems, options: productOptions, isLoading: productsLoading } =
    useProductOptions({ search: productSearch, isActive: true });

  const dispatch = useMutation({
    mutationFn: async (lines: CartLine[]) =>
      (
        await apiClient.post<DispatchResponse>('/production/dispatch', {
          items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        })
      ).data,
    onSuccess: (data) => {
      setResult(data);
      setExpanded(new Set());
    },
    onError: (e) => toast.error(erroDeAcao('calcular o despacho', e)),
  });

  function addLine() {
    const quantity = Number(qty);
    if (!productId || !Number.isFinite(quantity) || quantity <= 0) return;
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === productId);
      if (existing) {
        return prev.map((l) =>
          l.productId === productId ? { ...l, quantity: l.quantity + quantity } : l,
        );
      }
      return [...prev, { productId, label: productLabel ?? productId, quantity }];
    });
    setProductId('');
    setProductLabel(undefined);
    setQty('1');
  }

  function removeLine(id: string) {
    setCart((prev) => prev.filter((l) => l.productId !== id));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Despacho da fábrica"
        description="Monte um carrinho de modelos e veja, por setor, o que cada operação produz (OS) e o que precisa receber (OC). Simulação: nada é gravado."
      />

      {/* ── Carrinho ─────────────────────────────────────────────────────── */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Label>Modelo</Label>
            <Combobox
              options={productOptions}
              value={productId}
              onValueChange={(v) => {
                setProductId(v);
                const p = productItems.find((i) => i.id === v);
                setProductLabel(p ? `${p.sku} · ${p.name}` : undefined);
              }}
              onQueryChange={setProductSearch}
              serverSideSearch
              selectedLabel={productLabel}
              loading={productsLoading}
              placeholder="Selecione um modelo"
              searchPlaceholder="Buscar por SKU ou nome..."
            />
          </div>
          <div className="w-28">
            <Label>Quantidade</Label>
            <Input type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <Button type="button" variant="secondary" onClick={addLine} disabled={!productId}>
            <Plus size={16} />
            Adicionar
          </Button>
        </div>

        {cart.length > 0 && (
          <ul className="mt-4 divide-y divide-border">
            {cart.map((l) => (
              <li key={l.productId} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <Badge variant="neutral">{l.quantity}×</Badge>{' '}
                  {l.label}
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={`Remover ${l.label}`}
                  onClick={() => removeLine(l.productId)}
                >
                  <Trash2 size={14} />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4">
          <Button
            onClick={() => dispatch.mutate(cart)}
            disabled={cart.length === 0 || dispatch.isPending}
            loading={dispatch.isPending}
          >
            <Send size={16} />
            Calcular despacho
          </Button>
        </div>
      </Card>

      {/* ── Avisos ───────────────────────────────────────────────────────── */}
      {result && result.inconsistencies.length > 0 && (
        <Alert variant="danger" title="Inconsistências de cadastro">
          <ul className="list-disc pl-4">
            {result.inconsistencies.map((i, n) => (
              <li key={n}>{i.detail}</li>
            ))}
          </ul>
        </Alert>
      )}
      {result && result.pendencies.length > 0 && (
        <Alert
          variant="warning"
          title={`${result.pendencies.length} pendência(s) de cadastro: itens fora do despacho`}
        >
          <ul className="list-disc pl-4">
            {result.pendencies.map((p, n) => (
              <li key={n}>
                <span className="font-medium">{p.sku}</span> — {p.detail}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {/* ── Resultado por centro de trabalho ─────────────────────────────── */}
      {result && result.workCenters.length === 0 && result.pendencies.length === 0 && (
        <EmptyState
          icon={Factory}
          title="Nada a despachar"
          description="O carrinho não gerou trabalho em nenhum centro. Adicione modelos e calcule de novo."
        />
      )}

      {/* Resumo do despacho */}
      {result && result.workCenters.length > 0 && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="font-semibold">Resumo do despacho</span>
            <span>
              <span className="font-medium">{result.workCenters.length}</span> setores
            </span>
            <span>
              <span className="font-medium">
                {result.workCenters.reduce((n, w) => n + w.operations.length, 0)}
              </span>{' '}
              operações
            </span>
            <span>
              <span className="font-medium">
                {result.workCenters.reduce(
                  (n, w) => n + w.operations.reduce((m, o) => m + o.oc.length, 0),
                  0,
                )}
              </span>{' '}
              itens a receber
            </span>
            {result.pendencies.length === 0 && result.inconsistencies.length === 0 && (
              <Badge variant="success">sem pendências</Badge>
            )}
          </div>
        </Card>
      )}

      {result?.workCenters.map((wcBlock) => {
        const isOpen = expanded.has(wcBlock.workCenterId);
        const totalOc = wcBlock.operations.reduce((n, o) => n + o.oc.length, 0);
        return (
        <Card key={wcBlock.workCenterId} className="p-0">
          <button
            type="button"
            onClick={() => toggleCenter(wcBlock.workCenterId)}
            aria-expanded={isOpen}
            className="flex w-full items-center gap-2 p-4 text-left"
          >
            {isOpen ? (
              <ChevronDown size={16} className="shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
            )}
            <Factory size={18} className="shrink-0 text-muted-foreground" />
            <h2 className="text-base font-semibold">{wcBlock.name}</h2>
            <Badge variant="neutral">{wcBlock.code}</Badge>
            <span className="ml-auto text-sm text-muted-foreground">
              {wcBlock.operations.length} operação(ões) · recebe {totalOc} item(ns)
            </span>
          </button>

          {isOpen && (
          <div className="space-y-3 px-4 pb-4">
            {wcBlock.operations.map((op) => (
              <div key={op.routingStepId} className="rounded-md border border-border p-3">
                <div className="mb-2 flex items-center gap-2 text-sm">
                  <Badge variant="brand">OS</Badge>
                  <span className="font-medium">
                    {op.stepName}: produzir {fmtQty(op.os.quantity)}× {op.os.name}
                  </span>
                  <span className="text-muted-foreground">({op.os.sku})</span>
                </div>

                {op.oc.length > 0 && (
                  <ul className="space-y-1 pl-1 text-sm">
                    {op.oc.map((item, n) => (
                      <li key={`${item.productId}-${n}`} className="flex flex-wrap items-center gap-2">
                        <Badge variant="neutral">OC</Badge>
                        <span>
                          receber {fmtQty(item.quantity)} {item.unit} de {item.name}
                        </span>
                        <span className="text-muted-foreground">({item.sku})</span>
                        {item.sourceType === 'WORK_CENTER' && item.fromWorkCenter ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <ArrowRight size={12} />
                            vem de {item.fromWorkCenter.name}
                          </span>
                        ) : item.sourceType === 'EXTERNAL_OR_STOCK' ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Package size={12} />
                            compra/estoque
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Truck size={12} />
                            origem indefinida
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          )}
        </Card>
        );
      })}
    </div>
  );
}
