'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, FileWarning } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import type { WidgetComponentProps } from '../types';
import { ListSkeleton, WidgetFrame } from '../widget-frame';
import { relativeTime } from '../workspace-context';

/**
 * Documentos do veículo — F3, zona de trabalho (perfil logistics/expedição).
 * Consome GET /vehicle-documents/pending-deliveries (#364): vendas de
 * veículo FATURADAS sem nenhum documento regulatório entregue — o item de
 * compliance crítico da GDR (chassi). O endpoint devolve a lista crua
 * (id/invoicedAt/createdAt); o detalhe mora na própria venda.
 */

interface PendingDelivery {
  id: string;
  invoicedAt: string | null;
  createdAt: string;
}

export function VehicleDocsWidget(_: WidgetComponentProps) {
  const pendingQ = useQuery({
    retry: false,
    staleTime: 60 * 1000,
    queryKey: ['/vehicle-documents/pending-deliveries'],
    queryFn: async () =>
      (await apiClient.get<PendingDelivery[]>('/vehicle-documents/pending-deliveries')).data,
  });

  const pending = pendingQ.data ?? [];

  return (
    <WidgetFrame
      title="Documentos do veículo"
      action={
        <Link
          href="/app/sales"
          className="text-caption font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
        >
          ver vendas
        </Link>
      }
    >
      {pendingQ.isLoading ? (
        <ListSkeleton />
      ) : pending.length === 0 ? (
        <p className="py-2 text-caption text-content-muted">
          Todas as vendas faturadas têm documentos entregues. ✅
        </p>
      ) : (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-caption text-danger">
            <FileWarning size={13} />
            {pending.length === 1
              ? '1 venda faturada sem documentos entregues'
              : `${pending.length} vendas faturadas sem documentos entregues`}
          </p>
          <ul className="-mx-2 space-y-0.5">
            {pending.slice(0, 5).map((p) => (
              <li key={p.id}>
                <Link
                  href={`/app/sales/${p.id}`}
                  className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors duration-micro hover:bg-neutral-500/[0.05]"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full bg-danger" />
                  <span className="min-w-0 flex-1 truncate text-sm text-content">
                    Venda faturada em {p.invoicedAt ? formatDate(p.invoicedAt) : '—'}
                  </span>
                  <span className="shrink-0 text-caption text-content-muted">
                    {p.invoicedAt ? relativeTime(p.invoicedAt) : ''}
                  </span>
                  <ArrowRight
                    size={14}
                    className="shrink-0 text-content-muted opacity-0 transition-opacity duration-micro group-hover:opacity-60"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </WidgetFrame>
  );
}
