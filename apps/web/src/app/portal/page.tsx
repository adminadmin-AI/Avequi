'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LogOut, KeyRound, Info, Package, Wallet, AlertTriangle } from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { formatBRL, formatDate } from '@/lib/format';
import {
  portalClient,
  getPortalToken,
  setPortalToken,
  clearPortalToken,
} from '@/lib/portal-client';
import type { PurchaseOrderStatus, FinancialEntryStatus } from '@/types/api';

type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const PO_STATUS: Record<PurchaseOrderStatus, { label: string; variant: BadgeVariant }> = {
  DRAFT: { label: 'Rascunho', variant: 'neutral' },
  APPROVED: { label: 'Aprovada', variant: 'info' },
  PARTIALLY_RECEIVED: { label: 'Recebida parcial', variant: 'warning' },
  RECEIVED: { label: 'Recebida', variant: 'success' },
  CANCELLED: { label: 'Cancelada', variant: 'neutral' },
};
const PAY_STATUS: Record<FinancialEntryStatus, { label: string; variant: BadgeVariant }> = {
  OPEN: { label: 'Em aberto', variant: 'info' },
  OVERDUE: { label: 'Vencido', variant: 'danger' },
  PARTIALLY_PAID: { label: 'Pago parcial', variant: 'warning' },
  PAID: { label: 'Pago', variant: 'success' },
  CANCELLED: { label: 'Cancelado', variant: 'neutral' },
};

interface Profile { id: string; name: string; cnpj?: string | null; email?: string | null }
interface Summary { pendingOrders: number; pendingPayments: number; overduePayments: number; openNcrs: number }
interface PoItem { quantity: string; unitCost: string; product?: { sku: string; name: string } | null }
interface PortalPO { id: string; status: PurchaseOrderStatus; createdAt: string; items: PoItem[] }
interface PortalPayment { id: string; amount: string; dueDate: string; status: FinancialEntryStatus; paidAt: string | null; description: string | null }

function shortId(id: string) {
  return id.slice(-6).toUpperCase();
}
function poTotal(po: PortalPO) {
  return po.items.reduce((acc, i) => acc + Number(i.quantity) * Number(i.unitCost), 0);
}

function Kpi({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'warning' | 'danger' }) {
  const cls = { neutral: 'text-content', warning: 'text-warning', danger: 'text-danger' }[tone];
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-content-muted">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tracking-tight ${cls}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

// ─── Tela de acesso (token) ──────────────────────────────────────────────────
function TokenGate({ onAuth }: { onAuth: () => void }) {
  const toast = useToast();
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    setLoading(true);
    setPortalToken(token.trim());
    try {
      await portalClient.get('/supplier-portal/me');
      toast.success('Acesso liberado');
      onAuth();
    } catch {
      clearPortalToken();
      toast.error('Token inválido, expirado ou revogado');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-secondary px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="py-8">
          <div className="mb-6 flex flex-col items-center gap-2 text-center">
            <BrandMark size={36} />
            <h1 className="text-lg font-semibold text-content">Portal do Fornecedor</h1>
            <p className="text-sm text-content-muted">Informe o token de acesso enviado por e-mail.</p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label required>Token de acesso</Label>
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="cole aqui o token (UUID)"
                className="font-mono"
                autoFocus
              />
            </div>
            <Button type="submit" loading={loading} className="w-full">
              <KeyRound size={16} /> Entrar
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Dashboard do fornecedor ─────────────────────────────────────────────────
function PortalDashboard({ onLogout }: { onLogout: () => void }) {
  const profileQ = useQuery({ queryKey: ['portal/me'], queryFn: async () => (await portalClient.get<Profile>('/supplier-portal/me')).data });
  const summaryQ = useQuery({ queryKey: ['portal/summary'], queryFn: async () => (await portalClient.get<Summary>('/supplier-portal/me/summary')).data });
  const posQ = useQuery({ queryKey: ['portal/pos'], queryFn: async () => (await portalClient.get<PortalPO[]>('/supplier-portal/me/purchase-orders')).data });
  const payQ = useQuery({ queryKey: ['portal/payments'], queryFn: async () => (await portalClient.get<PortalPayment[]>('/supplier-portal/me/payments')).data });

  const profile = profileQ.data;
  const summary = summaryQ.data;
  const pos = posQ.data ?? [];
  const payments = payQ.data ?? [];

  return (
    <div className="min-h-screen bg-surface-secondary">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-line bg-surface px-6">
        <div className="flex items-center gap-2.5">
          <BrandMark size={24} />
          <span className="text-sm font-semibold text-content">Portal do Fornecedor</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-content-secondary">{profile?.name ?? '...'}</span>
          <button onClick={onLogout} title="Sair" className="rounded-lg p-2 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-content-secondary">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-6">
        <div className="mb-5 flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-content-muted">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            Bem-vindo{profile?.name ? `, ${profile.name}` : ''}. Acompanhe seus pedidos e pagamentos.
            As seções de <strong>cotações</strong> e <strong>upload de NF-e/documentos</strong> da especificação ainda
            não têm endpoint no portal do backend (pendência #247).
          </span>
        </div>

        {summary && (
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Pedidos a entregar" value={String(summary.pendingOrders)} />
            <Kpi label="Pagamentos em aberto" value={String(summary.pendingPayments)} tone={summary.pendingPayments > 0 ? 'warning' : 'neutral'} />
            <Kpi label="Pagamentos vencidos" value={String(summary.overduePayments)} tone={summary.overduePayments > 0 ? 'danger' : 'neutral'} />
            <Kpi label="NCRs abertas" value={String(summary.openNcrs)} tone={summary.openNcrs > 0 ? 'warning' : 'neutral'} />
          </div>
        )}

        {/* Pedidos de compra */}
        <Card className="mb-6">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Package size={16} /> Pedidos de Compra</CardTitle></CardHeader>
          <CardContent>
            {posQ.isLoading ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : pos.length === 0 ? (
              <p className="py-8 text-center text-sm text-content-muted">Nenhum pedido de compra.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-content-muted">
                    <th className="py-2 text-left font-medium">Nº</th>
                    <th className="py-2 text-left font-medium">Itens</th>
                    <th className="py-2 text-right font-medium">Total</th>
                    <th className="py-2 text-center font-medium">Status</th>
                    <th className="py-2 text-left font-medium">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {pos.map((po) => (
                    <tr key={po.id} className="border-b border-line">
                      <td className="py-2 font-mono text-xs font-medium">#{shortId(po.id)}</td>
                      <td className="py-2 text-content-secondary">{po.items.length} item(ns)</td>
                      <td className="py-2 text-right tabular-nums">{formatBRL(poTotal(po))}</td>
                      <td className="py-2 text-center"><Badge variant={PO_STATUS[po.status].variant}>{PO_STATUS[po.status].label}</Badge></td>
                      <td className="py-2 text-content-secondary">{formatDate(po.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Pagamentos */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Wallet size={16} /> Status de Pagamentos</CardTitle></CardHeader>
          <CardContent>
            {payQ.isLoading ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : payments.length === 0 ? (
              <p className="py-8 text-center text-sm text-content-muted">Nenhum pagamento registrado.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-content-muted">
                    <th className="py-2 text-left font-medium">Descrição</th>
                    <th className="py-2 text-right font-medium">Valor</th>
                    <th className="py-2 text-left font-medium">Vencimento</th>
                    <th className="py-2 text-center font-medium">Status</th>
                    <th className="py-2 text-left font-medium">Pago em</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b border-line">
                      <td className="py-2 text-content-secondary">{p.description || '—'}</td>
                      <td className="py-2 text-right tabular-nums">{formatBRL(Number(p.amount))}</td>
                      <td className="py-2 text-content-secondary">{formatDate(p.dueDate)}</td>
                      <td className="py-2 text-center"><Badge variant={PAY_STATUS[p.status].variant}>{PAY_STATUS[p.status].label}</Badge></td>
                      <td className="py-2 text-content-secondary">{p.paidAt ? formatDate(p.paidAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {(summary?.overduePayments ?? 0) > 0 && (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>Você possui pagamentos vencidos. Em caso de dúvida, entre em contato com o setor financeiro da GDR.</span>
          </div>
        )}
      </main>
    </div>
  );
}

export default function SupplierPortalPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  // Em mount, checa se há token salvo válido.
  useEffect(() => {
    const token = getPortalToken();
    if (!token) {
      setAuthed(false);
      return;
    }
    portalClient
      .get('/supplier-portal/me')
      .then(() => setAuthed(true))
      .catch(() => {
        clearPortalToken();
        setAuthed(false);
      });
  }, []);

  function logout() {
    clearPortalToken();
    setAuthed(false);
  }

  if (authed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-secondary">
        <Spinner size="lg" />
      </div>
    );
  }

  return authed ? <PortalDashboard onLogout={logout} /> : <TokenGate onAuth={() => setAuthed(true)} />;
}
