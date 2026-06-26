'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Barcode, ExternalLink, Info } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import type { Boleto, PixCharge, BoletoStatus } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { formatBRL } from '@/lib/format';

interface Paginated<T> { data: T[]; total: number }
interface Overview {
  totals: { currentBalance: number; projectedBalance: number };
  receivables: { openCount: number; openAmount: number; overdueCount: number };
  payables: { openCount: number; openAmount: number; overdueCount: number };
}

const BOLETO_LABEL: Record<BoletoStatus, string> = {
  PENDING: 'Pendente', REGISTERED: 'Registrado', PAID: 'Pago',
  CANCELLED: 'Cancelado', OVERDUE: 'Vencido', WRITTEN_OFF: 'Baixado',
};
const PIX_LABEL: Record<string, string> = {
  ACTIVE: 'Ativa', PAID: 'Paga', CANCELLED: 'Cancelada', EXPIRED: 'Expirada',
};
const BOLETO_PENDENTE: BoletoStatus[] = ['PENDING', 'REGISTERED', 'OVERDUE'];

function Kpi({ label, value, hint, tone = 'neutral' }: { label: string; value: string; hint?: string; tone?: 'neutral' | 'warning' | 'danger' | 'success' }) {
  const cls = { neutral: 'text-slate-900', warning: 'text-warning', danger: 'text-danger', success: 'text-success' }[tone];
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tracking-tight ${cls}`}>{value}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function CollectionMonitorPage() {
  const router = useRouter();

  const overviewQ = useQuery({
    queryKey: ['/banking/overview'],
    queryFn: async () => (await apiClient.get<Overview>('/banking/overview')).data,
  });
  const boletosQ = useQuery({
    queryKey: ['/banking/boletos', 'monitor'],
    queryFn: async () => (await apiClient.get<Paginated<Boleto>>('/banking/boletos', { params: { limit: 500 } })).data,
  });
  const pixQ = useQuery({
    queryKey: ['/banking/pix/charges', 'monitor'],
    queryFn: async () => (await apiClient.get<Paginated<PixCharge>>('/banking/pix/charges', { params: { limit: 500 } })).data,
  });

  const overview = overviewQ.data;
  const boletos = boletosQ.data?.data ?? [];
  const pix = pixQ.data?.data ?? [];

  const boletoPendentes = boletos.filter((b) => BOLETO_PENDENTE.includes(b.status)).length;
  const pixAtivas = pix.filter((p) => p.status === 'ACTIVE').length;

  const boletoByStatus = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of boletos) map.set(b.status, (map.get(b.status) ?? 0) + 1);
    return (Object.keys(BOLETO_LABEL) as BoletoStatus[])
      .filter((s) => map.get(s))
      .map((s) => ({ label: BOLETO_LABEL[s], total: map.get(s) ?? 0 }));
  }, [boletos]);

  const pixByStatus = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of pix) map.set(p.status, (map.get(p.status) ?? 0) + 1);
    return Object.keys(PIX_LABEL)
      .filter((s) => map.get(s))
      .map((s) => ({ label: PIX_LABEL[s], total: map.get(s) ?? 0 }));
  }, [pix]);

  const loading = overviewQ.isLoading || boletosQ.isLoading || pixQ.isLoading;

  return (
    <div>
      <PageHeader
        title="Monitor de Cobrança"
        description="Acompanhamento de recebíveis e das cobranças (boleto/PIX) emitidas."
        actions={
          <Button variant="secondary" onClick={() => router.push('/app/finance/collection-tools')}>
            <Barcode size={16} /> Emitir cobrança
          </Button>
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          Monitor montado sobre <code>/banking/overview</code> + boletos/PIX. Não há (ainda) um endpoint
          dedicado de "cobrança automática" com régua/disparos (<code>/billing/collection</code>) — pendência #247.
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Recebíveis em aberto" value={formatBRL(overview?.receivables.openAmount ?? 0)} hint={`${overview?.receivables.openCount ?? 0} título(s)`} />
            <Kpi label="Recebíveis vencidos" value={String(overview?.receivables.overdueCount ?? 0)} tone={(overview?.receivables.overdueCount ?? 0) > 0 ? 'danger' : 'neutral'} />
            <Kpi label="Boletos a receber" value={String(boletoPendentes)} tone={boletoPendentes > 0 ? 'warning' : 'neutral'} />
            <Kpi label="Cobranças PIX ativas" value={String(pixAtivas)} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Boletos por status</CardTitle></CardHeader>
              <CardContent>
                {boletoByStatus.length === 0 ? (
                  <p className="py-12 text-center text-sm text-slate-400">Nenhum boleto emitido.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={boletoByStatus} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
                      <YAxis tick={{ fontSize: 12, fill: '#64748b' }} allowDecimals={false} width={32} />
                      <Tooltip />
                      <Bar dataKey="total" name="Boletos" fill="#3D2CE6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Cobranças PIX por status</CardTitle></CardHeader>
              <CardContent>
                {pixByStatus.length === 0 ? (
                  <p className="py-12 text-center text-sm text-slate-400">Nenhuma cobrança PIX emitida.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={pixByStatus} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
                      <YAxis tick={{ fontSize: 12, fill: '#64748b' }} allowDecimals={false} width={32} />
                      <Tooltip />
                      <Bar dataKey="total" name="PIX" fill="#00C2A8" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              onClick={() => router.push('/app/finance/receivables')}
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              Ver carteira de recebíveis <ExternalLink size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
