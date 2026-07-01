'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Clock,
  ArrowDownCircle,
  ArrowUpCircle,
  Package,
  RefreshCw,
  Info,
  type LucideIcon,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { formatNumber, formatDate } from '@/lib/format';

/**
 * Indicadores financeiros (KPIs) — Issue #382 (PMP/PMR + Ciclo Financeiro).
 *
 * Consome `GET /finance/kpis?startDate=&endDate=` (backend a cargo do Claudinho).
 * Enquanto o endpoint não existir, a tela mostra estado de carregamento/erro
 * sem quebrar — os valores acendem automaticamente quando o backend subir.
 *
 * PMP = Prazo Médio de Pagamento (dias entre criar e pagar um PAYABLE)
 * PMR = Prazo Médio de Recebimento (dias entre criar e receber um RECEIVABLE)
 * PME = Prazo Médio de Estoque (dias que o produto fica em estoque)
 * Ciclo Financeiro = PMR + PME − PMP (dias que a empresa financia a operação)
 */

interface FinanceKpis {
  pmp: number;
  pmr: number;
  pme: number;
  cicloFinanceiro: number;
  periodo: { start: string; end: string };
}

const PERIODS = [
  { days: 90, label: '90 dias' },
  { days: 180, label: '6 meses' },
  { days: 365, label: '12 meses' },
];

interface KpiMeta {
  key: keyof Pick<FinanceKpis, 'pmr' | 'pmp' | 'pme' | 'cicloFinanceiro'>;
  label: string;
  icon: LucideIcon;
  tone: 'brand' | 'success' | 'warning' | 'neutral';
  help: string;
}

const KPI_META: KpiMeta[] = [
  {
    key: 'pmr',
    label: 'PMR — Prazo Médio de Recebimento',
    icon: ArrowDownCircle,
    tone: 'success',
    help: 'Em média, quantos dias a empresa leva para receber de um cliente após emitir a conta. Quanto menor, melhor para o caixa.',
  },
  {
    key: 'pmp',
    label: 'PMP — Prazo Médio de Pagamento',
    icon: ArrowUpCircle,
    tone: 'brand',
    help: 'Em média, quantos dias a empresa leva para pagar um fornecedor. Quanto maior (sem juros), mais fôlego de caixa.',
  },
  {
    key: 'pme',
    label: 'PME — Prazo Médio de Estoque',
    icon: Package,
    tone: 'warning',
    help: 'Em média, quantos dias um produto fica em estoque antes de ser vendido. Quanto menor, menos capital parado.',
  },
  {
    key: 'cicloFinanceiro',
    label: 'Ciclo Financeiro',
    icon: RefreshCw,
    tone: 'neutral',
    help: 'PMR + PME − PMP. É o número de dias que a empresa precisa financiar sozinha a operação. Menor (ou negativo) é melhor.',
  },
];

const TONE_CLS: Record<KpiMeta['tone'], string> = {
  brand: 'bg-brand-50 text-brand-600',
  success: 'bg-green-50 text-success',
  warning: 'bg-warning-50 text-warning',
  neutral: 'bg-slate-100 text-slate-600',
};

function KpiCard({ meta, value }: { meta: KpiMeta; value: number | undefined }) {
  return (
    <Card>
      <CardContent className="py-5">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
              TONE_CLS[meta.tone],
            )}
          >
            <meta.icon size={20} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {meta.label}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
              {value == null ? '—' : `${formatNumber(value)} dias`}
            </p>
          </div>
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
          <Info size={14} className="mt-px shrink-0 text-slate-400" />
          <span>{meta.help}</span>
        </p>
      </CardContent>
    </Card>
  );
}

export default function IndicadoresFinanceirosPage() {
  const [days, setDays] = useState(90);

  const range = useMemo(() => {
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - days);
    return {
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    };
  }, [days]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<FinanceKpis>({
    queryKey: ['/finance/kpis', range],
    queryFn: async () => {
      const { data } = await apiClient.get<FinanceKpis>('/finance/kpis', {
        params: { startDate: range.startDate, endDate: range.endDate },
      });
      return data;
    },
    retry: false,
  });

  return (
    <div>
      <PageHeader
        title="Indicadores Financeiros"
        description="PMP, PMR, prazo de estoque e ciclo financeiro no período selecionado."
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => setDays(p.days)}
                className={cn(
                  'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                  days === p.days
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-slate-500">
              Não foi possível carregar os indicadores. O endpoint{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">/finance/kpis</code> pode
              ainda não estar disponível.
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw size={14} className={cn(isFetching && 'animate-spin')} />
              Tentar novamente
            </button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {KPI_META.map((meta) => (
              <KpiCard key={meta.key} meta={meta} value={data?.[meta.key]} />
            ))}
          </div>
          {data?.periodo && (
            <p className="mt-4 text-xs text-slate-400">
              Período analisado: {formatDate(data.periodo.start)} a {formatDate(data.periodo.end)}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
