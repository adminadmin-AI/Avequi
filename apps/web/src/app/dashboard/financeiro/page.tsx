'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { apiClient } from '@/lib/api-client';
import { CheckCircle, XCircle, Clock, DollarSign, TrendingUp, TrendingDown } from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type EntryType = 'RECEIVABLE' | 'PAYABLE';
type EntryStatus = 'OPEN' | 'PAID' | 'CANCELLED';

interface FinancialEntry {
  id: string;
  type: EntryType;
  status: EntryStatus;
  amount: string;
  dueDate: string;
  description?: string;
  paidAt?: string;
  paidAmount?: string;
  paymentNote?: string;
  salesOrder?: { customer?: { name: string } | null } | null;
  purchaseOrder?: { supplier?: { name: string } } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<EntryType, { label: string; color: string; icon: React.FC<{ className?: string }> }> = {
  RECEIVABLE: { label: 'A Receber', color: 'bg-green-100 text-green-800', icon: TrendingUp },
  PAYABLE:    { label: 'A Pagar',   color: 'bg-red-100 text-red-800',     icon: TrendingDown },
};

const STATUS_CONFIG: Record<EntryStatus, { label: string; color: string; icon: React.FC<{ className?: string }> }> = {
  OPEN:      { label: 'Em Aberto', color: 'bg-yellow-100 text-yellow-800', icon: Clock },
  PAID:      { label: 'Pago',      color: 'bg-green-100 text-green-800',   icon: CheckCircle },
  CANCELLED: { label: 'Cancelado', color: 'bg-slate-100 text-slate-600',   icon: XCircle },
};

function TypeBadge({ type }: { type: EntryType }) {
  const cfg = TYPE_CONFIG[type];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      <Icon className="w-3 h-3" />{cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status: EntryStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.OPEN;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      <Icon className="w-3 h-3" />{cfg.label}
    </span>
  );
}

function formatCurrency(value: string | number) {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(date?: string) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('pt-BR');
}

function isOverdue(dueDate: string, status: EntryStatus) {
  return status === 'OPEN' && new Date(dueDate) < new Date();
}

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function FinanceiroPage() {
  const user = useAuthStore((s) => s.user);
  const companyId = user?.companyId ?? '';
  const qc = useQueryClient();

  const [filterType, setFilterType]     = useState<EntryType | ''>('');
  const [filterStatus, setFilterStatus] = useState<EntryStatus | ''>('');
  const [dueDateFrom, setDueDateFrom]   = useState('');
  const [dueDateTo, setDueDateTo]       = useState('');
  const [payModal, setPayModal]         = useState<{ id: string; amount: string } | null>(null);
  const [payForm, setPayForm]           = useState({ paidAt: '', paidAmount: '', paymentNote: '' });
  const [actionError, setActionError]   = useState<Record<string, string>>({});

  // ─── Query ─────────────────────────────────────────────────────────────

  const params = new URLSearchParams();
  if (filterType)   params.set('type', filterType);
  if (filterStatus) params.set('status', filterStatus);
  if (dueDateFrom)  params.set('dueDateFrom', dueDateFrom);
  if (dueDateTo)    params.set('dueDateTo', dueDateTo);

  const { data: entries = [], isLoading } = useQuery<FinancialEntry[]>({
    queryKey: ['finance', companyId, filterType, filterStatus, dueDateFrom, dueDateTo],
    queryFn: () => apiClient.get(`/finance?${params.toString()}`).then((r) => r.data),
    enabled: !!companyId,
  });

  // ─── Mutations ─────────────────────────────────────────────────────────

  const payMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      apiClient.patch(`/finance/${id}/pay`, body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance'] });
      setPayModal(null);
      setPayForm({ paidAt: '', paidAmount: '', paymentNote: '' });
    },
    onError: (err: any, vars) =>
      setActionError((p) => ({ ...p, [vars.id]: err?.response?.data?.message ?? err.message })),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/finance/${id}/cancel`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finance'] }),
    onError: (err: any, id) =>
      setActionError((p) => ({ ...p, [id]: err?.response?.data?.message ?? err.message })),
  });

  // ─── Totais ────────────────────────────────────────────────────────────

  const openReceivable = entries.filter((e) => e.type === 'RECEIVABLE' && e.status === 'OPEN').reduce((s, e) => s + Number(e.amount), 0);
  const openPayable    = entries.filter((e) => e.type === 'PAYABLE'    && e.status === 'OPEN').reduce((s, e) => s + Number(e.amount), 0);

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">Financeiro</h1>

      {/* Totais */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 flex items-center gap-3">
          <TrendingUp className="w-8 h-8 text-green-600" />
          <div>
            <p className="text-xs text-green-700 font-medium uppercase tracking-wide">A Receber (em aberto)</p>
            <p className="text-xl font-bold text-green-800">{formatCurrency(openReceivable)}</p>
          </div>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-center gap-3">
          <TrendingDown className="w-8 h-8 text-red-600" />
          <div>
            <p className="text-xs text-red-700 font-medium uppercase tracking-wide">A Pagar (em aberto)</p>
            <p className="text-xl font-bold text-red-800">{formatCurrency(openPayable)}</p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-end bg-slate-50 border border-slate-200 rounded-xl p-4">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Tipo</label>
          <select className="border rounded-lg px-3 py-1.5 text-sm" value={filterType} onChange={(e) => setFilterType(e.target.value as EntryType | '')}>
            <option value="">Todos</option>
            <option value="RECEIVABLE">A Receber</option>
            <option value="PAYABLE">A Pagar</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Status</label>
          <select className="border rounded-lg px-3 py-1.5 text-sm" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as EntryStatus | '')}>
            <option value="">Todos</option>
            <option value="OPEN">Em Aberto</option>
            <option value="PAID">Pago</option>
            <option value="CANCELLED">Cancelado</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Vencimento de</label>
          <input type="date" className="border rounded-lg px-3 py-1.5 text-sm" value={dueDateFrom} onChange={(e) => setDueDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Vencimento até</label>
          <input type="date" className="border rounded-lg px-3 py-1.5 text-sm" value={dueDateTo} onChange={(e) => setDueDateTo(e.target.value)} />
        </div>
        <button className="text-xs text-slate-500 underline" onClick={() => { setFilterType(''); setFilterStatus(''); setDueDateFrom(''); setDueDateTo(''); }}>
          Limpar filtros
        </button>
      </div>

      {/* Tabela */}
      {isLoading ? (
        <p className="text-slate-500 text-sm">Carregando...</p>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <DollarSign className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Nenhum lançamento encontrado</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 uppercase text-xs tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Tipo</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Descrição</th>
                <th className="px-4 py-3 text-left">Contraparte</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3 text-left">Vencimento</th>
                <th className="px-4 py-3 text-left">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((entry) => {
                const overdue = isOverdue(entry.dueDate, entry.status);
                const counterpart = entry.salesOrder?.customer?.name ?? entry.purchaseOrder?.supplier?.name ?? '—';
                return (
                  <tr key={entry.id} className={`hover:bg-slate-50 ${overdue ? 'bg-red-50' : ''}`}>
                    <td className="px-4 py-3"><TypeBadge type={entry.type} /></td>
                    <td className="px-4 py-3"><StatusBadge status={entry.status} /></td>
                    <td className="px-4 py-3 text-slate-700 max-w-xs truncate" title={entry.description}>{entry.description ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{counterpart}</td>
                    <td className="px-4 py-3 text-right font-mono font-medium">{formatCurrency(entry.amount)}</td>
                    <td className={`px-4 py-3 ${overdue ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>
                      {formatDate(entry.dueDate)}{overdue && <span className="ml-1 text-xs">(vencido)</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {entry.status === 'OPEN' && (
                          <>
                            <button className="text-xs px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700"
                              onClick={() => { setPayModal({ id: entry.id, amount: entry.amount }); setPayForm({ paidAt: new Date().toISOString().split('T')[0], paidAmount: String(Number(entry.amount)), paymentNote: '' }); }}>
                              Baixar
                            </button>
                            <button className="text-xs px-2 py-1 rounded bg-slate-200 text-slate-700 hover:bg-slate-300"
                              onClick={() => cancelMut.mutate(entry.id)} disabled={cancelMut.isPending}>
                              Cancelar
                            </button>
                          </>
                        )}
                        {entry.status === 'PAID' && entry.paidAt && (
                          <span className="text-xs text-slate-400">Pago em {formatDate(entry.paidAt)} — {formatCurrency(entry.paidAmount ?? 0)}</span>
                        )}
                      </div>
                      {actionError[entry.id] && <p className="text-xs text-red-500 mt-1">{actionError[entry.id]}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de baixa */}
      {payModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md space-y-4">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-green-600" />Registrar Pagamento
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Data do pagamento *</label>
                <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={payForm.paidAt} onChange={(e) => setPayForm((p) => ({ ...p, paidAt: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Valor pago (R$) *</label>
                <input type="number" step="0.01" className="w-full border rounded-lg px-3 py-2 text-sm" value={payForm.paidAmount} onChange={(e) => setPayForm((p) => ({ ...p, paidAmount: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Comprovante / Observação</label>
                <input type="text" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="PIX, TED, Boleto nº..." value={payForm.paymentNote} onChange={(e) => setPayForm((p) => ({ ...p, paymentNote: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100" onClick={() => setPayModal(null)}>Cancelar</button>
              <button
                className="px-4 py-2 rounded-lg text-sm bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                disabled={payMut.isPending || !payForm.paidAt || !payForm.paidAmount}
                onClick={() => payMut.mutate({ id: payModal.id, body: { paidAt: payForm.paidAt, paidAmount: Number(payForm.paidAmount), paymentNote: payForm.paymentNote || undefined } })}>
                {payMut.isPending ? 'Salvando...' : 'Confirmar Baixa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
