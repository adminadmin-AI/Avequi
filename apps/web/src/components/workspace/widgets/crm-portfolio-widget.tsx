'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { WidgetComponentProps } from '../types';
import { EmptyState, ListSkeleton, WidgetAction, WidgetFrame } from '../widget-frame';
import { relativeTime } from '../workspace-context';

/**
 * Carteira de clientes — F3, zona de trabalho (perfis executive e
 * commercial). Consome GET /crm/portfolio (#846, v1.23.0). O número que
 * age é o "em risco" (sem compra na janela de atividade) — os demais são
 * contexto de-boxed.
 */

interface PortfolioResponse {
  newCustomers: { count: number };
  active: { count: number };
  atRisk: {
    count: number;
    customers: { customerId: string; name: string; lastPurchaseAt: string | null }[];
  };
  repurchase: { rate: number };
}

export function CrmPortfolioWidget(_: WidgetComponentProps) {
  const portfolioQ = useQuery({
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryKey: ['/crm/portfolio'],
    queryFn: async () => (await apiClient.get<PortfolioResponse>('/crm/portfolio')).data,
  });

  const d = portfolioQ.data;

  return (
    <WidgetFrame
      title="Carteira de clientes"
      action={<WidgetAction href="/app/crm/dashboard">ver CRM</WidgetAction>}
    >
      {portfolioQ.isLoading ? (
        <ListSkeleton />
      ) : !d ? (
        <EmptyState icon={Users} title="Carteira indisponível no momento" />
      ) : (
        <div className="space-y-3">
          {/* De-box: números como tipografia, cor só no alarme real (risco) */}
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Novos no período" value={d.newCustomers.count} />
            <Stat label="Ativos" value={d.active.count} />
            <Stat label="Em risco" value={d.atRisk.count} alarm={d.atRisk.count > 0} />
          </div>
          {d.atRisk.customers.length > 0 && (
            <ul className="-mx-2 border-t border-line pt-2">
              {d.atRisk.customers.slice(0, 3).map((c) => (
                <li key={c.customerId}>
                  <Link
                    href="/app/crm/dashboard"
                    className="group flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors duration-micro hover:bg-neutral-500/[0.05]"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                    <span className="min-w-0 flex-1 truncate text-sm text-content">{c.name}</span>
                    <span className="shrink-0 text-caption text-content-muted">
                      {c.lastPurchaseAt
                        ? `última compra ${relativeTime(c.lastPurchaseAt)}`
                        : 'sem compra registrada'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </WidgetFrame>
  );
}

function Stat({ label, value, alarm }: { label: string; value: number; alarm?: boolean }) {
  return (
    <div className="min-w-0">
      <p
        className={cn(
          'text-[19px] font-semibold leading-7 tabular-nums tracking-[-0.02em]',
          alarm ? 'text-warning' : 'text-content',
        )}
      >
        {value}
      </p>
      <p className="text-caption text-content-muted">{label}</p>
    </div>
  );
}
