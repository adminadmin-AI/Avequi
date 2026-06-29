'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { apiClient } from '@/lib/api-client';
import { Plus, BarChart2, Trash2, RefreshCw } from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface DemandForecast {
  id: string;
  period: string;
  quantity: string;
  notes?: string;
  product: { id: string; name: string; sku: string; unit: string };
}

interface ConsolidatedRow {
  productId: string;
  productName: string;
  productSku: string;
  period: string;
  totalQty: number;
  entries: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function periodLabel(period: string) {
  const [year, month] = period.split('-');
  const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${months[Number(month) - 1]}/${year}`;
}

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function DemandaPage() {
  const user = useAuthStore((s) => s.user);
  const companyId = user?.companyId ?? '';
  const qc = useQueryClient();

  const [tab, setTab]               = useState<'filial' | 'consolidado'>('filial');
  const [filterPeriod, setFilterPeriod] = useState(currentPeriod());
  const [showForm, setShowForm]     = useState(false);
  const [form, setForm]             = useState({ productId: '', period: currentPeriod(), quantity: '', notes: '' });

  // ─── Queries ────────────────────────────────────────────────────────────

  const { data: forecasts = [], isLoading } = useQuery<DemandForecast[]>({
    queryKey: ['demand', companyId, filterPeriod],
    queryFn: () => apiClient.get(`/demand?period=${filterPeriod}`).then((r) => r.data),
    enabled: !!companyId && tab === 'filial',
  });

  const { data: consolidated = [], isLoading: loadingConsolidated } = useQuery<ConsolidatedRow[]>({
    queryKey: ['demand-consolidated', filterPeriod],
    queryFn: () => apiClient.get(`/demand/consolidated?period=${filterPeriod}`).then((r) => r.data),
    enabled: !!companyId && tab === 'consolidado',
  });

  const { data: products = [] } = useQuery<Array<{ id: string; name: string; sku: string }>>({
    queryKey: ['products', companyId],
    queryFn: () => apiClient.get(`/products?companyId=${companyId}`).then((r) => r.data),
    enabled: !!companyId,
  });

  // ─── Mutations ──────────────────────────────────────────────────────────

  const upsertMut = useMutation({
    mutationFn: (body: object) => apiClient.post('/demand', body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['demand'] });
      qc.invalidateQueries({ queryKey: ['demand-consolidated'] });
      setShowForm(false);
      setForm({ productId: '', period: currentPeriod(), quantity: '', notes: '' });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/demand/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['demand'] });
      qc.invalidateQueries({ queryKey: ['demand-consolidated'] });
    },
  });

  function handleSubmit() {
    upsertMut.mutate({ companyId, productId: form.productId, period: form.period, quantity: Number(form.quantity), notes: form.notes || undefined });
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Previsão de Demanda</h1>
        <button className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700" onClick={() => setShowForm(!showForm)}>
          <Plus className="w-4 h-4" />Registrar Demanda
        </button>
      </div>

      {/* Formulário */}
      {showForm && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">Nova / Atualizar Previsão</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Produto *</label>
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.productId} onChange={(e) => setForm((p) => ({ ...p, productId: e.target.value }))}>
                <option value="">Selecione...</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Período *</label>
              <input type="month" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.period} onChange={(e) => setForm((p) => ({ ...p, period: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Quantidade *</label>
              <input type="number" min={0} className="w-full border rounded-lg px-3 py-2 text-sm" value={form.quantity} onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Observação</label>
            <input type="text" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Ex: Aumento sazonal para inverno..." value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-3">
            <button className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg" onClick={() => setShowForm(false)}>Cancelar</button>
            <button className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
              disabled={upsertMut.isPending || !form.productId || !form.period || !form.quantity} onClick={handleSubmit}>
              {upsertMut.isPending ? 'Salvando...' : 'Salvar Previsão'}
            </button>
          </div>
        </div>
      )}

      {/* Filtro de período */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-600">Período:</label>
        <input type="month" className="border rounded-lg px-3 py-1.5 text-sm" value={filterPeriod} onChange={(e) => setFilterPeriod(e.target.value)} />
        <span className="text-sm font-medium text-slate-700">{periodLabel(filterPeriod)}</span>
      </div>

      {/* Abas */}
      <div className="flex gap-1 border-b border-slate-200">
        {(['filial', 'consolidado'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${tab === t ? 'border-b-2 border-brand-600 text-brand-600' : 'text-slate-500 hover:text-slate-700'}`}>
            {t === 'filial' ? 'Minha Filial' : 'Consolidado (PCP)'}
          </button>
        ))}
      </div>

      {/* Tab: Filial */}
      {tab === 'filial' && (
        isLoading ? <p className="text-slate-500 text-sm">Carregando...</p>
        : forecasts.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <BarChart2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Nenhuma previsão para {periodLabel(filterPeriod)}</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 uppercase text-xs tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Produto</th>
                  <th className="px-4 py-3 text-left">SKU</th>
                  <th className="px-4 py-3 text-right">Qtd Prevista</th>
                  <th className="px-4 py-3 text-left">Unidade</th>
                  <th className="px-4 py-3 text-left">Observação</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {forecasts.map((f) => (
                  <tr key={f.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{f.product.name}</td>
                    <td className="px-4 py-3 font-mono text-slate-500 text-xs">{f.product.sku}</td>
                    <td className="px-4 py-3 text-right font-semibold">{Number(f.quantity).toLocaleString('pt-BR')}</td>
                    <td className="px-4 py-3 text-slate-500">{f.product.unit}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs italic">{f.notes ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button className="text-slate-400 hover:text-red-500 transition-colors" onClick={() => deleteMut.mutate(f.id)} disabled={deleteMut.isPending} title="Excluir">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Tab: Consolidado */}
      {tab === 'consolidado' && (
        loadingConsolidated ? <p className="text-slate-500 text-sm">Carregando...</p>
        : consolidated.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <RefreshCw className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Nenhuma demanda consolidada para {periodLabel(filterPeriod)}</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 uppercase text-xs tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Produto</th>
                  <th className="px-4 py-3 text-left">SKU</th>
                  <th className="px-4 py-3 text-right">Qtd Total</th>
                  <th className="px-4 py-3 text-right">Filiais</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {consolidated.map((row) => (
                  <tr key={`${row.productId}::${row.period}`} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{row.productName}</td>
                    <td className="px-4 py-3 font-mono text-slate-500 text-xs">{row.productSku}</td>
                    <td className="px-4 py-3 text-right font-bold text-brand-700 text-base">{row.totalQty.toLocaleString('pt-BR')}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{row.entries}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50">
                <tr>
                  <td colSpan={2} className="px-4 py-3 text-xs text-slate-500 font-medium">{consolidated.length} produto(s)</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-700">{consolidated.reduce((s, r) => s + r.totalQty, 0).toLocaleString('pt-BR')}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}
    </div>
  );
}
