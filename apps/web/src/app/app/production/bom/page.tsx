'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, CheckCircle2, Info } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type { Product } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';

interface BomItem {
  id: string;
  quantity: string;
  scrapPct?: string;
  component?: { id: string; sku: string; name: string } | null;
}
interface BomVersion {
  id: string;
  version: number;
  isActive: boolean;
  items?: BomItem[];
}
interface DraftItem {
  componentId: string;
  quantity: number;
  scrapPct: number;
}

export default function BomPage() {
  const toast = useToast();
  const qc = useQueryClient();

  const { data: products = [] } = useList<Product>('/products');
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const [productId, setProductId] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState('');

  const versionsQ = useQuery({
    queryKey: ['/bom/product', productId],
    queryFn: async () => (await apiClient.get<BomVersion[]>(`/bom/product/${productId}`)).data,
    enabled: !!productId,
  });
  const versions = versionsQ.data ?? [];
  const selected = versions.find((v) => v.id === selectedVersionId) ?? versions.find((v) => v.isActive) ?? versions[0];

  const activate = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/bom/${id}/activate`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/bom/product', productId] }),
  });

  // Nova versão
  const [dialogOpen, setDialogOpen] = useState(false);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [newComp, setNewComp] = useState('');
  const [newQty, setNewQty] = useState('1');
  const [newScrap, setNewScrap] = useState('0');

  const create = useMutation({
    mutationFn: (payload: any) => apiClient.post('/bom', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/bom/product', productId] }),
  });

  function addItem() {
    if (!newComp) return toast.error('Selecione um componente');
    const qty = Number(newQty);
    if (!(qty > 0)) return toast.error('Quantidade deve ser maior que zero');
    setItems((prev) => [...prev, { componentId: newComp, quantity: qty, scrapPct: Number(newScrap) || 0 }]);
    setNewComp('');
    setNewQty('1');
    setNewScrap('0');
  }
  function submitVersion() {
    if (items.length === 0) return toast.error('Adicione ao menos um componente');
    create.mutate(
      { productId, items: items.map((it) => ({ componentId: it.componentId, quantity: it.quantity, scrapPct: it.scrapPct })) },
      {
        onSuccess: () => {
          toast.success('Nova versão de BOM criada');
          setDialogOpen(false);
          setItems([]);
        },
        onError: () => toast.error('Erro ao criar versão'),
      },
    );
  }

  return (
    <div>
      <PageHeader title="BOM — Lista Técnica" description="Estrutura de componentes por produto (versionada)." />

      <Card className="mb-5">
        <CardContent className="py-5">
          <Label>Produto pai</Label>
          <Select
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value);
              setSelectedVersionId('');
            }}
            className="max-w-md"
          >
            <option value="">— Selecione um produto —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} — {p.name}
              </option>
            ))}
          </Select>
        </CardContent>
      </Card>

      {!productId ? (
        <p className="rounded-xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-400">
          Selecione um produto para ver sua estrutura de componentes.
        </p>
      ) : versionsQ.isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : versions.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white py-12 text-center">
          <p className="mb-3 text-sm text-slate-400">Nenhuma versão de BOM para este produto.</p>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus size={16} />
            Criar primeira versão
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Versões:</span>
            {versions.map((v) => (
              <button
                key={v.id}
                onClick={() => setSelectedVersionId(v.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                  selected?.id === v.id ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                )}
              >
                v{v.version}
                {v.isActive && <Badge variant="success">Ativa</Badge>}
              </button>
            ))}
            <div className="ml-auto">
              <Button variant="secondary" onClick={() => setDialogOpen(true)}>
                <Plus size={16} />
                Nova versão
              </Button>
            </div>
          </div>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle className="text-base">Componentes — v{selected?.version}</CardTitle>
              {selected && !selected.isActive && (
                <Button
                  onClick={() =>
                    activate.mutate(selected.id, {
                      onSuccess: () => toast.success(`Versão v${selected.version} ativada`),
                      onError: () => toast.error('Erro ao ativar'),
                    })
                  }
                  loading={activate.isPending}
                >
                  <CheckCircle2 size={16} />
                  Ativar esta versão
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                    <th className="py-2 text-left font-medium">SKU</th>
                    <th className="py-2 text-left font-medium">Componente</th>
                    <th className="py-2 text-right font-medium">Quantidade</th>
                    <th className="py-2 text-right font-medium">Refugo %</th>
                  </tr>
                </thead>
                <tbody>
                  {(selected?.items ?? []).map((it) => (
                    <tr key={it.id} className="border-b border-slate-50">
                      <td className="py-2 font-mono text-xs text-slate-500">{it.component?.sku ?? '—'}</td>
                      <td className="py-2 text-slate-800">{it.component?.name ?? '—'}</td>
                      <td className="py-2 text-right tabular-nums">{formatNumber(Number(it.quantity))}</td>
                      <td className="py-2 text-right tabular-nums text-slate-500">{formatNumber(Number(it.scrapPct ?? 0))}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <div className="mt-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <Info size={14} className="mt-0.5 shrink-0" />
            <span>
              O BOM é <strong>versionado e imutável</strong>: para alterar a estrutura, crie uma
              <strong> nova versão</strong> e ative-a. Não há edição/remoção de item individual no backend.
            </span>
          </div>
        </>
      )}

      {/* Nova versão */}
      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Nova versão de BOM"
        description="Defina os componentes desta versão."
        formId="bom-form"
        submitLabel="Criar versão"
        loading={create.isPending}
      >
        <form
          id="bom-form"
          onSubmit={(e) => {
            e.preventDefault();
            submitVersion();
          }}
          className="space-y-4 py-1"
        >
          <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
            <div className="min-w-[180px] flex-1">
              <Label>Componente</Label>
              <Select value={newComp} onChange={(e) => setNewComp(e.target.value)}>
                <option value="">— Selecione —</option>
                {products.filter((p) => p.id !== productId).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-20">
              <Label>Qtd</Label>
              <Input type="number" min="0.01" step="0.01" value={newQty} onChange={(e) => setNewQty(e.target.value)} />
            </div>
            <div className="w-20">
              <Label>Refugo %</Label>
              <Input type="number" min="0" step="0.1" value={newScrap} onChange={(e) => setNewScrap(e.target.value)} />
            </div>
            <Button type="button" variant="secondary" onClick={addItem}>
              <Plus size={16} />
            </Button>
          </div>

          {items.length === 0 ? (
            <p className="py-3 text-center text-sm text-slate-400">Nenhum componente adicionado.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-1.5 text-left font-medium">Componente</th>
                  <th className="py-1.5 text-right font-medium">Qtd</th>
                  <th className="py-1.5 text-right font-medium">Refugo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => {
                  const p = productMap.get(it.componentId);
                  return (
                    <tr key={idx} className="border-b border-slate-50">
                      <td className="py-1.5">{p?.sku} — {p?.name}</td>
                      <td className="py-1.5 text-right tabular-nums">{it.quantity}</td>
                      <td className="py-1.5 text-right tabular-nums">{it.scrapPct}%</td>
                      <td className="py-1.5 text-right">
                        <button type="button" onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))} className="rounded-md p-1 text-slate-400 hover:text-danger">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </form>
      </FormDialog>
    </div>
  );
}
