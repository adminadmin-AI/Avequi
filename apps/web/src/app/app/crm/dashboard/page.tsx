'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { SOURCE_LABEL } from '../inbox/inbox-types';
import { lostReasonLabel } from '@/lib/crm-lost-reasons';
import { formatBRL } from '../funnel/funnel-types';

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
                    days === p.days ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
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
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Funil de conversão */}
          <section className="rounded-lg border p-4">
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

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Por origem */}
            <section className="rounded-lg border">
              <h2 className="border-b p-3 text-sm font-medium">Conversão por origem</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
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
                        <td colSpan={4} className="p-4 text-center text-muted-foreground">
                          Sem leads no período
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Por vendedor */}
            <section className="rounded-lg border">
              <h2 className="border-b p-3 text-sm font-medium">Ranking por vendedor</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
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
                          {s.won} <span className="text-xs text-muted-foreground">({s.winRate}%)</span>
                        </td>
                        <td className="p-2 text-right">
                          {s.avgFirstResponseMin != null ? `${s.avgFirstResponseMin}min` : '—'}
                        </td>
                      </tr>
                    ))}
                    {data.bySeller.length === 0 && (
                      <tr>
                        <td colSpan={4} className="p-4 text-center text-muted-foreground">
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
    <section className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">Por que perdemos? ({total} leads)</h2>
        <select
          className="rounded-md border bg-background px-2 py-1 text-xs"
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
    <div className={`rounded-lg border p-3 ${highlight ? 'border-primary/40 bg-primary/5' : ''}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      {pct != null && <div className="text-xs text-muted-foreground">{pct}% do total</div>}
    </div>
  );
}
