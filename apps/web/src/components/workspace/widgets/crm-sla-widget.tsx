'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { WidgetComponentProps } from '../types';
import { ListSkeleton, WidgetFrame } from '../widget-frame';

/**
 * SLA de leads — F3, zona de trabalho (perfil commercial). Consome o painel
 * da F2.3 (#516): GET /crm/sla?scope=mine — leads MEUS estourando SLA de
 * primeira resposta (vermelho) e esfriando sem interação (âmbar).
 */

interface SlaBreachingLead {
  id: string;
  name: string | null;
  waitingMinutes: number;
}

interface SlaCoolingLead {
  id: string;
  name: string | null;
  idleHours: number | null;
}

interface CrmSlaResponse {
  slaMinutes: number;
  coolingHours: number;
  breaching: SlaBreachingLead[];
  cooling: SlaCoolingLead[];
}

export function CrmSlaWidget({ instance }: WidgetComponentProps) {
  const scope = (instance.props?.scope as 'mine' | 'all' | undefined) ?? 'mine';
  const slaQ = useQuery({
    retry: false,
    staleTime: 60 * 1000,
    queryKey: ['/crm/sla', scope],
    queryFn: async () =>
      (await apiClient.get<CrmSlaResponse>('/crm/sla', { params: { scope } })).data,
  });

  const breaching = slaQ.data?.breaching ?? [];
  const cooling = slaQ.data?.cooling ?? [];

  return (
    <WidgetFrame
      title="SLA de leads"
      action={
        <Link
          href="/app/crm/sla"
          className="text-caption font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
        >
          ver painel
        </Link>
      }
    >
      {slaQ.isLoading ? (
        <ListSkeleton />
      ) : breaching.length === 0 && cooling.length === 0 ? (
        <p className="py-2 text-caption text-content-muted">
          Nenhum lead estourando SLA ou esfriando. 🎉
        </p>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {breaching.slice(0, 5).map((l) => (
            <SlaRow
              key={l.id}
              tone="danger"
              name={l.name}
              detail={`sem resposta há ${Math.round(l.waitingMinutes)}min`}
            />
          ))}
          {cooling.slice(0, Math.max(0, 5 - breaching.length)).map((l) => (
            <SlaRow
              key={l.id}
              tone="warning"
              name={l.name}
              detail={l.idleHours != null ? `parado há ${Math.round(l.idleHours)}h` : 'esfriando'}
            />
          ))}
        </ul>
      )}
    </WidgetFrame>
  );
}

function SlaRow({
  tone,
  name,
  detail,
}: {
  tone: 'danger' | 'warning';
  name: string | null;
  detail: string;
}) {
  return (
    <li>
      <Link
        href="/app/crm/sla"
        className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors duration-micro hover:bg-neutral-500/[0.05]"
      >
        <span
          className={cn('h-2 w-2 shrink-0 rounded-full', tone === 'danger' ? 'bg-danger' : 'bg-warning')}
        />
        <span className="min-w-0 flex-1 truncate text-sm text-content">{name ?? 'Lead sem nome'}</span>
        <span className="shrink-0 text-caption text-content-muted">{detail}</span>
      </Link>
    </li>
  );
}
