'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { Layers } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type {
  Product,
  CifRate,
  ProductAbsorptionCost,
  PricingBreakdownItem,
  CostLaborStep,
  ApiError,
} from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Field } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBRL, formatPercent, formatNumber } from '@/lib/format';

function apiMessage(err: unknown): string | null {
  const e = err as AxiosError<ApiError>;
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  return msg ?? null;
}

export default function CostingPage() {
  const { data: products = [], isLoading: loadingProducts } = useList<Product>('/products');
  const [productId, setProductId] = useState('');

  const productOptions = useMemo(
    () => products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` })),
    [products],
  );

  const cifRateQuery = useQuery<CifRate>({
    queryKey: ['costing-cif-rate'],
    queryFn: async () => (await apiClient.get<CifRate>('/costing/cif-rate')).data,
    retry: false,
  });

  const cost = useQuery<ProductAbsorptionCost>({
    queryKey: ['costing-product', productId],
    queryFn: async () => (await apiClient.get<ProductAbsorptionCost>(`/costing/product/${productId}`)).data,
    enabled: productId !== '',
    retry: false,
  });

  const materialColumns: Column<PricingBreakdownItem>[] = [
    { key: 'sku', header: 'SKU' },
    { key: 'name', header: 'Componente' },
    { key: 'quantity', header: 'Qtd', align: 'right', cell: (r) => formatNumber(r.quantity) },
    { key: 'unitCost', header: 'Custo unit.', align: 'right', cell: (r) => formatBRL(r.unitCost) },
    { key: 'subtotal', header: 'Subtotal', align: 'right', cell: (r) => formatBRL(r.subtotal) },
  ];
  const laborColumns: Column<CostLaborStep>[] = [
    { key: 'step', header: 'Operação' },
    { key: 'workCenter', header: 'Centro de trabalho', cell: (r) => r.workCenter ?? '—' },
    { key: 'hours', header: 'Horas', align: 'right', cell: (r) => formatNumber(r.hours) },
    { key: 'costPerHour', header: 'Custo/hora', align: 'right', cell: (r) => formatBRL(r.costPerHour) },
    { key: 'cost', header: 'Custo', align: 'right', cell: (r) => formatBRL(r.cost) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Custeio por Absorção" description="Material + MOD + CIF rateado, com comparativo com/sem CIF (#396)" />

      {/* Taxa CIF da empresa */}
      <Card>
        <CardHeader>
          <CardTitle>Taxa CIF por hora (empresa)</CardTitle>
        </CardHeader>
        <CardContent>
          {cifRateQuery.isLoading ? (
            <Skeleton className="h-10 w-full max-w-md" />
          ) : cifRateQuery.isError ? (
            <p className="text-body text-danger">{apiMessage(cifRateQuery.error) ?? 'Erro ao carregar taxa CIF.'}</p>
          ) : cifRateQuery.data ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric label="CIF/hora" value={formatBRL(cifRateQuery.data.ratePerHour)} accent />
              <Metric label="CIF mensal" value={formatBRL(cifRateQuery.data.monthlyCif)} />
              <Metric label="Horas produtivas/mês" value={formatNumber(cifRateQuery.data.monthlyProductiveHours)} />
              <Metric label="Centros de custo ativos" value={formatNumber(cifRateQuery.data.centers)} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* Seleção */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Produto</CardTitle>
          </CardHeader>
          <CardContent>
            <Field label="Produto">
              <Combobox
                options={productOptions}
                value={productId}
                onValueChange={setProductId}
                placeholder={loadingProducts ? 'Carregando produtos...' : 'Selecione um produto'}
                searchPlaceholder="Buscar por SKU ou nome..."
                clearable
              />
            </Field>
          </CardContent>
        </Card>

        {/* Resultado */}
        <div className="space-y-6">
          {productId === '' && (
            <Card>
              <CardContent className="py-12">
                <EmptyState
                  icon={Layers}
                  title="Selecione um produto"
                  description="Escolha um produto para ver o custo por absorção: material (BOM) + mão de obra (roteiro) + CIF rateado."
                />
              </CardContent>
            </Card>
          )}

          {productId !== '' && cost.isFetching && (
            <Card>
              <CardContent className="space-y-3 py-6">
                <Skeleton className="h-10 w-56" />
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          )}

          {productId !== '' && cost.isError && !cost.isFetching && (
            <Card>
              <CardContent className="py-8">
                <ErrorState
                  title="Não foi possível calcular o custo"
                  description={apiMessage(cost.error) ?? 'Erro ao calcular o custeio. Tente novamente.'}
                  onRetry={() => cost.refetch()}
                />
              </CardContent>
            </Card>
          )}

          {productId !== '' && cost.data && !cost.isFetching && !cost.isError && (
            <>
              {/* Total por absorção */}
              <Card>
                <CardHeader className="flex-row items-center justify-between gap-3">
                  <CardTitle>
                    Custo por absorção
                    <span className="ml-2 text-caption font-normal text-content-muted">
                      {cost.data.sku} — {cost.data.name}
                    </span>
                  </CardTitle>
                  {cost.data.cifImpactPct != null && (
                    <Badge variant="warning">CIF +{formatPercent(cost.data.cifImpactPct)}</Badge>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                    <div>
                      <p className="text-caption text-content-muted">Com CIF (absorção)</p>
                      <p className="text-display leading-none text-brand-600 dark:text-brand-400">
                        {formatBRL(cost.data.totalWithCif)}
                      </p>
                    </div>
                    <div>
                      <p className="text-caption text-content-muted">Sem CIF (direto)</p>
                      <p className="text-heading text-content-secondary">{formatBRL(cost.data.totalWithoutCif)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <Metric label="Material" value={formatBRL(cost.data.material.total)} />
                    <Metric label="MOD" value={formatBRL(cost.data.labor.total)} />
                    <Metric label="CIF rateado" value={formatBRL(cost.data.cif.total)} />
                  </div>
                </CardContent>
              </Card>

              {/* Material */}
              <Card>
                <CardHeader className="flex-row items-center justify-between gap-3">
                  <CardTitle>Material (BOM)</CardTitle>
                  <Badge variant="neutral">{formatBRL(cost.data.material.total)}</Badge>
                </CardHeader>
                <CardContent>
                  {cost.data.material.breakdown.length > 0 ? (
                    <DataTable
                      data={cost.data.material.breakdown}
                      columns={materialColumns}
                      rowKey={(r) => r.componentId}
                      searchable={false}
                      pageSize={100}
                      emptyMessage="Sem componentes na BOM."
                    />
                  ) : (
                    <p className="text-body text-content-muted">Produto sem BOM ativa.</p>
                  )}
                </CardContent>
              </Card>

              {/* MOD */}
              <Card>
                <CardHeader className="flex-row items-center justify-between gap-3">
                  <CardTitle>
                    Mão de obra direta
                    <span className="ml-2 text-caption font-normal text-content-muted">
                      {formatNumber(cost.data.labor.hours)} h
                    </span>
                  </CardTitle>
                  <Badge variant="neutral">{formatBRL(cost.data.labor.total)}</Badge>
                </CardHeader>
                <CardContent>
                  {cost.data.labor.breakdown.length > 0 ? (
                    <DataTable
                      data={cost.data.labor.breakdown}
                      columns={laborColumns}
                      rowKey={(r) => r.step}
                      searchable={false}
                      pageSize={100}
                      emptyMessage="Sem roteiro de produção."
                    />
                  ) : (
                    <p className="text-body text-content-muted">Produto sem roteiro (operações) cadastrado.</p>
                  )}
                </CardContent>
              </Card>

              {/* CIF */}
              <Card>
                <CardHeader>
                  <CardTitle>CIF rateado</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4">
                    <Metric label="CIF/hora" value={formatBRL(cost.data.cif.ratePerHour)} />
                    <Metric label="Horas do produto" value={formatNumber(cost.data.cif.hours)} />
                    <Metric label="CIF total" value={formatBRL(cost.data.cif.total)} />
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-caption text-content-muted">{label}</p>
      <p className={`text-subtitle font-medium ${accent ? 'text-accent-600' : 'text-content'}`}>{value}</p>
    </div>
  );
}
