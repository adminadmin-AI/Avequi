'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { ClipboardCheck, AlertTriangle } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { NCR_SEVERITY, type NcrSeverity, type InspectionStatus, type NcrStatus } from './quality-meta';

interface Inspection { id: string; status: InspectionStatus; createdAt: string }
interface Ncr { id: string; severity: NcrSeverity; status: NcrStatus; createdAt: string }

function Kpi({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'success' | 'danger' | 'warning' }) {
  const cls = { neutral: 'text-slate-900', success: 'text-success', danger: 'text-danger', warning: 'text-warning' }[tone];
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tracking-tight ${cls}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

export default function QualityDashboardPage() {
  const router = useRouter();

  const inspQ = useQuery({ queryKey: ['/quality/inspections'], queryFn: async () => (await apiClient.get<Inspection[]>('/quality/inspections')).data });
  const ncrQ = useQuery({ queryKey: ['/quality/ncr'], queryFn: async () => (await apiClient.get<Ncr[]>('/quality/ncr')).data });

  const inspections = inspQ.data ?? [];
  const ncrs = ncrQ.data ?? [];

  const stats = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const since30 = new Date();
    since30.setDate(since30.getDate() - 30);

    const recent = inspections.filter((i) => new Date(i.createdAt) >= since30 && (i.status === 'PASSED' || i.status === 'FAILED'));
    const passed = recent.filter((i) => i.status === 'PASSED').length;
    const failed = recent.filter((i) => i.status === 'FAILED').length;
    const passRate = recent.length > 0 ? Math.round((passed / recent.length) * 1000) / 10 : 0;

    const openNcrs = ncrs.filter((n) => n.status !== 'CLOSED' && n.status !== 'CANCELLED');
    const bySeverity = { CRITICAL: 0, MAJOR: 0, MINOR: 0 } as Record<NcrSeverity, number>;
    for (const n of openNcrs) bySeverity[n.severity] += 1;
    const closedMonth = ncrs.filter((n) => n.status === 'CLOSED' && new Date(n.createdAt) >= monthStart).length;

    return { passed, failed, passRate, bySeverity, openTotal: openNcrs.length, closedMonth };
  }, [inspections, ncrs]);

  const pieData = [
    { name: 'Aprovados', value: stats.passed, color: '#16a34a' },
    { name: 'Reprovados', value: stats.failed, color: '#dc2626' },
  ];
  const barData = (Object.keys(stats.bySeverity) as NcrSeverity[]).map((s) => ({ name: NCR_SEVERITY[s].label, total: stats.bySeverity[s] }));

  if (inspQ.isLoading || ncrQ.isLoading) {
    return (
      <div>
        <PageHeader title="Qualidade" />
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Dashboard de Qualidade"
        description="Indicadores de inspeções e não conformidades."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => router.push('/app/quality/inspections')}><ClipboardCheck size={16} /> Inspeções</Button>
            <Button variant="secondary" onClick={() => router.push('/app/quality/ncr')}><AlertTriangle size={16} /> NCRs</Button>
          </div>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Aprovação (30d)" value={`${stats.passRate}%`} tone={stats.passRate >= 90 ? 'success' : 'warning'} />
        <Kpi label="NCRs abertas" value={String(stats.openTotal)} tone={stats.openTotal > 0 ? 'warning' : 'neutral'} />
        <Kpi label="NCRs críticas abertas" value={String(stats.bySeverity.CRITICAL)} tone={stats.bySeverity.CRITICAL > 0 ? 'danger' : 'neutral'} />
        <Kpi label="NCRs fechadas no mês" value={String(stats.closedMonth)} tone="success" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Inspeções — aprovados vs reprovados (30d)</CardTitle></CardHeader>
          <CardContent>
            {stats.passed + stats.failed === 0 ? (
              <p className="py-12 text-center text-sm text-slate-400">Sem inspeções finalizadas no período.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                    {pieData.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">NCRs abertas por severidade</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={barData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} allowDecimals={false} width={32} />
                <Tooltip />
                <Bar dataKey="total" name="NCRs abertas" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
