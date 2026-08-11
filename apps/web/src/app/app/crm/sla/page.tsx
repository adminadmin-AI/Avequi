'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { AlertTriangle, Loader2, Snowflake } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { usePermission } from '@/hooks/use-permission';
import { useAuthStore } from '@/stores/auth-store';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { SOURCE_LABEL } from '../inbox/inbox-types';

interface SlaPanel {
  slaMinutes: number;
  coolingHours: number;
  breaching: Array<{
    id: string;
    name: string | null;
    phone: string | null;
    source: string;
    waitingMinutes: number;
    slaWarnedAt: string | null;
    slaEscalatedAt: string | null;
    assignedTo: { id: string; name: string } | null;
  }>;
  cooling: Array<{
    id: string;
    name: string | null;
    phone: string | null;
    source: string;
    idleHours: number | null;
    stage: { name: string } | null;
    assignedTo: { id: string; name: string } | null;
  }>;
}

/**
 * SLA & alertas (CRM F2.3 #516): leads estourando o SLA de primeira resposta
 * e leads abertos esfriando. Velocidade de resposta = conversão.
 */
export default function SlaPage() {
  const user = useAuthStore((s) => s.user);
  // #1003 — o backend NÃO restringe scope=all (qualquer crm.leads.view pode
  // pedir; herança pré-#624). O toggle segue gerencial por decisão de UX, via
  // proxy crm.leads.bulk-stage (mesmos perfis de hoje). Quando nascer uma
  // permissão própria (crm.leads.view-all), trocar aqui.
  const { can } = usePermission();
  const isManager = can('crm.leads.bulk-stage');
  const [scope, setScope] = useState<'mine' | 'all'>(isManager ? 'all' : 'mine');

  const { data, isLoading } = useQuery<SlaPanel>({
    queryKey: ['crm-sla', scope],
    queryFn: async () => (await apiClient.get('/crm/sla', { params: { scope } })).data,
    refetchInterval: 15000,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="SLA e alertas"
        description={
          data
            ? `Primeira resposta em até ${data.slaMinutes}min · esfriando após ${data.coolingHours}h`
            : 'Monitor de tempo de resposta'
        }
        actions={
          isManager && (
            <div className="flex gap-1">
              {(['mine', 'all'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`rounded-full px-3 py-1 text-xs ${
                    scope === s ? 'bg-brand-600 text-white' : 'bg-neutral-500/[0.08] text-content-muted'
                  }`}
                >
                  {s === 'mine' ? 'Meus' : 'Todas as lojas'}
                </button>
              ))}
            </div>
          )
        }
      />

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-content-muted" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="surface-sheen rounded-xl bg-surface shadow-soft">
            <header className="flex items-center gap-2 border-b bg-danger/5 p-3">
              <AlertTriangle className="h-4 w-4 text-danger" />
              <h2 className="text-sm font-medium">
                Estourando SLA
                <Badge variant="danger" className="ml-2">
                  {data?.breaching.length ?? 0}
                </Badge>
              </h2>
            </header>
            <ul className="divide-y">
              {data?.breaching.length === 0 && (
                <li className="p-6 text-center text-sm text-content-muted">
                  Tudo respondido no prazo 🎉
                </li>
              )}
              {data?.breaching.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{l.name ?? l.phone}</div>
                    <div className="flex items-center gap-1 text-xs text-content-muted">
                      <Badge variant="info" className="text-[10px]">
                        {SOURCE_LABEL[l.source] ?? l.source}
                      </Badge>
                      {l.assignedTo?.name ?? 'sem vendedor'}
                      {/* #569 — régua de escalonamento já agiu neste lead */}
                      {l.slaEscalatedAt ? (
                        <Badge variant="danger" className="text-[10px]">escalonado</Badge>
                      ) : l.slaWarnedAt ? (
                        <Badge variant="warning" className="text-[10px]">avisado</Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs font-medium text-danger">
                      {formatWait(l.waitingMinutes)}
                    </span>
                    <Link href="/app/crm/inbox" className="text-xs underline">
                      responder
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="surface-sheen rounded-xl bg-surface shadow-soft">
            <header className="flex items-center gap-2 border-b bg-sky-500/5 p-3">
              <Snowflake className="h-4 w-4 text-sky-500" />
              <h2 className="text-sm font-medium">
                Esfriando
                <Badge variant="info" className="ml-2">
                  {data?.cooling.length ?? 0}
                </Badge>
              </h2>
            </header>
            <ul className="divide-y">
              {data?.cooling.length === 0 && (
                <li className="p-6 text-center text-sm text-content-muted">
                  Nenhum lead parado
                </li>
              )}
              {data?.cooling.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{l.name ?? l.phone}</div>
                    <div className="flex items-center gap-1 text-xs text-content-muted">
                      {l.stage?.name && (
                        <Badge variant="neutral" className="text-[10px]">
                          {l.stage.name}
                        </Badge>
                      )}
                      {l.assignedTo?.name ?? 'sem vendedor'}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-content-muted">
                      {l.idleHours != null ? `${l.idleHours}h parado` : ''}
                    </span>
                    <Link href="/app/crm/inbox" className="text-xs underline">
                      retomar
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

function formatWait(min: number): string {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}
