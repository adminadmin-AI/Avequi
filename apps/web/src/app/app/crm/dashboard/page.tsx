'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Can } from '@/components/can';
import { SOURCE_LABEL } from '../inbox/inbox-types';
import { lostReasonLabel } from '@/lib/crm-lost-reasons';
import { formatBRL } from '../funnel/funnel-types';
import { formatDate } from '@/lib/format';

interface Dashboard {
  funnel: {
    total: number;
    responded: number;
    reachedProposal: number;
    won: number;
    lost: number;
    respondedRate: number;
    proposalRate: number;
    winRate: number;
  };
  bySource: Array<{
    source: string;
    total: number;
    won: number;
    conversionRate: number;
    revenue: number;
  }>;
  bySeller: Array<{
    userId: string;
    name: string;
    leads: number;
    won: number;
    winRate: number;
    avgFirstResponseMin: number | null;
  }>;
  /** Perdas por categoria (#570) + drill por vendedor e origem */
  lostReasons: {
    byCategory: Array<{ category: string | null; count: number }>;
    bySeller: Array<{ sellerId: string | null; sellerName: string; category: string | null; count: number }>;
    bySource: Array<{ source: string; category: string | null; count: number }>;
  };
  /** #569 — leads realocados por SLA estourado no período */
  slaEscalations: number;
  /** #574 — leads que chegaram já em negociação em outra loja */
  crossStoreDuplicates: number;
  /** #846 — ciclo médio lead→faturamento (dias); null se ninguém faturou no período */
  avgSalesCycleDays: number | null;
  /** #846 — leads OPEN sem toque além do limite, por estágio */
  coolingLeads: Array<{ stageId: string; stageName: string; count: number }>;
}

/** #846 — shape de GET /crm/portfolio */
interface Portfolio {
  newCustomers: { count: number; series: Array<{ month: string; count: number }> };
  active: { count: number };
  atRisk: {
    count: number;
    customers: Array<{
      customerId: string;
      name: string;
      lastPurchaseAt: string | null;
      lifetimeRevenue: number;
    }>;
  };
  repurchase: {
    totalCustomers: number;
    customersWithRepeat: number;
    rate: number;
    avgIntervalDays: number | null;
  };
  topCustomers: Array<{
    customerId: string;
    name: string;
    periodRevenue: number;
    lifetimeRevenue: number;
    purchaseCount: number;
    avgTicket: number;
    lastPurchaseAt: string | null;
  }>;
}

const PERIODS = [
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
];

/** Dashboard do CRM (F3.1 #517): qual canal traz lead que FECHA? */
export default function CrmDashboardPage() {
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery<Dashboard>({
    queryKey: ['crm-dashboard', days],
    queryFn: async () => (await apiClient.get('/crm/dashboard', { params: { days } })).data,
  });

  async function exportCsv() {
    const res = await apiClient.get('/crm/dashboard/source.csv', {
      params: { days },
      responseType: 'blob',
    });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'crm-origem.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const f = data?.funnel;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard CRM"
        description="Conversão por origem, vendedor e tempo de resposta"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {PERIODS.map((p) => (
                <button
                  key={p.days}
                  onClick={() => setDays(p.days)}
                  className={`rounded-full px-3 py-1 text-xs ${
                    days === p.days ? 'bg-brand-600 text-white' : 'bg-neutral-500/[0.08] text-content-muted'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={exportCsv}
              className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
          </div>
        }
      />

      {isLoading || !data ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-content-muted" />
        </div>
      ) : (
        <>
          {/* Funil de conversão */}
          <section className="surface-sheen rounded-xl bg-surface p-5 shadow-soft">
            <h2 className="mb-3 text-sm font-medium">Funil de conversão</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
              <Stat label="Leads" value={f!.total} />
              <Stat label="Responderam" value={f!.responded} pct={f!.respondedRate} />
              <Stat label="Chegaram a proposta" value={f!.reachedProposal} pct={f!.proposalRate} />
              <Stat label="Fechados" value={f!.won} pct={f!.winRate} highlight />
              <Stat label="Realocados por SLA" value={data.slaEscalations} />
              <Stat label="Duplicados entre lojas" value={data.crossStoreDuplicates} />
            </div>
          </section>

          {/* Indicadores de ciclo (#846): ciclo médio até faturar e leads esfriando */}
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="surface-sheen rounded-xl bg-surface p-5 shadow-soft">
              <div className="text-caption text-content-muted">Ciclo médio até faturar</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums tracking-[-0.02em]">
                {data.avgSalesCycleDays != null ? `${data.avgSalesCycleDays} dias` : '—'}
              </div>
              <div className="mt-0.5 text-helper text-content-muted">
                do lead à emissão da NF-e (OVs faturadas no período)
              </div>
            </div>
            <div className="surface-sheen rounded-xl bg-surface p-5 shadow-soft">
              <div className="text-caption text-content-muted">Leads esfriando</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums tracking-[-0.02em]">
                {data.coolingLeads.reduce((s, c) => s + c.count, 0)}
              </div>
              <div className="mt-0.5 text-helper text-content-muted">
                {data.coolingLeads.length > 0
                  ? data.coolingLeads.map((c) => `${c.stageName} ${c.count}`).join(' · ')
                  : 'sem leads parados além do limite'}
              </div>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Por origem */}
            <section className="surface-sheen rounded-xl bg-surface shadow-soft">
              <h2 className="border-b p-3 text-sm font-medium">Conversão por origem</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-content-muted">
                    <tr>
                      <th className="p-2">Origem</th>
                      <th className="p-2 text-right">Leads</th>
                      <th className="p-2 text-right">Conv.</th>
                      <th className="p-2 text-right">Receita</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.bySource.map((s) => (
                      <tr key={s.source} className="border-t">
                        <td className="p-2">
                          <Badge variant="info" className="text-[10px]">
                            {SOURCE_LABEL[s.source] ?? s.source}
                          </Badge>
                        </td>
                        <td className="p-2 text-right">{s.total}</td>
                        <td className="p-2 text-right">{s.conversionRate}%</td>
                        <td className="p-2 text-right font-medium">{formatBRL(s.revenue)}</td>
                      </tr>
                    ))}
                    {data.bySource.length === 0 && (
                      <tr>
                        <td colSpan={4} className="p-4 text-center text-content-muted">
                          Sem leads no período
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Por vendedor */}
            <section className="surface-sheen rounded-xl bg-surface shadow-soft">
              <h2 className="border-b p-3 text-sm font-medium">Ranking por vendedor</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-content-muted">
                    <tr>
                      <th className="p-2">Vendedor</th>
                      <th className="p-2 text-right">Leads</th>
                      <th className="p-2 text-right">Fech.</th>
                      <th className="p-2 text-right">1ª resp.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.bySeller.map((s) => (
                      <tr key={s.userId} className="border-t">
                        <td className="p-2 font-medium">{s.name}</td>
                        <td className="p-2 text-right">{s.leads}</td>
                        <td className="p-2 text-right">
                          {s.won} <span className="text-xs text-content-muted">({s.winRate}%)</span>
                        </td>
                        <td className="p-2 text-right">
                          {s.avgFirstResponseMin != null ? `${s.avgFirstResponseMin}min` : '—'}
                        </td>
                      </tr>
                    ))}
                    {data.bySeller.length === 0 && (
                      <tr>
                        <td colSpan={4} className="p-4 text-center text-content-muted">
                          Sem dados
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* Perdas por categoria (#570) — por que perdemos leads este mês? */}
          {data.lostReasons.byCategory.length > 0 && (
            <LostByCategory lost={data.lostReasons} />
          )}
        </>
      )}

      {/* Carteira de clientes (#846) — some inteira sem crm.portfolio.view (fail-closed) */}
      <Can permission="crm.portfolio.view">
        <PortfolioSection days={days} />
      </Can>
    </div>
  );
}

/**
 * Carteira de clientes (#846): novos/ativos/em risco, recompra e top clientes.
 * Query própria (independe do overview) — só monta sob crm.portfolio.view.
 */
function PortfolioSection({ days }: { days: number }) {
  const { data, isLoading } = useQuery<Portfolio>({
    queryKey: ['crm-portfolio', days],
    queryFn: async () => (await apiClient.get('/crm/portfolio', { params: { days } })).data,
  });

  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-content-muted" />
      </div>
    );
  }

  const { newCustomers, active, atRisk, repurchase, topCustomers } = data;
  const maxMonth = Math.max(1, ...newCustomers.series.map((s) => s.count));

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium">Carteira de clientes</h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PortfolioCard label="Novos no período" value={String(newCustomers.count)} />
        <PortfolioCard label="Clientes ativos" value={String(active.count)} sub="≥1 compra na janela ativa" />
        <PortfolioCard label="Em risco" value={String(atRisk.count)} sub="compraram antes, não agora" />
        <PortfolioCard
          label="Taxa de recompra"
          value={`${repurchase.rate}%`}
          sub={
            repurchase.avgIntervalDays != null
              ? `intervalo médio ${repurchase.avgIntervalDays} dias`
              : 'sem recompra ainda'
          }
        />
      </div>

      {/* Série mensal de novos clientes (12 meses) — barras simples */}
      <div className="surface-sheen rounded-xl bg-surface p-5 shadow-soft">
        <h3 className="mb-3 text-sm font-medium">Novos clientes (12 meses)</h3>
        <div className="flex h-28 items-end gap-1.5">
          {newCustomers.series.map((s) => (
            <div key={s.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="text-[10px] tabular-nums text-content-muted">{s.count || ''}</span>
              <div
                className="w-full rounded-t bg-brand-500/70"
                style={{ height: `${(s.count / maxMonth) * 100}%` }}
                title={`${s.month}: ${s.count}`}
              />
              <span className="text-[9px] text-content-muted">{s.month.slice(2)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top clientes */}
        <section className="surface-sheen rounded-xl bg-surface shadow-soft">
          <h3 className="border-b p-3 text-sm font-medium">Top clientes</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-content-muted">
                <tr>
                  <th className="p-2">Cliente</th>
                  <th className="p-2 text-right">Receita período</th>
                  <th className="p-2 text-right">Lifetime</th>
                  <th className="p-2 text-right">Compras</th>
                  <th className="p-2 text-right">Ticket médio</th>
                  <th className="p-2 text-right">Última compra</th>
                </tr>
              </thead>
              <tbody>
                {topCustomers.map((c) => (
                  <tr key={c.customerId} className="border-t">
                    <td className="p-2 font-medium">{c.name}</td>
                    <td className="p-2 text-right font-medium">{formatBRL(c.periodRevenue)}</td>
                    <td className="p-2 text-right">{formatBRL(c.lifetimeRevenue)}</td>
                    <td className="p-2 text-right">{c.purchaseCount}</td>
                    <td className="p-2 text-right">{formatBRL(c.avgTicket)}</td>
                    <td className="p-2 text-right text-content-muted">{formatDate(c.lastPurchaseAt)}</td>
                  </tr>
                ))}
                {topCustomers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-content-muted">
                      Sem clientes faturados
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Clientes em risco */}
        <section className="surface-sheen rounded-xl bg-surface shadow-soft">
          <h3 className="border-b p-3 text-sm font-medium">Clientes em risco</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-content-muted">
                <tr>
                  <th className="p-2">Cliente</th>
                  <th className="p-2 text-right">Última compra</th>
                  <th className="p-2 text-right">Receita lifetime</th>
                </tr>
              </thead>
              <tbody>
                {atRisk.customers.map((c) => (
                  <tr key={c.customerId} className="border-t">
                    <td className="p-2 font-medium">{c.name}</td>
                    <td className="p-2 text-right text-content-muted">{formatDate(c.lastPurchaseAt)}</td>
                    <td className="p-2 text-right font-medium">{formatBRL(c.lifetimeRevenue)}</td>
                  </tr>
                ))}
                {atRisk.customers.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-4 text-center text-content-muted">
                      Nenhum cliente em risco
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}

function PortfolioCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="surface-sheen rounded-xl bg-surface p-5 shadow-soft">
      <div className="text-caption text-content-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-[-0.02em]">{value}</div>
      {sub && <div className="mt-0.5 text-helper text-content-muted">{sub}</div>}
    </div>
  );
}

/**
 * Perdas por categoria (#570) com drill por vendedor/origem: barra proporcional
 * por categoria + tabela da dimensão escolhida. "Não categorizado" = leads
 * perdidos antes da categoria existir (sem migração retroativa).
 */
function LostByCategory({ lost }: { lost: Dashboard['lostReasons'] }) {
  const [dim, setDim] = useState<'seller' | 'source'>('seller');
  const total = lost.byCategory.reduce((s, c) => s + c.count, 0);

  const rows =
    dim === 'seller'
      ? lost.bySeller.map((r) => ({ key: r.sellerName, category: r.category, count: r.count }))
      : lost.bySource.map((r) => ({ key: SOURCE_LABEL[r.source] ?? r.source, category: r.category, count: r.count }));
  const byKey = new Map<string, { category: string | null; count: number }[]>();
  for (const r of rows) {
    if (!byKey.has(r.key)) byKey.set(r.key, []);
    byKey.get(r.key)!.push(r);
  }

  return (
    <section className="surface-sheen rounded-xl bg-surface p-5 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">Por que perdemos? ({total} leads)</h2>
        <select
          className="rounded-md border bg-surface px-2 py-1 text-xs"
          value={dim}
          onChange={(e) => setDim(e.target.value as 'seller' | 'source')}
        >
          <option value="seller">por vendedor</option>
          <option value="source">por origem</option>
        </select>
      </div>

      <div className="mb-4 space-y-1.5">
        {lost.byCategory.map((c) => (
          <div key={c.category ?? 'null'} className="flex items-center gap-2 text-xs">
            <span className="w-44 shrink-0 truncate">{lostReasonLabel(c.category)}</span>
            <div className="h-3 flex-1 overflow-hidden rounded bg-surface-secondary">
              <div
                className="h-full rounded bg-danger/70"
                style={{ width: `${total ? Math.max(2, Math.round((c.count / total) * 100)) : 0}%` }}
              />
            </div>
            <span className="w-14 shrink-0 text-right tabular-nums">
              {c.count} ({total ? Math.round((c.count / total) * 100) : 0}%)
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {[...byKey.entries()].map(([key, cats]) => (
          <div key={key} className="text-xs">
            <span className="font-medium">{key}:</span>{' '}
            {cats
              .sort((a, b) => b.count - a.count)
              .map((c) => `${lostReasonLabel(c.category)} ${c.count}`)
              .join(' · ')}
          </div>
        ))}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  pct,
  highlight,
}: {
  label: string;
  value: number;
  pct?: number;
  highlight?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-caption text-content-muted">
        {highlight && <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />}
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tracking-[-0.02em] tabular-nums ${highlight ? 'text-brand-600 dark:text-brand-400' : 'text-content'}`}>
        {value}
      </div>
      {pct != null && <div className="mt-0.5 text-helper text-content-muted">{pct}% do total</div>}
    </div>
  );
}
