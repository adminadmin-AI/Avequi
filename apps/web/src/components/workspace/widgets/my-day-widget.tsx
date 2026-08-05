'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { formatBRL, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { WidgetComponentProps } from '../types';
import { deltaTone, formatDeltaPct, longBusinessDate } from '../my-day';
import { ChromelessWidget } from '../widget-frame';
import { useWorkspacePeriod } from '../workspace-context';

/**
 * Meu Dia — zona de orientação, dentro do bloco do hero (brief "Workspace
 * Vivo", pt.7). Responde duas perguntas que o KPI sozinho não responde:
 * "o que já andou HOJE?" e "o período está melhor ou pior que o anterior?".
 *
 * Tudo vem de GET /workspace/my-day, já curado por permissão no servidor —
 * quem não enxerga vendas simplesmente não recebe a chave `invoiced`.
 *
 * HONESTIDADE: sem meta e sem streak (metas moram no épico #867/#868 e ainda
 * não existem no cadastro). Quando o período anterior é zero, o delta vem
 * null e a UI diz "sem base" — não inventa +100%.
 */

interface MyDayDelta {
  current: number;
  previous: number;
  deltaPct: number | null;
}

interface MyDayResponse {
  date: string;
  periodDays: number;
  today: {
    invoiced?: { amount: number; count: number };
    received?: { amount: number; count: number };
    produced?: { orders: number; qty: number };
  };
  period: {
    invoiced?: MyDayDelta;
    received?: MyDayDelta;
    produced?: MyDayDelta;
  };
}

export function MyDayWidget(_: WidgetComponentProps) {
  const { periodDays } = useWorkspacePeriod();

  const myDayQ = useQuery({
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryKey: ['/workspace/my-day', periodDays],
    queryFn: async () =>
      (await apiClient.get<MyDayResponse>('/workspace/my-day', { params: { days: periodDays } }))
        .data,
  });

  const data = myDayQ.data;

  const todayItems = [
    data?.today.invoiced && {
      key: 'invoiced',
      value: formatBRL(data.today.invoiced.amount),
      label: 'faturado hoje',
      hint:
        data.today.invoiced.count > 0
          ? `${data.today.invoiced.count} ${data.today.invoiced.count === 1 ? 'venda' : 'vendas'}`
          : undefined,
      empty: data.today.invoiced.amount === 0,
    },
    data?.today.received && {
      key: 'received',
      value: formatBRL(data.today.received.amount),
      label: 'recebido hoje',
      hint:
        data.today.received.count > 0
          ? `${data.today.received.count} ${data.today.received.count === 1 ? 'baixa' : 'baixas'}`
          : undefined,
      empty: data.today.received.amount === 0,
    },
    data?.today.produced && {
      key: 'produced',
      value: formatNumber(data.today.produced.orders),
      label: data.today.produced.orders === 1 ? 'OP concluída hoje' : 'OPs concluídas hoje',
      hint: data.today.produced.qty > 0 ? `${formatNumber(data.today.produced.qty)} un` : undefined,
      empty: data.today.produced.orders === 0,
    },
  ].filter(Boolean) as {
    key: string;
    value: string;
    label: string;
    hint?: string;
    empty: boolean;
  }[];

  const periodItems = [
    data?.period.invoiced && { key: 'invoiced', label: 'faturamento', delta: data.period.invoiced },
    data?.period.received && { key: 'received', label: 'recebimentos', delta: data.period.received },
    data?.period.produced && { key: 'produced', label: 'produção', delta: data.period.produced },
  ].filter(Boolean) as { key: string; label: string; delta: MyDayDelta }[];

  // Nenhuma das três fontes é visível para este usuário: o bloco não existe.
  if (!myDayQ.isLoading && todayItems.length === 0 && periodItems.length === 0) return null;

  const nothingToday = todayItems.length > 0 && todayItems.every((i) => i.empty);

  return (
    <ChromelessWidget>
      <div className="border-t border-line pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-caption font-semibold uppercase tracking-wide text-content-muted">
            Meu dia
          </h2>
          {data?.date && (
            <span className="text-helper capitalize text-content-muted">
              {longBusinessDate(data.date)}
            </span>
          )}
        </div>

        {myDayQ.isLoading ? (
          <div className="mt-4 flex flex-wrap gap-x-12 gap-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2">
                <div className="h-7 w-24 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
                <div className="h-3 w-16 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {nothingToday ? (
              <p className="mt-3 text-body text-content-secondary">
                Nada registrado hoje ainda. O dia está começando.
              </p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-x-12 gap-y-4">
                {todayItems.map((item) => (
                  <div key={item.key} className="min-w-0">
                    <p
                      className={cn(
                        'truncate text-[19px] font-semibold leading-7 tracking-[-0.02em] tabular-nums',
                        item.empty ? 'text-content-muted' : 'text-content',
                      )}
                    >
                      {item.value}
                    </p>
                    <p className="truncate text-caption text-content-muted">
                      {item.label}
                      {item.hint ? ` · ${item.hint}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {periodItems.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
                <span className="text-caption text-content-muted">
                  Últimos {data?.periodDays ?? periodDays} dias
                </span>
                {periodItems.map((item) => (
                  <DeltaPill key={item.key} label={item.label} delta={item.delta} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </ChromelessWidget>
  );
}

/**
 * Variação vs. período anterior. Cor semântica sutil (subir é bom nas três
 * métricas); sem base de comparação vira traço, não percentual.
 */
function DeltaPill({ label, delta }: { label: string; delta: MyDayDelta }) {
  const tone = deltaTone(delta.deltaPct);
  const Icon = tone === 'flat' ? Minus : tone === 'up' ? ArrowUpRight : ArrowDownRight;
  const toneClass =
    tone === 'flat' ? 'text-content-muted' : tone === 'up' ? 'text-success' : 'text-danger';

  return (
    <span
      className="inline-flex items-center gap-1 text-caption text-content-secondary"
      title={
        delta.deltaPct == null
          ? 'Sem base de comparação: o período anterior não teve movimento'
          : `Período anterior: ${delta.previous.toLocaleString('pt-BR')}`
      }
    >
      <Icon size={13} className={cn('shrink-0', toneClass)} />
      <span className={cn('font-medium tabular-nums', toneClass)}>
        {formatDeltaPct(delta.deltaPct)}
      </span>
      <span className="text-content-muted">{label}</span>
    </span>
  );
}
