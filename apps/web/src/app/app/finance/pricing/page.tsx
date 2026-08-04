'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { Tags, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type { Product, PricingSimulation, PricingBreakdownItem, ApiError } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBRL, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

const COST_SOURCE_LABEL: Record<PricingSimulation['cost']['source'], string> = {
  override: 'Custo informado',
  avgCost: 'Custo médio',
  costPrice: 'Custo padrão',
};

interface SimParams {
  productId: string;
  marginPct: number;
  costOverride?: number;
}

function apiMessage(err: unknown): string | null {
  const e = err as AxiosError<ApiError>;
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  return msg ?? null;
}

export default function PricingPage() {
  const { data: products = [], isLoading: loadingProducts } = useList<Product>('/products');

  const [productId, setProductId] = useState('');
  const [marginPct, setMarginPct] = useState('');
  const [costOverride, setCostOverride] = useState('');
  const [params, setParams] = useState<SimParams | null>(null);

  const productOptions = useMemo(
    () => products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` })),
    [products],
  );

  const marginNum = Number(marginPct);
  const canSimulate = productId !== '' && marginPct.trim() !== '' && !Number.isNaN(marginNum) && marginNum >= 0;

  const { data, isFetching, isError, error, refetch } = useQuery<PricingSimulation>({
    queryKey: ['pricing-simulate', params],
    queryFn: async () => {
      const res = await apiClient.get<PricingSimulation>('/pricing/simulate', { params });
      return res.data;
    },
    enabled: params != null,
    retry: false,
  });

  function handleSimulate() {
    if (!canSimulate) return;
    const override = costOverride.trim() !== '' ? Number(costOverride) : undefined;
    setParams({
      productId,
      marginPct: marginNum,
      costOverride: override != null && !Number.isNaN(override) ? override : undefined,
    });
  }

  const breakdownColumns: Column<PricingBreakdownItem>[] = [
    { key: 'sku', header: 'SKU' },
    { key: 'name', header: 'Componente' },
    { key: 'quantity', header: 'Qtd', align: 'right', cell: (r) => r.quantity.toLocaleString('pt-BR') },
    { key: 'unitCost', header: 'Custo unit.', align: 'right', cell: (r) => formatBRL(r.unitCost) },
    { key: 'subtotal', header: 'Subtotal', align: 'right', cell: (r) => formatBRL(r.subtotal) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Formação de preço" description="Custo + impostos + margem desejada" />

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* ─── Parâmetros ─────────────────────────────────────────────── */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Parâmetros</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Produto" required>
              <Combobox
                options={productOptions}
                value={productId}
                onValueChange={setProductId}
                placeholder={loadingProducts ? 'Carregando produtos...' : 'Selecione um produto'}
                searchPlaceholder="Buscar por SKU ou nome..."
                clearable
              />
            </Field>

            <Field label="Margem desejada (%)" required>
              <Input
                type="number"
                min="0"
                step="0.5"
                inputMode="decimal"
                value={marginPct}
                onChange={(e) => setMarginPct(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSimulate()}
                placeholder="Ex.: 30"
              />
            </Field>

            <Field label="Custo base (what-if, opcional)">
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={costOverride}
                onChange={(e) => setCostOverride(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSimulate()}
                placeholder="Simular outro custo (ex.: variação de MP)"
              />
            </Field>
            <p className="text-helper text-content-muted">
              Vazio = usa o custo médio (ou custo padrão) cadastrado no produto.
            </p>

            <Button className="w-full" onClick={handleSimulate} disabled={!canSimulate || isFetching}>
              {isFetching ? 'Simulando...' : 'Simular preço'}
            </Button>
          </CardContent>
        </Card>

        {/* ─── Resultado ──────────────────────────────────────────────── */}
        <div className="space-y-6">
          {params == null && (
            <Card>
              <CardContent className="py-12">
                <EmptyState
                  icon={Tags}
                  title="Simule o preço de um produto"
                  description="Selecione um produto e informe a margem desejada para calcular o preço sugerido com custo e impostos reais."
                />
              </CardContent>
            </Card>
          )}

          {params != null && isFetching && <ResultSkeleton />}

          {params != null && isError && !isFetching && (
            <Card>
              <CardContent className="py-8">
                <ErrorState
                  title="Não foi possível simular"
                  description={apiMessage(error) ?? 'Erro ao calcular o preço. Tente novamente.'}
                  onRetry={() => refetch()}
                />
              </CardContent>
            </Card>
          )}

          {params != null && data && !isFetching && !isError && <Result sim={data} breakdownColumns={breakdownColumns} />}
        </div>
      </div>
    </div>
  );
}

function ResultSkeleton() {
  return (
    <>
      <Card>
        <CardContent className="space-y-3 py-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-4 w-40" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 py-6">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    </>
  );
}

function Result({
  sim,
  breakdownColumns,
}: {
  sim: PricingSimulation;
  breakdownColumns: Column<PricingBreakdownItem>[];
}) {
  const { cost, taxes, comparison } = sim;
  const delta = comparison.delta;

  return (
    <>
      {/* Preço sugerido */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>
            Preço sugerido
            <span className="ml-2 text-caption font-normal text-content-muted">
              {sim.sku} — {sim.name}
            </span>
          </CardTitle>
          <Badge variant="brand">margem {formatPercent(sim.marginPct)}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <span className="text-display leading-none text-brand-600 dark:text-brand-400">
              {formatBRL(sim.suggestedPrice)}
            </span>
            <Badge variant="neutral">{COST_SOURCE_LABEL[cost.source]}</Badge>
          </div>

          {sim.currentPrice != null ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-body text-content-secondary">
              <span>
                Preço atual: <span className="font-medium text-content">{formatBRL(sim.currentPrice)}</span>
              </span>
              {delta != null && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 font-medium',
                    delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : 'text-content-muted',
                  )}
                >
                  {delta > 0 ? <TrendingUp className="h-4 w-4" /> : delta < 0 ? <TrendingDown className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                  {formatBRL(Math.abs(delta))} ({formatPercent(comparison.deltaPct)})
                </span>
              )}
              {comparison.currentMarginPct != null && (
                <span>
                  Margem líquida atual:{' '}
                  <span className="font-medium text-content">{formatPercent(comparison.currentMarginPct)}</span>
                </span>
              )}
            </div>
          ) : (
            <p className="text-body text-content-muted">Produto sem preço de venda cadastrado — sem comparativo.</p>
          )}
        </CardContent>
      </Card>

      {/* Composição do custo */}
      <Card>
        <CardHeader>
          <CardTitle>Composição do custo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Metric label="Custo base" value={formatBRL(cost.base)} />
            <Metric label="Material (BOM)" value={cost.materialFromBom != null ? formatBRL(cost.materialFromBom) : '—'} />
            <Metric label="Conversão (MOD+CIF)" value={cost.conversion != null ? formatBRL(cost.conversion) : '—'} />
          </div>

          {cost.breakdown && cost.breakdown.length > 0 ? (
            <DataTable
              data={cost.breakdown}
              columns={breakdownColumns}
              rowKey={(r) => r.componentId}
              searchable={false}
              pageSize={100}
              emptyMessage="Sem componentes na BOM."
            />
          ) : (
            <p className="text-body text-content-muted">
              Produto sem BOM ativa — custo tratado como valor único (sem explosão de materiais).
            </p>
          )}
        </CardContent>
      </Card>

      {/* Impostos */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>Impostos</CardTitle>
          <Badge variant={taxes.totalPct > 0 ? 'info' : 'neutral'}>total {formatPercent(taxes.totalPct)}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {taxes.warning && <Alert variant="warning" title="Sem regra fiscal">{taxes.warning}</Alert>}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="ICMS" value={formatPercent(taxes.icmsPct)} />
            <Metric label="IPI" value={formatPercent(taxes.ipiPct)} />
            <Metric label="PIS" value={formatPercent(taxes.pisPct)} />
            <Metric label="COFINS" value={formatPercent(taxes.cofinsPct)} />
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-caption text-content-muted">{label}</p>
      <p className="text-subtitle font-medium text-content">{value}</p>
    </div>
  );
}
