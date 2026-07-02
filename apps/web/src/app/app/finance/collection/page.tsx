'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Barcode, ExternalLink, Mail, MessageCircle, Phone } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import type { Boleto, PixCharge, BoletoStatus } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { formatBRL, formatDate } from '@/lib/format';

type CollectionChannel = 'EMAIL' | 'WHATSAPP' | 'PHONE';

interface Paginated<T> { data: T[]; total: number }
interface Overview {
  totals: { currentBalance: number; projectedBalance: number };
  receivables: { openCount: number; openAmount: number; overdueCount: number };
  payables: { openCount: number; openAmount: number; overdueCount: number };
}
interface DailyReport {
  totalOverdue: number;
  totalCollected: number;
  totalPending: number;
  conversionRate: number;
  overdueCount: number;
  collectedCount: number;
}
interface CollectionItem {
  id: string;
  source: 'FINANCIAL_ENTRY' | 'RECEIVABLE';
  customerName: string | null;
  customerId: string | null;
  amount: number;
  dueDate: string;
  daysOverdue: number;
  description: string | null;
  attemptCount: number;
  lastAttemptDate: string | null;
  lastAttemptChannel: string | null;
}

const BOLETO_LABEL: Record<BoletoStatus, string> = {
  PENDING: 'Pendente', REGISTERED: 'Registrado', PAID: 'Pago',
  CANCELLED: 'Cancelado', OVERDUE: 'Vencido', WRITTEN_OFF: 'Baixado',
};
const PIX_LABEL: Record<string, string> = {
  ACTIVE: 'Ativa', PAID: 'Paga', CANCELLED: 'Cancelada', EXPIRED: 'Expirada',
};
const CHANNEL_LABEL: Record<string, string> = {
  EMAIL: 'E-mail', WHATSAPP: 'WhatsApp', PHONE: 'Telefone',
};
const BOLETO_PENDENTE: BoletoStatus[] = ['PENDING', 'REGISTERED', 'OVERDUE'];

function Kpi({ label, value, hint, tone = 'neutral' }: { label: string; value: string; hint?: string; tone?: 'neutral' | 'warning' | 'danger' | 'success' }) {
  const cls = { neutral: 'text-content', warning: 'text-warning', danger: 'text-danger', success: 'text-success' }[tone];
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-content-muted">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tracking-tight ${cls}`}>{value}</p>
        {hint && <p className="mt-0.5 text-xs text-content-muted">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function CollectionMonitorPage() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();

  const reportQ = useQuery({
    queryKey: ['/billing/daily-report'],
    queryFn: async () => (await apiClient.get<DailyReport>('/billing/daily-report')).data,
  });
  const statusQ = useQuery({
    queryKey: ['/billing/collection/status'],
    queryFn: async () => (await apiClient.get<CollectionItem[]>('/billing/collection/status')).data,
  });
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

  const trigger = useMutation({
    mutationFn: async ({ id, channel }: { id: string; channel: CollectionChannel }) =>
      apiClient.post('/billing/collection/trigger', { ids: [id], channel }),
    onSuccess: (_res, { channel }) => {
      qc.invalidateQueries({ queryKey: ['/billing/collection/status'] });
      qc.invalidateQueries({ queryKey: ['/billing/daily-report'] });
      toast.success(`Cobrança registrada via ${CHANNEL_LABEL[channel]}`);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Erro ao registrar cobrança'),
  });

  const report = reportQ.data;
  const overdue = statusQ.data ?? [];
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

  const collectionColumns: Column<CollectionItem>[] = [
    {
      key: 'customer',
      header: 'Cliente',
      cell: (r) => (
        <div>
          <p className="text-sm text-content">{r.customerName ?? '—'}</p>
          {r.description && <p className="text-xs text-content-muted">{r.description}</p>}
        </div>
      ),
    },
    {
      key: 'dueDate',
      header: 'Vencimento',
      sortable: true,
      accessor: (r) => r.daysOverdue,
      cell: (r) => (
        <div className="flex items-center gap-2">
          <span className="text-sm">{formatDate(r.dueDate)}</span>
          <Badge variant="danger">{r.daysOverdue}d</Badge>
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Valor',
      align: 'right',
      sortable: true,
      accessor: (r) => r.amount,
      cell: (r) => <span className="font-medium tabular-nums">{formatBRL(r.amount)}</span>,
    },
    {
      key: 'attempts',
      header: 'Tentativas',
      align: 'center',
      cell: (r) =>
        r.attemptCount > 0 ? (
          <div className="text-xs text-content-muted">
            <span className="font-medium text-content-secondary">{r.attemptCount}</span>
            {r.lastAttemptChannel && (
              <span> · {CHANNEL_LABEL[r.lastAttemptChannel] ?? r.lastAttemptChannel}</span>
            )}
            {r.lastAttemptDate && <span> · {formatDate(r.lastAttemptDate)}</span>}
          </div>
        ) : (
          <span className="text-xs text-content-muted">—</span>
        ),
    },
    {
      key: 'actions',
      header: 'Cobrar',
      align: 'right',
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          {([
            { ch: 'EMAIL' as const, Icon: Mail },
            { ch: 'WHATSAPP' as const, Icon: MessageCircle },
            { ch: 'PHONE' as const, Icon: Phone },
          ]).map(({ ch, Icon }) => (
            <button
              key={ch}
              disabled={trigger.isPending}
              onClick={(e) => {
                e.stopPropagation();
                trigger.mutate({ id: r.id, channel: ch });
              }}
              title={`Registrar cobrança via ${CHANNEL_LABEL[ch]}`}
              className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
      ),
    },
  ];

  const loading = reportQ.isLoading || statusQ.isLoading || overviewQ.isLoading;

  return (
    <div>
      <PageHeader
        title="Monitor de Cobrança"
        description="Recebíveis vencidos, régua de cobrança e cobranças (boleto/PIX) emitidas."
        actions={
          <Button variant="secondary" onClick={() => router.push('/app/finance/collection-tools')}>
            <Barcode size={16} /> Emitir cobrança
          </Button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Total vencido"
              value={formatBRL(report?.totalOverdue ?? 0)}
              hint={`${report?.overdueCount ?? 0} título(s)`}
              tone={(report?.totalOverdue ?? 0) > 0 ? 'danger' : 'neutral'}
            />
            <Kpi
              label="Recebido hoje"
              value={formatBRL(report?.totalCollected ?? 0)}
              hint={`${report?.collectedCount ?? 0} baixa(s)`}
              tone="success"
            />
            <Kpi label="A vencer (em aberto)" value={formatBRL(report?.totalPending ?? 0)} />
            <Kpi
              label="Taxa de conversão (dia)"
              value={`${(report?.conversionRate ?? 0).toFixed(1)}%`}
              tone={(report?.conversionRate ?? 0) >= 50 ? 'success' : 'warning'}
            />
          </div>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">Régua de cobrança — recebíveis vencidos</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                data={overdue}
                columns={collectionColumns}
                searchPlaceholder="Buscar por cliente..."
                emptyMessage="Nenhum recebível vencido. 🎉"
              />
            </CardContent>
          </Card>

          <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Recebíveis em aberto" value={formatBRL(overview?.receivables?.openAmount ?? 0)} hint={`${overview?.receivables?.openCount ?? 0} título(s)`} />
            <Kpi label="Recebíveis vencidos" value={String(overview?.receivables?.overdueCount ?? 0)} tone={(overview?.receivables?.overdueCount ?? 0) > 0 ? 'danger' : 'neutral'} />
            <Kpi label="Boletos a receber" value={String(boletoPendentes)} tone={boletoPendentes > 0 ? 'warning' : 'neutral'} />
            <Kpi label="Cobranças PIX ativas" value={String(pixAtivas)} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Boletos por status</CardTitle></CardHeader>
              <CardContent>
                {boletoByStatus.length === 0 ? (
                  <p className="py-12 text-center text-sm text-content-muted">Nenhum boleto emitido.</p>
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
                  <p className="py-12 text-center text-sm text-content-muted">Nenhuma cobrança PIX emitida.</p>
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
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
            >
              Ver carteira de recebíveis <ExternalLink size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
