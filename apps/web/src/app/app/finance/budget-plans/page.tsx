'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { Plus, Pencil, Trash2, Target } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type {
  Product,
  BudgetPlanRow,
  BudgetProjection,
  BudgetProjectionDriver,
  BudgetSensitivity,
  BudgetVsRealized,
  ApiError,
} from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Combobox } from '@/components/ui/combobox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { FormDialog } from '@/components/ui/form-dialog';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatBRL, formatPercent, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

const num = (v: string | number) => (typeof v === 'string' ? Number(v) : v);
const apiMessage = (err: unknown) => {
  const m = (err as AxiosError<ApiError>)?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? 'Erro inesperado');
};
const signed = (v: number | null) =>
  v == null ? '—' : <span className={cn(v >= 0 ? 'text-success' : 'text-danger')}>{formatBRL(v)}</span>;

interface PlanForm {
  name: string;
  year: string;
  variableExpensePct: string;
  fixedExpenseMonthly: string;
  capex: string;
}
interface DriverForm {
  id?: string;
  label: string;
  productId: string;
  volume: string;
  avgPrice: string;
  unitCost: string;
}
const EMPTY_DRIVER: DriverForm = { label: '', productId: '', volume: '', avgPrice: '', unitCost: '' };

export default function BudgetPlansPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();

  const plans = useList<BudgetPlanRow>('/budget-plans');
  const { data: products = [] } = useList<Product>('/products');
  const productOptions = useMemo(
    () => products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` })),
    [products],
  );

  const [planId, setPlanId] = useState('');
  const [tab, setTab] = useState('projecao');

  const projection = useQuery<BudgetProjection>({
    queryKey: ['budget-proj', planId],
    queryFn: async () => (await apiClient.get<BudgetProjection>(`/budget-plans/${planId}/projection`)).data,
    enabled: planId !== '',
    retry: false,
  });
  const sensitivity = useQuery<BudgetSensitivity>({
    queryKey: ['budget-sens', planId],
    queryFn: async () => (await apiClient.get<BudgetSensitivity>(`/budget-plans/${planId}/sensitivity`)).data,
    enabled: planId !== '' && tab === 'sensibilidade',
    retry: false,
  });
  const vsReal = useQuery<BudgetVsRealized>({
    queryKey: ['budget-real', planId],
    queryFn: async () => (await apiClient.get<BudgetVsRealized>(`/budget-plans/${planId}/vs-realized`)).data,
    enabled: planId !== '' && tab === 'realizado',
    retry: false,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['budget-plans'] });
    qc.invalidateQueries({ queryKey: ['budget-proj', planId] });
    qc.invalidateQueries({ queryKey: ['budget-sens', planId] });
    qc.invalidateQueries({ queryKey: ['budget-real', planId] });
  }

  // ─── Dialogs / mutations ──────────────────────────────────────────────────
  const [planDialog, setPlanDialog] = useState(false);
  const [planEditing, setPlanEditing] = useState<BudgetPlanRow | null>(null);
  const [planForm, setPlanForm] = useState<PlanForm>({ name: '', year: '', variableExpensePct: '', fixedExpenseMonthly: '', capex: '' });

  const [driverDialog, setDriverDialog] = useState(false);
  const [driverForm, setDriverForm] = useState<DriverForm>(EMPTY_DRIVER);

  const savePlan = useMutation({
    mutationFn: async (f: PlanForm) => {
      const body = {
        name: f.name,
        variableExpensePct: f.variableExpensePct === '' ? 0 : Number(f.variableExpensePct),
        fixedExpenseMonthly: f.fixedExpenseMonthly === '' ? 0 : Number(f.fixedExpenseMonthly),
        capex: f.capex === '' ? 0 : Number(f.capex),
      };
      if (planEditing) return (await apiClient.patch(`/budget-plans/${planEditing.id}`, body)).data;
      return (await apiClient.post('/budget-plans', { ...body, year: Number(f.year) })).data as BudgetPlanRow;
    },
    onSuccess: (data: any) => {
      invalidate();
      setPlanDialog(false);
      if (!planEditing && data?.id) setPlanId(data.id);
    },
  });

  const deletePlan = useMutation({
    mutationFn: async (id: string) => apiClient.delete(`/budget-plans/${id}`),
    onSuccess: () => {
      setPlanId('');
      qc.invalidateQueries({ queryKey: ['budget-plans'] });
    },
  });

  const saveDriver = useMutation({
    mutationFn: async (f: DriverForm) => {
      const body = {
        id: f.id,
        productId: f.productId || undefined,
        label: f.label,
        volume: Number(f.volume || 0),
        avgPrice: Number(f.avgPrice || 0),
        unitCost: Number(f.unitCost || 0),
      };
      return (await apiClient.post(`/budget-plans/${planId}/drivers`, body)).data;
    },
    onSuccess: () => {
      invalidate();
      setDriverDialog(false);
    },
  });

  const deleteDriver = useMutation({
    mutationFn: async (driverId: string) => apiClient.delete(`/budget-plans/${planId}/drivers/${driverId}`),
    onSuccess: () => invalidate(),
  });

  function openNewPlan() {
    setPlanEditing(null);
    setPlanForm({ name: '', year: String(new Date().getFullYear()), variableExpensePct: '', fixedExpenseMonthly: '', capex: '' });
    setPlanDialog(true);
  }
  function openEditPlan(p: BudgetPlanRow) {
    setPlanEditing(p);
    setPlanForm({
      name: p.name,
      year: String(p.year),
      variableExpensePct: String(num(p.variableExpensePct)),
      fixedExpenseMonthly: String(num(p.fixedExpenseMonthly)),
      capex: String(num(p.capex)),
    });
    setPlanDialog(true);
  }
  function openNewDriver() {
    setDriverForm(EMPTY_DRIVER);
    setDriverDialog(true);
  }
  function openEditDriver(d: BudgetProjectionDriver) {
    setDriverForm({
      id: d.id,
      label: d.label,
      productId: d.productId ?? '',
      volume: String(d.volume),
      avgPrice: String(d.avgPrice),
      unitCost: String(d.unitCost),
    });
    setDriverDialog(true);
  }
  async function confirmDeletePlan(p: BudgetPlanRow) {
    if (await confirm({ title: 'Remover plano?', description: `"${p.name}" (${p.year}) e seus drivers serão removidos.` })) {
      deletePlan.mutate(p.id);
    }
  }
  async function confirmDeleteDriver(d: BudgetProjectionDriver) {
    if (d.id && (await confirm({ title: 'Remover driver?', description: `"${d.label}" será removido do plano.` }))) {
      deleteDriver.mutate(d.id);
    }
  }

  const planOptions = (plans.data ?? []).map((p) => ({ value: p.id, label: `${p.name} — ${p.year}` }));
  const selectedPlan = (plans.data ?? []).find((p) => p.id === planId) ?? null;

  const driverColumns: Column<BudgetProjectionDriver>[] = [
    { key: 'label', header: 'Driver' },
    { key: 'volume', header: 'Volume', align: 'right', cell: (r) => formatNumber(r.volume) },
    { key: 'avgPrice', header: 'Preço médio', align: 'right', cell: (r) => formatBRL(r.avgPrice) },
    { key: 'unitCost', header: 'Custo unit.', align: 'right', cell: (r) => formatBRL(r.unitCost) },
    { key: 'revenue', header: 'Receita', align: 'right', cell: (r) => formatBRL(r.revenue) },
    { key: 'grossProfit', header: 'Margem bruta', align: 'right', cell: (r) => formatBRL(r.grossProfit) },
    { key: 'mixPct', header: 'Mix', align: 'right', cell: (r) => formatPercent(r.mixPct) },
    {
      key: '_acoes',
      header: '',
      align: 'right',
      cell: (r) => (
        <span className="inline-flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => openEditDriver(r)} aria-label="Editar driver">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => confirmDeleteDriver(r)} aria-label="Remover driver">
            <Trash2 className="h-4 w-4 text-danger" />
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orçamento por direcionadores"
        description="Orçamento dirigido por premissas operacionais: Volume × Preço × Mix"
        actions={
          <Button onClick={openNewPlan}>
            <Plus className="mr-1.5 h-4 w-4" /> Novo plano
          </Button>
        }
      />

      {/* Seletor de plano */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 py-4">
          <div className="min-w-64 flex-1">
            <Field label="Plano de orçamento">
              <Combobox
                options={planOptions}
                value={planId}
                onValueChange={setPlanId}
                placeholder={plans.isLoading ? 'Carregando...' : planOptions.length ? 'Selecione um plano' : 'Nenhum plano — crie um'}
                searchPlaceholder="Buscar plano..."
                clearable
              />
            </Field>
          </div>
          {selectedPlan && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => openEditPlan(selectedPlan)}>
                <Pencil className="mr-1.5 h-4 w-4" /> Editar premissas
              </Button>
              <Button variant="ghost" onClick={() => confirmDeletePlan(selectedPlan)}>
                <Trash2 className="mr-1.5 h-4 w-4 text-danger" /> Remover
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {planId === '' ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={Target}
              title="Selecione ou crie um plano"
              description="Um plano projeta o resultado a partir de drivers (produto: volume × preço × custo) e premissas de despesa."
              action={{ label: 'Novo plano', onClick: openNewPlan }}
            />
          </CardContent>
        </Card>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="projecao">Projeção</TabsTrigger>
            <TabsTrigger value="drivers">Drivers</TabsTrigger>
            <TabsTrigger value="sensibilidade">Sensibilidade</TabsTrigger>
            <TabsTrigger value="realizado">vs Realizado</TabsTrigger>
          </TabsList>

          {/* ── Projeção ── */}
          <TabsContent value="projecao" className="space-y-6 pt-4">
            {projection.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : projection.data ? (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Resultado projetado {projection.data.year}</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Metric label="Receita" value={formatBRL(projection.data.revenue)} />
                    <Metric label="CPV" value={formatBRL(projection.data.cpv)} />
                    <Metric label="Margem bruta" value={formatBRL(projection.data.grossProfit)} />
                    <Metric label="Despesa variável" value={formatBRL(projection.data.variableExpenses)} />
                    <Metric label="Despesa fixa (ano)" value={formatBRL(projection.data.fixedExpenses)} />
                    <Metric
                      label="Resultado operacional"
                      value={formatBRL(projection.data.operatingResult)}
                      tone={projection.data.operatingResult >= 0 ? 'success' : 'danger'}
                    />
                    <Metric label="CAPEX" value={formatBRL(projection.data.capex)} />
                    <Metric
                      label="Resultado após CAPEX"
                      value={formatBRL(projection.data.resultAfterCapex)}
                      tone={projection.data.resultAfterCapex >= 0 ? 'success' : 'danger'}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Drivers</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DataTable
                      data={projection.data.drivers}
                      columns={driverColumns.filter((c) => c.key !== '_acoes')}
                      rowKey={(r) => r.id ?? r.label}
                      searchable={false}
                      pageSize={100}
                      emptyMessage="Sem drivers — adicione na aba Drivers."
                    />
                  </CardContent>
                </Card>
              </>
            ) : null}
          </TabsContent>

          {/* ── Drivers (CRUD) ── */}
          <TabsContent value="drivers" className="space-y-4 pt-4">
            <div className="flex justify-end">
              <Button onClick={openNewDriver}>
                <Plus className="mr-1.5 h-4 w-4" /> Adicionar driver
              </Button>
            </div>
            <Card>
              <CardContent className="pt-6">
                <DataTable
                  data={projection.data?.drivers ?? []}
                  columns={driverColumns}
                  rowKey={(r) => r.id ?? r.label}
                  loading={projection.isLoading}
                  searchable={false}
                  pageSize={100}
                  emptyMessage="Nenhum driver cadastrado."
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Sensibilidade ── */}
          <TabsContent value="sensibilidade" className="space-y-4 pt-4">
            {sensitivity.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : sensitivity.data ? (
              <Card>
                <CardHeader>
                  <CardTitle>Sensibilidade — ±10% volume, ±5% preço</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 sm:max-w-md">
                    <Metric label="Receita base" value={formatBRL(sensitivity.data.base.revenue)} />
                    <Metric label="Resultado op. base" value={formatBRL(sensitivity.data.base.operatingResult)} />
                  </div>
                  <DataTable
                    data={sensitivity.data.scenarios}
                    columns={[
                      { key: 'scenario', header: 'Cenário', cell: (r) => r.scenario.replace(/_/g, ' ') },
                      { key: 'revenue', header: 'Receita', align: 'right', cell: (r) => formatBRL(r.revenue) },
                      { key: 'revenueDelta', header: 'Δ Receita', align: 'right', cell: (r) => signed(r.revenueDelta) },
                      { key: 'operatingResult', header: 'Result. op.', align: 'right', cell: (r) => formatBRL(r.operatingResult) },
                      { key: 'operatingResultDelta', header: 'Δ Result.', align: 'right', cell: (r) => signed(r.operatingResultDelta) },
                    ]}
                    rowKey={(r) => r.scenario}
                    searchable={false}
                    pageSize={10}
                  />
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          {/* ── vs Realizado ── */}
          <TabsContent value="realizado" className="space-y-4 pt-4">
            {vsReal.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : vsReal.data ? (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Orçado vs Realizado {vsReal.data.year}</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Metric label="Receita orçada" value={formatBRL(vsReal.data.budgetedRevenue)} />
                    <Metric label="Receita realizada" value={formatBRL(vsReal.data.realizedRevenue)} />
                    <Metric
                      label="Variação"
                      value={formatBRL(vsReal.data.revenueVariance)}
                      tone={vsReal.data.revenueVariance >= 0 ? 'success' : 'danger'}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <DataTable
                      data={vsReal.data.drivers}
                      columns={[
                        { key: 'label', header: 'Driver' },
                        { key: 'budgetedRevenue', header: 'Rec. orçada', align: 'right', cell: (r) => formatBRL(r.budgetedRevenue) },
                        { key: 'realizedRevenue', header: 'Rec. realizada', align: 'right', cell: (r) => (r.realizedRevenue != null ? formatBRL(r.realizedRevenue) : '—') },
                        { key: 'revenueVariance', header: 'Δ Receita', align: 'right', cell: (r) => signed(r.revenueVariance) },
                      ]}
                      rowKey={(r) => r.label}
                      searchable={false}
                      pageSize={100}
                      emptyMessage="Sem drivers para comparar."
                    />
                    <p className="mt-3 text-helper text-content-muted">
                      Realizado = itens de vendas faturadas do ano por produto (drivers sem produto não têm realizado).
                    </p>
                  </CardContent>
                </Card>
              </>
            ) : null}
          </TabsContent>
        </Tabs>
      )}

      {/* ── Dialog Plano ── */}
      <FormDialog
        open={planDialog}
        onOpenChange={setPlanDialog}
        title={planEditing ? 'Editar premissas do plano' : 'Novo plano de orçamento'}
        formId="plan-form"
        loading={savePlan.isPending}
      >
        <form
          id="plan-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            savePlan.mutate(planForm);
          }}
        >
          <Field label="Nome" required>
            <Input value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} required />
          </Field>
          {!planEditing && (
            <Field label="Ano" required>
              <Input type="number" value={planForm.year} onChange={(e) => setPlanForm({ ...planForm, year: e.target.value })} required />
            </Field>
          )}
          <Field label="Despesa variável (% da receita)">
            <Input type="number" step="0.01" value={planForm.variableExpensePct} onChange={(e) => setPlanForm({ ...planForm, variableExpensePct: e.target.value })} placeholder="0" />
          </Field>
          <Field label="Despesa fixa mensal (R$)">
            <Input type="number" step="0.01" value={planForm.fixedExpenseMonthly} onChange={(e) => setPlanForm({ ...planForm, fixedExpenseMonthly: e.target.value })} placeholder="0" />
          </Field>
          <Field label="CAPEX (R$)">
            <Input type="number" step="0.01" value={planForm.capex} onChange={(e) => setPlanForm({ ...planForm, capex: e.target.value })} placeholder="0" />
          </Field>
          {savePlan.isError && <p className="text-caption text-danger">{apiMessage(savePlan.error)}</p>}
        </form>
      </FormDialog>

      {/* ── Dialog Driver ── */}
      <FormDialog
        open={driverDialog}
        onOpenChange={setDriverDialog}
        title={driverForm.id ? 'Editar driver' : 'Adicionar driver'}
        formId="driver-form"
        loading={saveDriver.isPending}
      >
        <form
          id="driver-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveDriver.mutate(driverForm);
          }}
        >
          <Field label="Rótulo" required>
            <Input value={driverForm.label} onChange={(e) => setDriverForm({ ...driverForm, label: e.target.value })} required placeholder="Ex.: Reboque Basculante" />
          </Field>
          <Field label="Produto (opcional — habilita comparativo realizado)">
            <Combobox
              options={productOptions}
              value={driverForm.productId}
              onValueChange={(v) => setDriverForm({ ...driverForm, productId: v })}
              placeholder="Sem produto (agregado)"
              searchPlaceholder="Buscar produto..."
              clearable
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Volume (ano)">
              <Input type="number" step="0.01" value={driverForm.volume} onChange={(e) => setDriverForm({ ...driverForm, volume: e.target.value })} placeholder="0" />
            </Field>
            <Field label="Preço médio">
              <Input type="number" step="0.01" value={driverForm.avgPrice} onChange={(e) => setDriverForm({ ...driverForm, avgPrice: e.target.value })} placeholder="0" />
            </Field>
            <Field label="Custo unit.">
              <Input type="number" step="0.01" value={driverForm.unitCost} onChange={(e) => setDriverForm({ ...driverForm, unitCost: e.target.value })} placeholder="0" />
            </Field>
          </div>
          {saveDriver.isError && <p className="text-caption text-danger">{apiMessage(saveDriver.error)}</p>}
        </form>
      </FormDialog>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'danger' }) {
  const toneClass = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-content';
  return (
    <div className="space-y-1">
      <p className="text-caption text-content-muted">{label}</p>
      <p className={cn('text-subtitle font-medium', toneClass)}>{value}</p>
    </div>
  );
}
