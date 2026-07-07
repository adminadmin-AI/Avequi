'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { SOURCE_LABEL } from '../inbox/inbox-types';
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
  lostReasons: Array<{ reason: string; count: number }>;
  /** #569 — leads realocados por SLA estourado no período */
  slaEscalations: number;
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label="Leads" value={f!.total} />
              <Stat label="Responderam" value={f!.responded} pct={f!.respondedRate} />
              <Stat label="Chegaram a proposta" value={f!.reachedProposal} pct={f!.proposalRate} />
              <Stat label="Fechados" value={f!.won} pct={f!.winRate} highlight />
              <Stat label="Realocados por SLA" value={data.slaEscalations} />
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

          {/* Motivos de perda */}
          {data.lostReasons.length > 0 && (
            <section className="rounded-lg border p-4">
              <h2 className="mb-3 text-sm font-medium">Motivos de perda</h2>
              <div className="flex flex-wrap gap-2">
                {data.lostReasons.map((r) => (
                  <Badge key={r.reason} variant="danger" outline>
                    {r.reason}: {r.count}
                  </Badge>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
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
