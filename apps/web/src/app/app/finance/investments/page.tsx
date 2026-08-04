'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import { Plus, Pencil, Trash2, Check, X, Coins } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type {
  InvestmentProject,
  InvestmentListItem,
  InvestmentComparison,
  InvestmentStatus,
  InvestmentCashflow,
  ApiError,
} from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Combobox, MultiCombobox } from '@/components/ui/combobox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { FormDialog } from '@/components/ui/form-dialog';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatBRL, formatPercent, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { chartTooltipProps, chartGridProps, chartTickFill } from '@/lib/chart-theme';

const C = { flow: '#94a3b8', cumulative: '#3D2CE6', discounted: '#00C2A8' };
const STATUS: Record<InvestmentStatus, { label: string; variant: BadgeVariant }> = {
  DRAFT: { label: 'Rascunho', variant: 'neutral' },
  APPROVED: { label: 'Aprovado', variant: 'success' },
  REJECTED: { label: 'Reprovado', variant: 'danger' },
};
const num = (v: string | number) => (typeof v === 'string' ? Number(v) : v);
const apiMessage = (err: unknown) => {
  const m = (err as AxiosError<ApiError>)?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? 'Erro inesperado');
};
const payback = (v: number | null) => (v == null ? '—' : `${formatNumber(v)} períodos`);
const compact = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return `${v}`;
};

interface ProjForm { name: string; description: string; discountRatePct: string }
interface FlowForm { period: string; amount: string; label: string }

export default function InvestmentsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();

  const list = useList<InvestmentListItem>('/investments');
  const [projectId, setProjectId] = useState('');
  const [tab, setTab] = useState('analise');

  const project = useQuery<InvestmentProject>({
    queryKey: ['investment', projectId],
    queryFn: async () => (await apiClient.get<InvestmentProject>(`/investments/${projectId}`)).data,
    enabled: projectId !== '',
    retry: false,
  });

  const [compareIds, setCompareIds] = useState<string[]>([]);
  const compare = useQuery<InvestmentComparison[]>({
    queryKey: ['investment-compare', compareIds],
    queryFn: async () =>
      (await apiClient.get<InvestmentComparison[]>('/investments/compare', { params: { ids: compareIds.join(',') } })).data,
    enabled: tab === 'comparar' && compareIds.length >= 1,
    retry: false,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['investments'] });
    qc.invalidateQueries({ queryKey: ['investment', projectId] });
    qc.invalidateQueries({ queryKey: ['investment-compare'] });
  }

  const [projDialog, setProjDialog] = useState(false);
  const [projEditing, setProjEditing] = useState<InvestmentProject | InvestmentListItem | null>(null);
  const [projForm, setProjForm] = useState<ProjForm>({ name: '', description: '', discountRatePct: '' });
  const [flowDialog, setFlowDialog] = useState(false);
  const [flowForm, setFlowForm] = useState<FlowForm>({ period: '', amount: '', label: '' });

  const saveProj = useMutation({
    mutationFn: async (f: ProjForm) => {
      const body = { name: f.name, description: f.description || undefined, discountRatePct: f.discountRatePct === '' ? 0 : Number(f.discountRatePct) };
      if (projEditing) return (await apiClient.patch(`/investments/${projEditing.id}`, body)).data;
      return (await apiClient.post('/investments', body)).data as InvestmentProject;
    },
    onSuccess: (data: any) => {
      invalidate();
      setProjDialog(false);
      if (!projEditing && data?.id) setProjectId(data.id);
    },
  });
  const deleteProj = useMutation({
    mutationFn: async (id: string) => apiClient.delete(`/investments/${id}`),
    onSuccess: () => {
      setProjectId('');
      qc.invalidateQueries({ queryKey: ['investments'] });
    },
  });
  const saveFlow = useMutation({
    mutationFn: async (f: FlowForm) =>
      (await apiClient.post(`/investments/${projectId}/cashflows`, { period: Number(f.period), amount: Number(f.amount), label: f.label || undefined })).data,
    onSuccess: () => {
      invalidate();
      setFlowDialog(false);
    },
  });
  const deleteFlow = useMutation({
    mutationFn: async (cashflowId: string) => apiClient.delete(`/investments/${projectId}/cashflows/${cashflowId}`),
    onSuccess: () => invalidate(),
  });
  const decide = useMutation({
    mutationFn: async (approved: boolean) => (await apiClient.post(`/investments/${projectId}/${approved ? 'approve' : 'reject'}`, {})).data,
    onSuccess: () => invalidate(),
  });

  function openNewProj() {
    setProjEditing(null);
    setProjForm({ name: '', description: '', discountRatePct: '' });
    setProjDialog(true);
  }
  function openEditProj(p: InvestmentProject) {
    setProjEditing(p);
    setProjForm({ name: p.name, description: p.description ?? '', discountRatePct: String(num(p.discountRatePct)) });
    setProjDialog(true);
  }
  function openNewFlow() {
    setFlowForm({ period: '', amount: '', label: '' });
    setFlowDialog(true);
  }
  function openEditFlow(f: InvestmentCashflow) {
    setFlowForm({ period: String(f.period), amount: String(num(f.amount)), label: f.label ?? '' });
    setFlowDialog(true);
  }
  async function confirmDeleteProj(p: InvestmentProject) {
    if (await confirm({ title: 'Remover projeto?', description: `"${p.name}" e seus fluxos serão removidos.` })) deleteProj.mutate(p.id);
  }
  async function confirmDeleteFlow(f: InvestmentCashflow) {
    if (await confirm({ title: 'Remover fluxo?', description: `Período ${f.period} será removido.` })) deleteFlow.mutate(f.id);
  }

  const projectOptions = (list.data ?? []).map((p) => ({ value: p.id, label: `${p.name} · ${STATUS[p.status].label}` }));
  const p = project.data;

  const chartData = useMemo(
    () =>
      (p?.analysis.series ?? []).map((s) => ({
        periodo: `P${s.period}`,
        Fluxo: s.flow,
        Acumulado: s.cumulative,
        'Acum. desc.': s.discountedCumulative,
      })),
    [p],
  );

  const flowColumns: Column<InvestmentCashflow>[] = [
    { key: 'period', header: 'Período', cell: (r) => (r.period === 0 ? '0 (aporte)' : String(r.period)) },
    { key: 'label', header: 'Descrição', cell: (r) => r.label ?? '—' },
    {
      key: 'amount',
      header: 'Valor',
      align: 'right',
      cell: (r) => <span className={cn(num(r.amount) >= 0 ? 'text-success' : 'text-danger')}>{formatBRL(num(r.amount))}</span>,
    },
    {
      key: '_acoes',
      header: '',
      align: 'right',
      cell: (r) =>
        p?.status === 'DRAFT' ? (
          <span className="inline-flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => openEditFlow(r)} aria-label="Editar fluxo">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => confirmDeleteFlow(r)} aria-label="Remover fluxo">
              <Trash2 className="h-4 w-4 text-danger" />
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Análise de investimentos"
        description="VPL, TIR, payback simples e descontado — com alçada de aprovação"
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="analise">Análise</TabsTrigger>
          <TabsTrigger value="comparar">Comparar</TabsTrigger>
        </TabsList>

        {/* ── Análise ── */}
        <TabsContent value="analise" className="space-y-6 pt-4">
          <Card>
            <CardContent className="flex flex-wrap items-end gap-4 py-4">
              <div className="min-w-64 flex-1">
                <Field label="Projeto de investimento">
                  <Combobox
                    options={projectOptions}
                    value={projectId}
                    onValueChange={setProjectId}
                    placeholder={list.isLoading ? 'Carregando...' : projectOptions.length ? 'Selecione um projeto' : 'Nenhum projeto — crie um'}
                    searchPlaceholder="Buscar projeto..."
                    clearable
                  />
                </Field>
              </div>
              <Button onClick={openNewProj}>
                <Plus className="mr-1.5 h-4 w-4" /> Novo projeto
              </Button>
            </CardContent>
          </Card>

          {projectId === '' ? (
            <Card>
              <CardContent className="py-12">
                <EmptyState
                  icon={Coins}
                  title="Selecione ou crie um projeto"
                  description="Cadastre os fluxos de caixa (período 0 = aporte, seguintes = entradas/saídas) para calcular VPL, TIR e payback."
                  action={{ label: 'Novo projeto', onClick: openNewProj }}
                />
              </CardContent>
            </Card>
          ) : project.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : p ? (
            <>
              {/* Cabeçalho do projeto + ações */}
              <Card>
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2">
                    {p.name}
                    <Badge variant={STATUS[p.status].variant}>{STATUS[p.status].label}</Badge>
                  </CardTitle>
                  <div className="flex gap-2">
                    {p.status === 'DRAFT' && (
                      <>
                        <Button variant="secondary" size="sm" onClick={() => decide.mutate(true)} disabled={decide.isPending}>
                          <Check className="mr-1.5 h-4 w-4 text-success" /> Aprovar
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => decide.mutate(false)} disabled={decide.isPending}>
                          <X className="mr-1.5 h-4 w-4 text-danger" /> Reprovar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEditProj(p)}>
                          <Pencil className="mr-1.5 h-4 w-4" /> Editar
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => confirmDeleteProj(p)}>
                      <Trash2 className="mr-1.5 h-4 w-4 text-danger" /> Remover
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {p.description && <p className="text-body text-content-secondary">{p.description}</p>}
                  {decide.isError && <p className="text-caption text-danger">{apiMessage(decide.error)}</p>}
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                    <Metric label="VPL" value={formatBRL(p.analysis.npv)} tone={p.analysis.npv >= 0 ? 'success' : 'danger'} big />
                    <Metric label="TIR" value={p.analysis.irrPct != null ? formatPercent(p.analysis.irrPct) : '—'} />
                    <Metric label="Payback simples" value={payback(p.analysis.paybackSimple)} />
                    <Metric label="Payback descontado" value={payback(p.analysis.paybackDiscounted)} />
                    <Metric label="Taxa de desconto" value={formatPercent(p.analysis.discountRatePct)} />
                  </div>
                </CardContent>
              </Card>

              {/* Gráfico do fluxo acumulado */}
              <Card>
                <CardHeader>
                  <CardTitle>Fluxo de caixa acumulado</CardTitle>
                </CardHeader>
                <CardContent>
                  {chartData.length === 0 ? (
                    <p className="text-body text-content-muted">Sem fluxos cadastrados.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={320}>
                      <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                        <CartesianGrid {...chartGridProps} />
                        <XAxis dataKey="periodo" tick={{ fontSize: 12, fill: chartTickFill }} />
                        <YAxis tick={{ fontSize: 12, fill: chartTickFill }} tickFormatter={compact} width={56} />
                        <Tooltip {...chartTooltipProps} formatter={(v) => formatBRL(Number(v))} />
                        <Legend />
                        <ReferenceLine y={0} stroke={chartTickFill} />
                        <Bar dataKey="Fluxo" fill={C.flow} radius={[4, 4, 0, 0]} />
                        <Line type="monotone" dataKey="Acumulado" stroke={C.cumulative} strokeWidth={2} dot={{ r: 3 }} />
                        <Line type="monotone" dataKey="Acum. desc." stroke={C.discounted} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              {/* Fluxos de caixa (CRUD) */}
              <Card>
                <CardHeader className="flex-row items-center justify-between gap-3">
                  <CardTitle>Fluxos de caixa</CardTitle>
                  {p.status === 'DRAFT' && (
                    <Button size="sm" onClick={openNewFlow}>
                      <Plus className="mr-1.5 h-4 w-4" /> Adicionar fluxo
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  <DataTable
                    data={p.cashflows}
                    columns={flowColumns}
                    rowKey={(r) => r.id}
                    searchable={false}
                    pageSize={100}
                    emptyMessage="Nenhum fluxo — adicione o aporte inicial (período 0) e os retornos."
                  />
                  {p.status !== 'DRAFT' && (
                    <p className="mt-3 text-helper text-content-muted">
                      Projeto {STATUS[p.status].label.toLowerCase()} — fluxos bloqueados para edição.
                    </p>
                  )}
                </CardContent>
              </Card>
            </>
          ) : null}
        </TabsContent>

        {/* ── Comparar ── */}
        <TabsContent value="comparar" className="space-y-4 pt-4">
          <Card>
            <CardContent className="py-4">
              <Field label="Projetos a comparar">
                <MultiCombobox
                  options={projectOptions}
                  values={compareIds}
                  onValuesChange={setCompareIds}
                  placeholder="Selecione projetos"
                  searchPlaceholder="Buscar projeto..."
                />
              </Field>
            </CardContent>
          </Card>
          {compareIds.length === 0 ? (
            <Card>
              <CardContent className="py-10">
                <EmptyState icon={Coins} title="Escolha projetos" description="Selecione dois ou mais projetos para comparar VPL, TIR e payback lado a lado." />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <DataTable
                  data={compare.data ?? []}
                  columns={[
                    { key: 'name', header: 'Projeto' },
                    { key: 'status', header: 'Status', cell: (r) => <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge> },
                    { key: 'npv', header: 'VPL', align: 'right', cell: (r) => <span className={cn(r.npv >= 0 ? 'text-success' : 'text-danger')}>{formatBRL(r.npv)}</span> },
                    { key: 'irrPct', header: 'TIR', align: 'right', cell: (r) => (r.irrPct != null ? formatPercent(r.irrPct) : '—') },
                    { key: 'paybackSimple', header: 'Payback', align: 'right', cell: (r) => payback(r.paybackSimple) },
                    { key: 'paybackDiscounted', header: 'Payback desc.', align: 'right', cell: (r) => payback(r.paybackDiscounted) },
                  ]}
                  rowKey={(r) => r.id}
                  loading={compare.isLoading}
                  searchable={false}
                  pageSize={50}
                  emptyMessage="Sem projetos para comparar."
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialog projeto */}
      <FormDialog
        open={projDialog}
        onOpenChange={setProjDialog}
        title={projEditing ? 'Editar projeto' : 'Novo projeto de investimento'}
        formId="proj-form"
        loading={saveProj.isPending}
      >
        <form id="proj-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); saveProj.mutate(projForm); }}>
          <Field label="Nome" required>
            <Input value={projForm.name} onChange={(e) => setProjForm({ ...projForm, name: e.target.value })} required />
          </Field>
          <Field label="Descrição">
            <Input value={projForm.description} onChange={(e) => setProjForm({ ...projForm, description: e.target.value })} />
          </Field>
          <Field label="Taxa de desconto por período (% — WACC)">
            <Input type="number" step="0.01" value={projForm.discountRatePct} onChange={(e) => setProjForm({ ...projForm, discountRatePct: e.target.value })} placeholder="0" />
          </Field>
          {saveProj.isError && <p className="text-caption text-danger">{apiMessage(saveProj.error)}</p>}
        </form>
      </FormDialog>

      {/* Dialog fluxo */}
      <FormDialog
        open={flowDialog}
        onOpenChange={setFlowDialog}
        title="Fluxo de caixa"
        formId="flow-form"
        loading={saveFlow.isPending}
      >
        <form id="flow-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); saveFlow.mutate(flowForm); }}>
          <Field label="Período (0 = aporte inicial)" required>
            <Input type="number" min="0" step="1" value={flowForm.period} onChange={(e) => setFlowForm({ ...flowForm, period: e.target.value })} required />
          </Field>
          <Field label="Valor (negativo = saída/aporte, positivo = entrada)" required>
            <Input type="number" step="0.01" value={flowForm.amount} onChange={(e) => setFlowForm({ ...flowForm, amount: e.target.value })} required placeholder="Ex.: -100000" />
          </Field>
          <Field label="Descrição">
            <Input value={flowForm.label} onChange={(e) => setFlowForm({ ...flowForm, label: e.target.value })} />
          </Field>
          {saveFlow.isError && <p className="text-caption text-danger">{apiMessage(saveFlow.error)}</p>}
        </form>
      </FormDialog>
    </div>
  );
}

function Metric({ label, value, tone, big }: { label: string; value: string; tone?: 'success' | 'danger'; big?: boolean }) {
  const toneClass = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-content';
  return (
    <div className="space-y-1">
      <p className="text-caption text-content-muted">{label}</p>
      <p className={cn(big ? 'text-heading' : 'text-subtitle', 'font-medium', toneClass)}>{value}</p>
    </div>
  );
}
