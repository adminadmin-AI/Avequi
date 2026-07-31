'use client';

import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, LineChart } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { formatBRL } from '@/lib/format';
import type { WidgetComponentProps } from '../types';
import { ChartSkeleton, EmptyState, WidgetAction, WidgetFrame } from '../widget-frame';

const CashFlowSparkline = dynamic(() => import('./cashflow-chart').then((m) => m.CashFlowSparkline), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

/**
 * Fluxo de caixa 13 semanas — F3, zona de trabalho (perfis executive e
 * finance). Consome o endpoint dos Sprints financeiros (#383):
 * GET /banking/cash-flow/weekly. O dado mais acionável é o firstAlertWeek —
 * a primeira semana projetada com saldo negativo.
 */

export interface CashFlowWeek {
  weekStart: string;
  weekEnd: string;
  inflow: number;
  outflow: number;
  netFlow: number;
  projectedBalance: number;
  alert: boolean;
}

interface CashFlowWeeklyResponse {
  currentBalance: number;
  weeks: number;
  firstAlertWeek: string | null;
  projection: CashFlowWeek[];
}

function formatWeek(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function CashFlowWidget(_: WidgetComponentProps) {
  const cashQ = useQuery({
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryKey: ['/banking/cash-flow/weekly'],
    queryFn: async () =>
      (await apiClient.get<CashFlowWeeklyResponse>('/banking/cash-flow/weekly')).data,
  });

  const data = cashQ.data;

  return (
    <WidgetFrame
      title="Fluxo de caixa — 13 semanas"
      action={<WidgetAction href="/app/finance/cash-flow">ver fluxo</WidgetAction>}
    >
      {cashQ.isLoading ? (
        <ChartSkeleton />
      ) : !data || data.projection.length === 0 ? (
        <EmptyState
          tall
          icon={LineChart}
          title="Sem projeção de fluxo disponível"
          hint="Lance contas a pagar e a receber para projetar as próximas 13 semanas."
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[19px] font-semibold leading-7 tabular-nums tracking-[-0.02em] text-content">
              {formatBRL(data.currentBalance)}
              <span className="ml-1.5 text-caption font-normal text-content-muted">saldo atual</span>
            </p>
            {data.firstAlertWeek && (
              <p className="flex items-center gap-1.5 text-caption text-danger">
                <AlertTriangle size={13} />
                projeção negativa na semana de {formatWeek(data.firstAlertWeek)}
              </p>
            )}
          </div>
          <CashFlowSparkline data={data.projection} />
        </div>
      )}
    </WidgetFrame>
  );
}
