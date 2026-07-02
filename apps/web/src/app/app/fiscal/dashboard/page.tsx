'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { ArrowLeft, AlertTriangle, Clock } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type { FiscalDocument } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/format';
import { FISCAL_TYPE_LABEL } from '../fiscal-status';

const RESOURCE = '/fiscal';
const HOUR = 3_600_000;

function Kpi({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'success' | 'danger' }) {
  const cls = { neutral: 'text-content', success: 'text-success', danger: 'text-danger' }[tone];
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-content-muted">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tracking-tight ${cls}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

export default function FiscalDashboardPage() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();

  const { data: docs = [], isLoading } = useList<FiscalDocument>(RESOURCE);

  const retry = useMutation({
    mutationFn: (id: string) => apiClient.post(`${RESOURCE}/${id}/retry`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: [RESOURCE] }),
  });

  const now = Date.now();

  const stats = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    let monthTotal = 0,
      authorized = 0,
      rejected = 0;
    for (const d of docs) {
      if (new Date(d.createdAt) >= monthStart) {
        monthTotal += 1;
        if (d.status === 'AUTHORIZED') authorized += 1;
        if (d.status === 'REJECTED' || d.status === 'ERROR') rejected += 1;
      }
    }
    const rate = monthTotal > 0 ? Math.round((authorized / monthTotal) * 1000) / 10 : 0;
    return { monthTotal, authorized, rejected, rate };
  }, [docs]);

  // Alertas
  const errorOld = useMemo(
    () => docs.filter((d) => d.status === 'ERROR' && now - new Date(d.createdAt).getTime() > 24 * HOUR),
    [docs, now],
  );
  const stuckProcessing = useMemo(
    () => docs.filter((d) => d.status === 'PROCESSING' && now - new Date(d.createdAt).getTime() > HOUR),
    [docs, now],
  );

  // Série dos últimos 30 dias (autorizados vs rejeitados)
  const chartData = useMemo(() => {
    const days: { key: string; label: string; autorizados: number; rejeitados: number }[] = [];
    const map = new Map<string, { autorizados: number; rejeitados: number }>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      map.set(key, { autorizados: 0, rejeitados: 0 });
      days.push({ key, label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), autorizados: 0, rejeitados: 0 });
    }
    for (const doc of docs) {
      const key = new Date(doc.createdAt).toISOString().slice(0, 10);
      const bucket = map.get(key);
      if (!bucket) continue;
      if (doc.status === 'AUTHORIZED') bucket.autorizados += 1;
      if (doc.status === 'REJECTED' || doc.status === 'ERROR') bucket.rejeitados += 1;
    }
    return days.map((d) => ({ ...d, ...map.get(d.key)! }));
  }, [docs]);

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Dashboard Fiscal" />
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Dashboard Fiscal"
        description="Visão gerencial das emissões fiscais."
        actions={
          <Button variant="secondary" onClick={() => router.push('/app/fiscal')}>
            <ArrowLeft size={16} />
            Documentos
          </Button>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Emitidos no mês" value={String(stats.monthTotal)} />
        <Kpi label="Autorizados no mês" value={String(stats.authorized)} tone="success" />
        <Kpi label="Rejeitados no mês" value={String(stats.rejected)} tone={stats.rejected > 0 ? 'danger' : 'neutral'} />
        <Kpi label="Taxa de autorização" value={`${stats.rate}%`} tone={stats.rate >= 90 ? 'success' : 'neutral'} />
      </div>

      {/* Gráfico */}
      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="text-base">Emissões — últimos 30 dias</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} interval={4} />
              <YAxis tick={{ fontSize: 12, fill: '#64748b' }} allowDecimals={false} width={32} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="autorizados" name="Autorizados" stroke="#16a34a" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="rejeitados" name="Rejeitados" stroke="#dc2626" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Alertas */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-danger" />
            <CardTitle className="text-base">Em erro há mais de 24h</CardTitle>
            {errorOld.length > 0 && <Badge variant="danger">{errorOld.length}</Badge>}
          </CardHeader>
          <CardContent>
            {errorOld.length === 0 ? (
              <p className="py-4 text-sm text-content-muted">Nenhum documento em erro prolongado. 🎉</p>
            ) : (
              <div className="space-y-2">
                {errorOld.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-2 border-b border-line pb-2 last:border-0">
                    <button onClick={() => router.push(`/app/fiscal/${d.id}`)} className="text-sm text-brand-600 dark:text-brand-400 hover:underline">
                      {FISCAL_TYPE_LABEL[d.type]} {d.focusRef ?? d.id.slice(-6)}
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-content-muted">{formatDateTime(d.createdAt)}</span>
                      <Button variant="secondary" onClick={() => retry.mutate(d.id, { onSuccess: () => toast.success('Reprocessado'), onError: () => toast.error('Erro') })} loading={retry.isPending}>
                        Reprocessar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center gap-2">
            <Clock size={16} className="text-warning" />
            <CardTitle className="text-base">Processando há mais de 1h</CardTitle>
            {stuckProcessing.length > 0 && <Badge variant="warning">{stuckProcessing.length}</Badge>}
          </CardHeader>
          <CardContent>
            {stuckProcessing.length === 0 ? (
              <p className="py-4 text-sm text-content-muted">Nenhum documento travado em processamento.</p>
            ) : (
              <div className="space-y-2">
                {stuckProcessing.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-2 border-b border-line pb-2 last:border-0">
                    <button onClick={() => router.push(`/app/fiscal/${d.id}`)} className="text-sm text-brand-600 dark:text-brand-400 hover:underline">
                      {FISCAL_TYPE_LABEL[d.type]} {d.focusRef ?? d.id.slice(-6)}
                    </button>
                    <span className="text-xs text-content-muted">{formatDateTime(d.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
