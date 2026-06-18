'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { apiClient } from '@/lib/api-client';
import { Plus, Truck, CheckCircle, XCircle, Clock, Ban, Package } from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type TransferStatus = 'DRAFT' | 'DISPATCHED' | 'RECEIVED' | 'CANCELLED';

interface TransferItem {
  quantity: string;
  unit: string;
  product: { name: string; sku: string };
}

interface StoreTransfer {
  id: string;
  status: TransferStatus;
  fromWarehouse: { name: string };
  toWarehouse: { name: string };
  notes?: string;
  items: TransferItem[];
  fiscalDocument?: { id: string; chave?: string; status: string } | null;
  dispatchedAt?: string;
  receivedAt?: string;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<TransferStatus, { label: string; color: string; icon: React.FC<{ className?: string }> }> = {
  DRAFT:      { label: 'Rascunho',    color: 'bg-slate-100 text-slate-700',  icon: Clock },
  DISPATCHED: { label: 'Em Trânsito', color: 'bg-yellow-100 text-yellow-800', icon: Truck },
  RECEIVED:   { label: 'Recebido',    color: 'bg-green-100 text-green-800',   icon: CheckCircle },
  CANCELLED:  { label: 'Cancelado',   color: 'bg-red-100 text-red-700',       icon: Ban },
};

function StatusBadge({ status }: { status: TransferStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.DRAFT;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      <Icon className="w-3 h-3" />{cfg.label}
    </span>
  );
}

function formatDate(date?: string) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('pt-BR');
}

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function TransferenciasPage() {
  const user = useAuthStore((s) => s.user);
  const companyId = user?.companyId ?? '';
  const qc = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ fromWarehouseId: '', toWarehouseId: '', notes: '', items: [{ productId: '', quantity: 1 }] });
  const [actionError, setActionError] = useState<Record<string, string>>({});

  // ─── Queries ────────────────────────────────────────────────────────────

  const { data: transfers = [], isLoading } = useQuery<StoreTransfer[]>({
    queryKey: ['transfers', companyId],
    queryFn: () => apiClient.get('/transfers').then((r) => r.data),
    enabled: !!companyId,
  });

  const { data: warehouses = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['warehouses', companyId],
    queryFn: () => apiClient.get(`/warehouses?companyId=${companyId}`).then((r) => r.data),
    enabled: !!companyId,
  });

  const { data: products = [] } = useQuery<Array<{ id: string; name: string; sku: string }>>({
    queryKey: ['products', companyId],
    queryFn: () => apiClient.get(`/products?companyId=${companyId}`).then((r) => r.data),
    enabled: !!companyId,
  });

  // ─── Mutations ──────────────────────────────────────────────────────────

  const createMut = useMutation({
    mutationFn: (body: object) => apiClient.post('/transfers', body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transfers'] });
      setShowForm(false);
      setForm({ fromWarehouseId: '', toWarehouseId: '', notes: '', items: [{ productId: '', quantity: 1 }] });
    },
    onError: (err: any) => setActionError((p) => ({ ...p, form: err?.response?.data?.message ?? err.message })),
  });

  const dispatchMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/transfers/${id}/dispatch`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transfers'] }),
    onError: (err: any, id) => setActionError((p) => ({ ...p, [id]: err?.response?.data?.message ?? err.message })),
  });

  const receiveMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/transfers/${id}/receive`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transfers'] }),
    onError: (err: any, id) => setActionError((p) => ({ ...p, [id]: err?.response?.data?.message ?? err.message })),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/transfers/${id}/cancel`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transfers'] }),
    onError: (err: any, id) => setActionError((p) => ({ ...p, [id]: err?.response?.data?.message ?? err.message })),
  });

  function handleSubmit() {
    createMut.mutate({
      companyId,
      fromWarehouseId: form.fromWarehouseId,
      toWarehouseId: form.toWarehouseId,
      notes: form.notes || undefined,
      items: form.items.filter((i) => i.productId),
    });
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Transferências</h1>
        <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700" onClick={() => setShowForm(!showForm)}>
          <Plus className="w-4 h-4" />Nova Transferência
        </button>
      </div>

      {/* Formulário */}
      {showForm && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">Nova Transferência</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Origem *</label>
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.fromWarehouseId} onChange={(e) => setForm((p) => ({ ...p, fromWarehouseId: e.target.value }))}>
                <option value="">Selecione...</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Destino *</label>
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.toWarehouseId} onChange={(e) => setForm((p) => ({ ...p, toWarehouseId: e.target.value }))}>
                <option value="">Selecione...</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Observações</label>
            <input type="text" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">Itens *</label>
              <button className="text-xs text-blue-600 hover:underline" onClick={() => setForm((p) => ({ ...p, items: [...p.items, { productId: '', quantity: 1 }] }))}>+ Adicionar</button>
            </div>
            {form.items.map((item, idx) => (
              <div key={idx} className="flex gap-3 items-center">
                <select className="flex-1 border rounded-lg px-3 py-2 text-sm" value={item.productId}
                  onChange={(e) => setForm((p) => ({ ...p, items: p.items.map((it, i) => i === idx ? { ...it, productId: e.target.value } : it) }))}>
                  <option value="">Produto...</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                </select>
                <input type="number" className="w-24 border rounded-lg px-3 py-2 text-sm" placeholder="Qtd" min={1} value={item.quantity}
                  onChange={(e) => setForm((p) => ({ ...p, items: p.items.map((it, i) => i === idx ? { ...it, quantity: Number(e.target.value) } : it) }))} />
                {form.items.length > 1 && (
                  <button className="text-red-400 hover:text-red-600" onClick={() => setForm((p) => ({ ...p, items: p.items.filter((_, i) => i !== idx) }))}>
                    <XCircle className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {actionError.form && <p className="text-xs text-red-500">{actionError.form}</p>}
          <div className="flex gap-3 justify-end pt-2">
            <button className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg" onClick={() => setShowForm(false)}>Cancelar</button>
            <button className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              disabled={createMut.isPending || !form.fromWarehouseId || !form.toWarehouseId} onClick={handleSubmit}>
              {createMut.isPending ? 'Criando...' : 'Criar Transferência'}
            </button>
          </div>
        </div>
      )}

      {/* Lista */}
      {isLoading ? (
        <p className="text-slate-500 text-sm">Carregando...</p>
      ) : transfers.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Nenhuma transferência registrada</p>
        </div>
      ) : (
        <div className="space-y-3">
          {transfers.map((tr) => (
            <div key={tr.id} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={tr.status} />
                    <span className="text-sm font-medium text-slate-700">{tr.fromWarehouse.name} → {tr.toWarehouse.name}</span>
                    <span className="text-xs text-slate-400">{formatDate(tr.createdAt)}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {tr.items.length} {tr.items.length === 1 ? 'produto' : 'produtos'}:{' '}
                    {tr.items.map((i) => `${i.product.name} (${Number(i.quantity)})`).join(', ')}
                  </div>
                  {tr.notes && <p className="text-xs text-slate-400 italic">{tr.notes}</p>}
                  {tr.fiscalDocument && (
                    <div className="text-xs text-slate-500">
                      NF-e: <span className="font-mono">{tr.fiscalDocument.chave ?? tr.fiscalDocument.id}</span>{' '}
                      <span className={`px-1 rounded text-xs ${tr.fiscalDocument.status === 'AUTHORIZED' ? 'bg-green-100 text-green-700' : tr.fiscalDocument.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {tr.fiscalDocument.status}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 flex-shrink-0 items-center">
                  {tr.status === 'DRAFT' && (
                    <>
                      <button className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700" onClick={() => dispatchMut.mutate(tr.id)} disabled={dispatchMut.isPending}>Despachar</button>
                      <button className="text-xs px-3 py-1.5 rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300" onClick={() => cancelMut.mutate(tr.id)} disabled={cancelMut.isPending}>Cancelar</button>
                    </>
                  )}
                  {tr.status === 'DISPATCHED' && (
                    <>
                      <button className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700" onClick={() => receiveMut.mutate(tr.id)} disabled={receiveMut.isPending}>Confirmar Recebimento</button>
                      <button className="text-xs px-3 py-1.5 rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300" onClick={() => cancelMut.mutate(tr.id)} disabled={cancelMut.isPending}>Cancelar</button>
                      <span className="text-xs text-slate-400">despachado {formatDate(tr.dispatchedAt)}</span>
                    </>
                  )}
                  {tr.status === 'RECEIVED' && <span className="text-xs text-green-600">recebido {formatDate(tr.receivedAt)}</span>}
                </div>
              </div>
              {actionError[tr.id] && <p className="text-xs text-red-500 mt-2">{actionError[tr.id]}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
