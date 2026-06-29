'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { apiClient } from '@/lib/api-client';
import { Plus, ShoppingCart, CheckCircle, XCircle, Clock, Ban } from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type SalesOrderStatus = 'DRAFT' | 'RESERVED' | 'CONFIRMED' | 'CANCELLED';

interface SaleItem {
  productId: string;
  quantity: number;
  unitPrice: number;
}

interface SalesOrder {
  id: string;
  status: SalesOrderStatus;
  notes?: string;
  warehouseId: string;
  warehouse?: { name: string };
  customer?: { name: string } | null;
  items: Array<{ product: { name: string; sku: string }; quantity: string; unitPrice: string }>;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<SalesOrderStatus, { label: string; color: string; icon: React.FC<any> }> = {
  DRAFT: { label: 'Rascunho', color: 'bg-slate-100 text-slate-700', icon: Clock },
  RESERVED: { label: 'Reservado', color: 'bg-yellow-100 text-yellow-800', icon: ShoppingCart },
  CONFIRMED: { label: 'Confirmado', color: 'bg-green-100 text-green-800', icon: CheckCircle },
  CANCELLED: { label: 'Cancelado', color: 'bg-red-100 text-red-700', icon: Ban },
};

function StatusBadge({ status }: { status: SalesOrderStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.DRAFT;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

function totalOrder(items: SalesOrder['items']) {
  return items.reduce((acc, i) => acc + Number(i.quantity) * Number(i.unitPrice), 0);
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function VendasPage() {
  const user = useAuthStore((s) => s.user);
  const companyId = user?.companyId ?? '';
  const qc = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState<Record<string, string>>({});

  // Form state
  const [warehouseId, setWarehouseId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<Array<{ productId: string; quantity: string; unitPrice: string }>>([
    { productId: '', quantity: '', unitPrice: '' },
  ]);

  // ─── Queries ────────────────────────────────────────────────────────────────

  const { data: orders = [], isLoading } = useQuery<SalesOrder[]>({
    queryKey: ['sales', companyId],
    queryFn: () => apiClient.get(`/sales?companyId=${companyId}`).then((r) => r.data),
    enabled: !!companyId,
  });

  const { data: warehouses = [] } = useQuery<Array<{ id: string; name: string; code: string }>>({
    queryKey: ['warehouses', companyId],
    queryFn: () => apiClient.get(`/warehouses?companyId=${companyId}`).then((r) => r.data),
    enabled: !!companyId,
  });

  const { data: products = [] } = useQuery<Array<{ id: string; name: string; sku: string; salePrice?: string }>>({
    queryKey: ['products', companyId],
    queryFn: () => apiClient.get(`/products?companyId=${companyId}`).then((r) => r.data),
    enabled: !!companyId,
  });

  const { data: customers = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['customers', companyId],
    queryFn: () => apiClient.get(`/customers?companyId=${companyId}`).then((r) => r.data),
    enabled: !!companyId,
  });

  // ─── Mutations ───────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data: any) => apiClient.post('/sales', data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales', companyId] });
      setShowForm(false);
      resetForm();
    },
    onError: (err: any) => setFormError(err.response?.data?.message ?? 'Erro ao criar venda'),
  });

  const reserveMut = useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/sales/${id}/reserve?companyId=${companyId}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales', companyId] }),
    onError: (err: any, id: string) =>
      setActionError((prev) => ({ ...prev, [id]: err.response?.data?.message ?? 'Erro ao reservar' })),
  });

  const confirmMut = useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/sales/${id}/confirm?companyId=${companyId}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales', companyId] }),
    onError: (err: any, id: string) =>
      setActionError((prev) => ({ ...prev, [id]: err.response?.data?.message ?? 'Erro ao confirmar' })),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/sales/${id}/cancel?companyId=${companyId}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales', companyId] }),
    onError: (err: any, id: string) =>
      setActionError((prev) => ({ ...prev, [id]: err.response?.data?.message ?? 'Erro ao cancelar' })),
  });

  // ─── Handlers ────────────────────────────────────────────────────────────────

  function resetForm() {
    setWarehouseId('');
    setCustomerId('');
    setNotes('');
    setItems([{ productId: '', quantity: '', unitPrice: '' }]);
    setFormError('');
  }

  function handleProductChange(idx: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    setItems((prev) =>
      prev.map((item, i) =>
        i === idx
          ? { ...item, productId, unitPrice: product?.salePrice ?? item.unitPrice }
          : item,
      ),
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    const validItems = items.filter((i) => i.productId && i.quantity && i.unitPrice);
    if (!validItems.length) {
      setFormError('Adicione pelo menos um item com produto, quantidade e preço.');
      return;
    }
    createMutation.mutate({
      companyId,
      warehouseId,
      customerId: customerId || undefined,
      notes: notes || undefined,
      items: validItems.map((i) => ({
        productId: i.productId,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
      })),
    });
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Vendas</h2>
          <p className="text-slate-500 text-sm mt-0.5">Ordens de venda da filial</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setFormError(''); }}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          <Plus size={16} /> Nova Venda
        </button>
      </div>

      {/* Formulário nova venda */}
      {showForm && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h3 className="font-semibold text-slate-800">Nova Ordem de Venda</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Depósito *</label>
                <select
                  required
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Selecione...</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Cliente</label>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Sem cliente</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Itens */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-700">Itens *</label>
              {items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_120px_120px_32px] gap-2 items-center">
                  <select
                    value={item.productId}
                    onChange={(e) => handleProductChange(idx, e.target.value)}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">Produto...</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0.001"
                    step="any"
                    placeholder="Qtde"
                    value={item.quantity}
                    onChange={(e) =>
                      setItems((prev) => prev.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it))
                    }
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    placeholder="Preço unit."
                    value={item.unitPrice}
                    onChange={(e) =>
                      setItems((prev) => prev.map((it, i) => i === idx ? { ...it, unitPrice: e.target.value } : it))
                    }
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                    disabled={items.length === 1}
                    className="text-slate-400 hover:text-red-500 disabled:opacity-30 transition-colors"
                  >
                    <XCircle size={18} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setItems((prev) => [...prev, { productId: '', quantity: '', unitPrice: '' }])}
                className="text-sm text-brand-600 hover:underline"
              >
                + Adicionar item
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Observações</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Opcional"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            {formError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {formError}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {createMutation.isPending ? 'Salvando...' : 'Salvar Rascunho'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); resetForm(); }}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tabela de vendas */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Carregando...</div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">
            Nenhuma venda registrada ainda.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Venda</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Cliente</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Depósito</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Itens</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Total</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((order) => (
                <>
                  <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{order.id.slice(-8)}</td>
                    <td className="px-4 py-3 text-slate-700">{order.customer?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-700">{order.warehouse?.name ?? order.warehouseId}</td>
                    <td className="px-4 py-3 text-slate-500">{order.items.length} item(s)</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-800">
                      R$ {totalOrder(order.items).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {order.status === 'DRAFT' && (
                          <ActionButton
                            label="Reservar"
                            color="yellow"
                            loading={reserveMut.isPending}
                            onClick={() => {
                              setActionError((p) => ({ ...p, [order.id]: '' }));
                              reserveMut.mutate(order.id);
                            }}
                          />
                        )}
                        {order.status === 'RESERVED' && (
                          <ActionButton
                            label="Confirmar"
                            color="green"
                            loading={confirmMut.isPending}
                            onClick={() => {
                              setActionError((p) => ({ ...p, [order.id]: '' }));
                              confirmMut.mutate(order.id);
                            }}
                          />
                        )}
                        {(order.status === 'DRAFT' || order.status === 'RESERVED') && (
                          <ActionButton
                            label="Cancelar"
                            color="red"
                            loading={cancelMut.isPending}
                            onClick={() => {
                              setActionError((p) => ({ ...p, [order.id]: '' }));
                              cancelMut.mutate(order.id);
                            }}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                  {actionError[order.id] && (
                    <tr key={`err-${order.id}`}>
                      <td colSpan={7} className="px-4 pb-2">
                        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-1.5">
                          {actionError[order.id]}
                        </p>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── ActionButton ─────────────────────────────────────────────────────────────

function ActionButton({
  label,
  color,
  loading,
  onClick,
}: {
  label: string;
  color: 'yellow' | 'green' | 'red';
  loading: boolean;
  onClick: () => void;
}) {
  const styles = {
    yellow: 'bg-yellow-50 text-yellow-800 border-yellow-200 hover:bg-yellow-100',
    green: 'bg-green-50 text-green-800 border-green-200 hover:bg-green-100',
    red: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100',
  };
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`px-2.5 py-1 text-xs font-medium border rounded-lg transition-colors disabled:opacity-50 ${styles[color]}`}
    >
      {label}
    </button>
  );
}
