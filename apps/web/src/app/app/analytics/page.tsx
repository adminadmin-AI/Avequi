'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { AlertTriangle, Info } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatGroup, type StatItem } from '@/components/ui/stat-group';
import { Spinner } from '@/components/ui/spinner';
import { formatBRL, formatNumber } from '@/lib/format';
import { chartGridProps, chartTickFill, chartTooltipProps } from '@/lib/chart-theme';
import { usePermission } from '@/hooks/use-permission';

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
interface DreReport {
  receitaBruta: number;
  deducoes: number;
  receitaLiquida: number;
  cpv: number;
  lucroBruto: number;
  despesasOperacionais: number;
  resultadoOperacional: number;
  margemBruta: number;
  margemOperacional: number;
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

function brlCompact(v: number) {
  if (Math.abs(v) >= 1000) return `R$ ${(v / 1000).toFixed(0)}k`;
  return `R$ ${v.toFixed(0)}`;
}

/** #846 — GET /dashboard/executive expõe sales.revenueGrowthPct (mês a mês). */
interface ExecutiveDashboard {
  sales: { revenueThisMonth: number; revenueLastMonth: number; revenueGrowthPct: number | null };
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(90);
  const startDate = useMemo(() => isoDaysAgo(days), [days]);
  const endDate = useMemo(() => new Date().toISOString(), [days]);
  const { can } = usePermission();

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
  const dreQ = useQuery({
    queryKey: ['/finance/reports/dre', startDate, endDate],
    queryFn: async () =>
      (await apiClient.get<DreReport>('/finance/reports/dre', { params: { from: startDate, to: endDate } })).data,
  });
  // #846 — crescimento de receita (só dispara com a permissão do dashboard executivo)
  const executiveQ = useQuery({
    queryKey: ['/dashboard/executive'],
    queryFn: async () => (await apiClient.get<ExecutiveDashboard>('/dashboard/executive')).data,
    enabled: can('dashboard.executive.view'),
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

  // Valor de estoque por tempo parado
  const agingData = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of agingRows) map.set(r.agingBucket, (map.get(r.agingBucket) ?? 0) + r.inventoryValue);
    return AGING_ORDER.map((bucket) => ({ bucket: `${bucket} dias`, valor: map.get(bucket) ?? 0 }));
  }, [agingRows]);

  const dre = dreQ.data;
  const dreChart = useMemo(() => {
    if (!dre) return [];
    return [
      { label: 'Receita bruta', valor: dre.receitaBruta },
      { label: 'Deduções', valor: -dre.deducoes },
      { label: 'CPV', valor: -dre.cpv },
      { label: 'Despesas op.', valor: -dre.despesasOperacionais },
      { label: 'Resultado', valor: dre.resultadoOperacional },
    ];
  }, [dre]);

  const loading = summaryQ.isLoading || salesQ.isLoading || prodQ.isLoading || agingQ.isLoading || dreQ.isLoading;

  // Resumo da página — números como tipografia (de-boxed). Alarme só em NCRs > 0.
  const totalRevenue = summary?.sales.totalRevenue ?? 0;
  const openNcrs = summary?.quality.openNcrs ?? 0;
  const summaryStats: StatItem[] = [
    { label: 'Receita faturada', value: formatBRL(totalRevenue), tone: totalRevenue < 0 ? 'danger' : 'neutral' },
    { label: 'Ticket médio', value: formatBRL(summary?.sales.avgTicket ?? 0) },
    { label: 'OPs concluídas', value: formatNumber(summary?.production.totalOrders ?? 0) },
    {
      label: 'NCRs abertas',
      value: formatNumber(openNcrs),
      tone: openNcrs > 0 ? 'warning' : 'neutral',
      icon: openNcrs > 0 ? AlertTriangle : undefined,
    },
  ];
  // #846 — crescimento de receita mês a mês; só entra com a permissão do dashboard executivo.
  if (can('dashboard.executive.view')) {
    const growth = executiveQ.data?.sales.revenueGrowthPct;
    summaryStats.push({
      label: 'Crescimento de receita (mês)',
      value: growth == null ? '—' : `${growth > 0 ? '+' : ''}${formatNumber(growth)}%`,
      tone: growth == null ? 'neutral' : growth < 0 ? 'danger' : 'neutral',
    });
  }

  // Financeiro — DRE realizado. Negativos são alarme (danger).
  const financeStats: StatItem[] = [
    { label: 'Receita líquida', value: formatBRL(dre?.receitaLiquida ?? 0), tone: (dre?.receitaLiquida ?? 0) < 0 ? 'danger' : 'neutral' },
    { label: 'Lucro bruto', value: formatBRL(dre?.lucroBruto ?? 0), tone: (dre?.lucroBruto ?? 0) < 0 ? 'danger' : 'neutral' },
    { label: 'Resultado operacional', value: formatBRL(dre?.resultadoOperacional ?? 0), tone: (dre?.resultadoOperacional ?? 0) < 0 ? 'danger' : 'neutral' },
    { label: 'Margem bruta', value: `${formatNumber(dre?.margemBruta ?? 0)}%` },
  ];

  return (
    <div>
      <PageHeader
        title="Indicadores"
        description="Indicadores gerenciais de vendas, produção e estoque."
        actions={
          <div className="inline-flex rounded-lg border border-line p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                onClick={() => setDays(p.days)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  days === p.days ? 'bg-brand-50 text-brand-700 dark:text-brand-300' : 'text-content-muted hover:text-content-secondary'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-surface-secondary px-3 py-2 text-xs text-content-muted">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          Os gráficos usam dados reais de vendas, produção, estoque e o DRE realizado. Ainda não
          temos <strong>"margem bruta por produto"</strong>, "ordens de produção planejadas vs.
          concluídas" nem "prazo de entrega médio". O filtro de período afeta Comercial, Financeiro
          e Produção; Estoque mostra a posição atual. Em breve.
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : (
        <>
          {/* Resumo — indicadores como tipografia sobre o canvas */}
          <StatGroup className="mb-8" stats={summaryStats} />

          {/* Comercial */}
          <h2 className="mb-3 text-[13px] font-semibold text-content">Comercial</h2>
          <div className="mb-8 grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-title">Receita por mês</CardTitle></CardHeader>
              <CardContent>
                {revenueByMonth.length === 0 ? (
                  <p className="py-12 text-center text-sm text-content-muted">Sem vendas no período.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={revenueByMonth} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                      <CartesianGrid {...chartGridProps} />
                      <XAxis dataKey="period" tick={{ fontSize: 12, fill: chartTickFill }} />
                      <YAxis tick={{ fontSize: 12, fill: chartTickFill }} width={56} tickFormatter={brlCompact} />
                      <Tooltip {...chartTooltipProps} formatter={(v) => formatBRL(Number(v))} />
                      <Line type="monotone" dataKey="revenue" name="Receita" stroke="#3D2CE6" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-title">Top 10 produtos por receita</CardTitle></CardHeader>
              <CardContent>
                {topProducts.length === 0 ? (
                  <p className="py-12 text-center text-sm text-content-muted">Sem vendas no período.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={topProducts} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                      <CartesianGrid stroke="var(--border-default)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 12, fill: chartTickFill }} tickFormatter={brlCompact} />
                      <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: chartTickFill }} width={90} />
                      <Tooltip {...chartTooltipProps} formatter={(v) => formatBRL(Number(v))} />
                      <Bar dataKey="revenue" name="Receita" fill="#00C2A8" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Financeiro */}
          <h2 className="mb-3 text-[13px] font-semibold text-content">Financeiro</h2>
          <StatGroup className="mb-6" stats={financeStats} />
          <div className="mb-8 grid gap-5">
            <Card>
              <CardHeader><CardTitle className="text-title">DRE do período (valores realizados)</CardTitle></CardHeader>
              <CardContent>
                {!dre || dre.receitaBruta === 0 ? (
                  <p className="py-12 text-center text-sm text-content-muted">Sem lançamentos pagos no período.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={dreChart} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                      <CartesianGrid {...chartGridProps} />
                      <XAxis dataKey="label" tick={{ fontSize: 12, fill: chartTickFill }} />
                      <YAxis tick={{ fontSize: 12, fill: chartTickFill }} width={56} tickFormatter={brlCompact} />
                      <Tooltip {...chartTooltipProps} formatter={(v) => formatBRL(Number(v))} />
                      <Bar dataKey="valor" name="Valor" radius={[4, 4, 0, 0]}>
                        {dreChart.map((d) => (
                          <Cell key={d.label} fill={d.valor >= 0 ? '#16a34a' : '#dc2626'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Produção e estoque */}
          <h2 className="mb-3 text-[13px] font-semibold text-content">Produção e estoque</h2>
          <div className="mb-6 grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-title">Custo de produção por produto (top 10)</CardTitle></CardHeader>
              <CardContent>
                {prodCostData.length === 0 ? (
                  <p className="py-12 text-center text-sm text-content-muted">Sem ordens concluídas no período.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={prodCostData} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                      <CartesianGrid {...chartGridProps} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: chartTickFill }} />
                      <YAxis tick={{ fontSize: 12, fill: chartTickFill }} width={56} tickFormatter={brlCompact} />
                      <Tooltip {...chartTooltipProps} formatter={(v) => formatBRL(Number(v))} />
                      <Legend />
                      <Bar dataKey="material" stackId="c" name="Material" fill="#3D2CE6" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="mao" stackId="c" name="Mão de obra" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-title">Valor de estoque por tempo parado</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={agingData} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                    <CartesianGrid {...chartGridProps} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 12, fill: chartTickFill }} />
                    <YAxis tick={{ fontSize: 12, fill: chartTickFill }} width={56} tickFormatter={brlCompact} />
                    <Tooltip {...chartTooltipProps} formatter={(v) => formatBRL(Number(v))} />
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
