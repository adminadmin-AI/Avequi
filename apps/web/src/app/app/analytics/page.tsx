'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { Info } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { formatBRL, formatNumber } from '@/lib/format';

// ─── Shapes reais do backend (módulo analytics) ──────────────────────────────
interface OlapSummary {
  sales: { totalRevenue: number; totalOrders: number; avgTicket: number };
  inventory: { totalSkus: number; totalValue: number; slowMovingCount: number };
  production: { totalOrders: number; totalProduced: number; avgCostPerUnit: number };
  quality: { totalNcrs: number; openNcrs: number; criticalNcrs: number };
}
interface SalesCubeRow {
  period: string;
  productSku: string;
  productName: string;
  status: string;
  totalQty: number;
  totalRevenue: number;
  orderCount: number;
}
interface ProductionCostRow {
  sku: string;
  productName: string;
  totalProduced: number;
  totalMaterialCost: number;
  totalLaborCost: number;
  totalCost: number;
}
interface InventoryAgingRow {
  sku: string;
  name: string;
  inventoryValue: number;
  agingBucket: '0-30' | '31-90' | '91-180' | '180+';
}

const PERIODS = [
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
  { days: 365, label: '365 dias' },
];

const AGING_ORDER: InventoryAgingRow['agingBucket'][] = ['0-30', '31-90', '91-180', '180+'];

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

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

function brlCompact(v: number) {
  if (Math.abs(v) >= 1000) return `R$ ${(v / 1000).toFixed(0)}k`;
  return `R$ ${v.toFixed(0)}`;
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(90);
  const startDate = useMemo(() => isoDaysAgo(days), [days]);
  const endDate = useMemo(() => new Date().toISOString(), [days]);

  const summaryQ = useQuery({
    queryKey: ['/analytics/summary'],
    queryFn: async () => (await apiClient.get<OlapSummary>('/analytics/summary')).data,
  });
  const salesQ = useQuery({
    queryKey: ['/analytics/sales-cube', startDate, endDate],
    queryFn: async () =>
      (await apiClient.get<SalesCubeRow[]>('/analytics/sales-cube', { params: { startDate, endDate } })).data,
  });
  const prodQ = useQuery({
    queryKey: ['/analytics/production-costs', startDate, endDate],
    queryFn: async () =>
      (await apiClient.get<ProductionCostRow[]>('/analytics/production-costs', { params: { startDate, endDate } })).data,
  });
  const agingQ = useQuery({
    queryKey: ['/analytics/inventory-aging'],
    queryFn: async () => (await apiClient.get<InventoryAgingRow[]>('/analytics/inventory-aging')).data,
  });

  const summary = summaryQ.data;
  const salesRows = salesQ.data ?? [];
  const prodRows = prodQ.data ?? [];
  const agingRows = agingQ.data ?? [];

  // Receita por mês (soma de todos os pedidos do período)
  const revenueByMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of salesRows) map.set(r.period, (map.get(r.period) ?? 0) + r.totalRevenue);
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, revenue]) => ({ period, revenue }));
  }, [salesRows]);

  // Top 10 produtos por receita
  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; revenue: number }>();
    for (const r of salesRows) {
      const cur = map.get(r.productSku) ?? { name: r.productName, revenue: 0 };
      cur.revenue += r.totalRevenue;
      map.set(r.productSku, cur);
    }
    return Array.from(map.entries())
      .map(([sku, v]) => ({ label: `${sku}`, name: v.name, revenue: v.revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }, [salesRows]);

  // Custo de produção por produto (top 10 por custo total)
  const prodCostData = useMemo(() => {
    return [...prodRows]
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, 10)
      .map((r) => ({ label: r.sku, material: r.totalMaterialCost, mao: r.totalLaborCost }));
  }, [prodRows]);

  // Valor de estoque por faixa de aging
  const agingData = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of agingRows) map.set(r.agingBucket, (map.get(r.agingBucket) ?? 0) + r.inventoryValue);
    return AGING_ORDER.map((bucket) => ({ bucket: `${bucket} dias`, valor: map.get(bucket) ?? 0 }));
  }, [agingRows]);

  const loading = summaryQ.isLoading || salesQ.isLoading || prodQ.isLoading || agingQ.isLoading;

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Indicadores gerenciais de vendas, produção e estoque."
        actions={
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                onClick={() => setDays(p.days)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  days === p.days ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          Gráficos construídos sobre os endpoints reais de <code>/analytics</code> (sales-cube, production-costs,
          inventory-aging, summary). Os itens "recebimentos vs pagamentos por mês", "margem bruta por produto",
          "OPs planejadas vs concluídas" e "lead time médio" da issue ainda <strong>não têm endpoint</strong> no backend
          (pendência registrada na #247). O filtro de período afeta Comercial e Produção; Estoque é um retrato atual.
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Receita faturada" value={formatBRL(summary?.sales.totalRevenue ?? 0)} tone="success" />
            <Kpi label="Ticket médio" value={formatBRL(summary?.sales.avgTicket ?? 0)} />
            <Kpi label="OPs concluídas" value={formatNumber(summary?.production.totalOrders ?? 0)} />
            <Kpi label="NCRs abertas" value={formatNumber(summary?.quality.openNcrs ?? 0)} tone={(summary?.quality.openNcrs ?? 0) > 0 ? 'warning' : 'neutral'} />
          </div>

          {/* Comercial */}
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Comercial</h2>
          <div className="mb-6 grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Receita por mês</CardTitle></CardHeader>
              <CardContent>
                {revenueByMonth.length === 0 ? (
                  <p className="py-12 text-center text-sm text-slate-400">Sem vendas no período.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={revenueByMonth} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="period" tick={{ fontSize: 12, fill: '#64748b' }} />
                      <YAxis tick={{ fontSize: 12, fill: '#64748b' }} width={56} tickFormatter={brlCompact} />
                      <Tooltip formatter={(v) => formatBRL(Number(v))} />
                      <Line type="monotone" dataKey="revenue" name="Receita" stroke="#3D2CE6" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Top 10 produtos por receita</CardTitle></CardHeader>
              <CardContent>
                {topProducts.length === 0 ? (
                  <p className="py-12 text-center text-sm text-slate-400">Sem vendas no período.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={topProducts} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={brlCompact} />
                      <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} width={90} />
                      <Tooltip formatter={(v) => formatBRL(Number(v))} />
                      <Bar dataKey="revenue" name="Receita" fill="#00C2A8" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Produção */}
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Produção</h2>
          <div className="mb-6 grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Custo de produção por produto (top 10)</CardTitle></CardHeader>
              <CardContent>
                {prodCostData.length === 0 ? (
                  <p className="py-12 text-center text-sm text-slate-400">Sem ordens concluídas no período.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={prodCostData} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
                      <YAxis tick={{ fontSize: 12, fill: '#64748b' }} width={56} tickFormatter={brlCompact} />
                      <Tooltip formatter={(v) => formatBRL(Number(v))} />
                      <Legend />
                      <Bar dataKey="material" stackId="c" name="Material" fill="#3D2CE6" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="mao" stackId="c" name="Mão de obra" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Estoque */}
            <Card>
              <CardHeader><CardTitle className="text-base">Valor de estoque por faixa de aging</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={agingData} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 12, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#64748b' }} width={56} tickFormatter={brlCompact} />
                    <Tooltip formatter={(v) => formatBRL(Number(v))} />
                    <Bar dataKey="valor" name="Valor em estoque" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
