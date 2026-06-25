'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { useList } from '@/hooks/use-resource';
import type { Product } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';

interface RoutingStep {
  id: string;
  stepOrder: number;
  name: string;
  workCenter?: string | null;
  setupTimeMin?: number;
  runTimeMin?: number;
  notes?: string | null;
}
interface WorkCenter {
  id: string;
  code: string;
  name: string;
  capacityHoursPerDay?: string;
  operatorsCount?: number;
  efficiencyPct?: string;
}

function Tabs({ tab, setTab }: { tab: string; setTab: (t: string) => void }) {
  const items = [
    { id: 'routing', label: 'Roteiros' },
    { id: 'work-centers', label: 'Centros de Trabalho' },
  ];
  return (
    <div className="mb-5 flex gap-1 border-b border-slate-200">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => setTab(it.id)}
          className={cn(
            'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
            tab === it.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <Label required={required}>{label}</Label>
      {children}
    </div>
  );
}

export default function RoutingPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const companyId = useAuthStore((s) => s.user?.companyId ?? '');
  const [tab, setTab] = useState('routing');

  const { data: products = [] } = useList<Product>('/products');

  // ── Roteiros ──
  const [productId, setProductId] = useState('');
  const stepsQ = useQuery({
    queryKey: ['/routing/product', productId],
    queryFn: async () => (await apiClient.get<RoutingStep[]>(`/routing/product/${productId}`)).data,
    enabled: !!productId,
  });
  const steps = (stepsQ.data ?? []).slice().sort((a, b) => a.stepOrder - b.stepOrder);

  const [stepDialog, setStepDialog] = useState(false);
  const [editStep, setEditStep] = useState<RoutingStep | null>(null);
  const [stepForm, setStepForm] = useState({ stepOrder: '', name: '', workCenter: '', setupTimeMin: '0', runTimeMin: '0', notes: '' });

  const stepCreate = useMutation({
    mutationFn: (payload: any) => apiClient.post('/routing', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/routing/product', productId] }),
  });
  const stepUpdate = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiClient.patch(`/routing/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/routing/product', productId] }),
  });
  const stepDelete = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/routing/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/routing/product', productId] }),
  });

  function openNewStep() {
    setEditStep(null);
    setStepForm({ stepOrder: String((steps.at(-1)?.stepOrder ?? 0) + 10), name: '', workCenter: '', setupTimeMin: '0', runTimeMin: '0', notes: '' });
    setStepDialog(true);
  }
  function openEditStep(s: RoutingStep) {
    setEditStep(s);
    setStepForm({
      stepOrder: String(s.stepOrder),
      name: s.name,
      workCenter: s.workCenter ?? '',
      setupTimeMin: String(s.setupTimeMin ?? 0),
      runTimeMin: String(s.runTimeMin ?? 0),
      notes: s.notes ?? '',
    });
    setStepDialog(true);
  }
  function submitStep() {
    if (!stepForm.name.trim()) return toast.error('Informe a operação');
    const payload = {
      companyId,
      productId,
      stepOrder: Number(stepForm.stepOrder) || 0,
      name: stepForm.name,
      workCenter: stepForm.workCenter || undefined,
      setupTimeMin: Number(stepForm.setupTimeMin) || 0,
      runTimeMin: Number(stepForm.runTimeMin) || 0,
      notes: stepForm.notes || undefined,
    };
    const opts = {
      onSuccess: () => {
        toast.success(editStep ? 'Operação atualizada' : 'Operação adicionada');
        setStepDialog(false);
      },
      onError: () => toast.error('Erro ao salvar operação'),
    };
    if (editStep) stepUpdate.mutate({ id: editStep.id, data: payload }, opts);
    else stepCreate.mutate(payload, opts);
  }
  async function removeStep(s: RoutingStep) {
    const ok = await confirm({ title: 'Remover operação?', description: `"${s.name}" será removida do roteiro.`, confirmLabel: 'Remover', variant: 'danger' });
    if (!ok) return;
    stepDelete.mutate(s.id, { onSuccess: () => toast.success('Operação removida'), onError: () => toast.error('Erro ao remover') });
  }

  // ── Centros de Trabalho ──
  const wcQ = useQuery({
    queryKey: ['/capacity/work-centers'],
    queryFn: async () => (await apiClient.get<WorkCenter[]>('/capacity/work-centers')).data,
  });
  const [wcDialog, setWcDialog] = useState(false);
  const [editWc, setEditWc] = useState<WorkCenter | null>(null);
  const [wcForm, setWcForm] = useState({ code: '', name: '', capacityHoursPerDay: '8', operatorsCount: '1', efficiencyPct: '85' });

  const wcCreate = useMutation({
    mutationFn: (payload: any) => apiClient.post('/capacity/work-centers', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/capacity/work-centers'] }),
  });
  const wcUpdate = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiClient.patch(`/capacity/work-centers/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/capacity/work-centers'] }),
  });
  const wcDelete = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/capacity/work-centers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/capacity/work-centers'] }),
  });

  function openNewWc() {
    setEditWc(null);
    setWcForm({ code: '', name: '', capacityHoursPerDay: '8', operatorsCount: '1', efficiencyPct: '85' });
    setWcDialog(true);
  }
  function openEditWc(w: WorkCenter) {
    setEditWc(w);
    setWcForm({
      code: w.code,
      name: w.name,
      capacityHoursPerDay: String(w.capacityHoursPerDay ?? 8),
      operatorsCount: String(w.operatorsCount ?? 1),
      efficiencyPct: String(w.efficiencyPct ?? 85),
    });
    setWcDialog(true);
  }
  function submitWc() {
    if (!wcForm.code.trim() || !wcForm.name.trim()) return toast.error('Informe código e nome');
    const payload = {
      companyId,
      code: wcForm.code.trim().toUpperCase(),
      name: wcForm.name,
      capacityHoursPerDay: Number(wcForm.capacityHoursPerDay) || 8,
      operatorsCount: Number(wcForm.operatorsCount) || 1,
      efficiencyPct: Number(wcForm.efficiencyPct) || 85,
    };
    const opts = {
      onSuccess: () => {
        toast.success(editWc ? 'Centro atualizado' : 'Centro criado');
        setWcDialog(false);
      },
      onError: () => toast.error('Erro ao salvar centro de trabalho'),
    };
    if (editWc) wcUpdate.mutate({ id: editWc.id, data: payload }, opts);
    else wcCreate.mutate(payload, opts);
  }
  async function removeWc(w: WorkCenter) {
    const ok = await confirm({ title: 'Remover centro de trabalho?', description: `"${w.name}" será removido.`, confirmLabel: 'Remover', variant: 'danger' });
    if (!ok) return;
    wcDelete.mutate(w.id, { onSuccess: () => toast.success('Centro removido'), onError: () => toast.error('Erro ao remover') });
  }

  return (
    <div>
      <PageHeader
        title="Roteiros e Centros de Trabalho"
        description="Sequência de operações de produção e capacidade dos recursos."
        actions={
          tab === 'work-centers' ? (
            <Button onClick={openNewWc}>
              <Plus size={16} />
              Novo centro
            </Button>
          ) : productId ? (
            <Button onClick={openNewStep}>
              <Plus size={16} />
              Nova operação
            </Button>
          ) : undefined
        }
      />

      <Tabs tab={tab} setTab={setTab} />

      {tab === 'routing' ? (
        <>
          <Card className="mb-5">
            <CardContent className="py-5">
              <Label>Produto</Label>
              <Select value={productId} onChange={(e) => setProductId(e.target.value)} className="max-w-md">
                <option value="">— Selecione um produto —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name}
                  </option>
                ))}
              </Select>
            </CardContent>
          </Card>

          {!productId ? (
            <p className="rounded-xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-400">
              Selecione um produto para ver seu roteiro de produção.
            </p>
          ) : stepsQ.isLoading ? (
            <div className="flex justify-center py-20">
              <Spinner size="lg" />
            </div>
          ) : (
            <Card>
              <CardContent>
                {steps.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">Nenhuma operação no roteiro.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                        <th className="py-2 text-left font-medium">Seq.</th>
                        <th className="py-2 text-left font-medium">Operação</th>
                        <th className="py-2 text-left font-medium">Centro de trabalho</th>
                        <th className="py-2 text-right font-medium">Setup (min)</th>
                        <th className="py-2 text-right font-medium">Execução (min)</th>
                        <th className="py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {steps.map((s) => (
                        <tr key={s.id} className="border-b border-slate-50">
                          <td className="py-2 font-mono text-xs">{s.stepOrder}</td>
                          <td className="py-2 text-slate-800">{s.name}</td>
                          <td className="py-2 text-slate-600">{s.workCenter || '—'}</td>
                          <td className="py-2 text-right tabular-nums">{s.setupTimeMin ?? 0}</td>
                          <td className="py-2 text-right tabular-nums">{s.runTimeMin ?? 0}</td>
                          <td className="py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => openEditStep(s)} title="Editar" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600">
                                <Pencil size={15} />
                              </button>
                              <button onClick={() => removeStep(s)} title="Remover" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-danger">
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <CardContent>
            {wcQ.isLoading ? (
              <div className="flex justify-center py-12">
                <Spinner size="lg" />
              </div>
            ) : (wcQ.data ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">Nenhum centro de trabalho cadastrado.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                    <th className="py-2 text-left font-medium">Código</th>
                    <th className="py-2 text-left font-medium">Nome</th>
                    <th className="py-2 text-right font-medium">Capacidade (h/dia)</th>
                    <th className="py-2 text-right font-medium">Operadores</th>
                    <th className="py-2 text-right font-medium">Eficiência</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {(wcQ.data ?? []).map((w) => (
                    <tr key={w.id} className="border-b border-slate-50">
                      <td className="py-2 font-mono text-xs font-medium">{w.code}</td>
                      <td className="py-2 text-slate-800">{w.name}</td>
                      <td className="py-2 text-right tabular-nums">{formatNumber(Number(w.capacityHoursPerDay ?? 0))}</td>
                      <td className="py-2 text-right tabular-nums">{w.operatorsCount ?? 0}</td>
                      <td className="py-2 text-right tabular-nums">{formatNumber(Number(w.efficiencyPct ?? 0))}%</td>
                      <td className="py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEditWc(w)} title="Editar" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600">
                            <Pencil size={15} />
                          </button>
                          <button onClick={() => removeWc(w)} title="Remover" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-danger">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dialog operação */}
      <FormDialog
        open={stepDialog}
        onOpenChange={setStepDialog}
        title={editStep ? 'Editar operação' : 'Nova operação'}
        formId="step-form"
        loading={stepCreate.isPending || stepUpdate.isPending}
      >
        <form id="step-form" onSubmit={(e) => { e.preventDefault(); submitStep(); }} className="space-y-4 py-1">
          <div className="grid grid-cols-[1fr_2fr] gap-4">
            <Field label="Sequência" required>
              <Input type="number" value={stepForm.stepOrder} onChange={(e) => setStepForm((f) => ({ ...f, stepOrder: e.target.value }))} />
            </Field>
            <Field label="Operação" required>
              <Input value={stepForm.name} onChange={(e) => setStepForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex.: Corte de chapa" />
            </Field>
          </div>
          <Field label="Centro de trabalho">
            <Input value={stepForm.workCenter} onChange={(e) => setStepForm((f) => ({ ...f, workCenter: e.target.value }))} placeholder="Ex.: CT-CORTE" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Setup (min)">
              <Input type="number" min="0" value={stepForm.setupTimeMin} onChange={(e) => setStepForm((f) => ({ ...f, setupTimeMin: e.target.value }))} />
            </Field>
            <Field label="Execução (min)">
              <Input type="number" min="0" value={stepForm.runTimeMin} onChange={(e) => setStepForm((f) => ({ ...f, runTimeMin: e.target.value }))} />
            </Field>
          </div>
          <Field label="Observações">
            <Input value={stepForm.notes} onChange={(e) => setStepForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Opcional" />
          </Field>
        </form>
      </FormDialog>

      {/* Dialog centro de trabalho */}
      <FormDialog
        open={wcDialog}
        onOpenChange={setWcDialog}
        title={editWc ? 'Editar centro de trabalho' : 'Novo centro de trabalho'}
        formId="wc-form"
        loading={wcCreate.isPending || wcUpdate.isPending}
      >
        <form id="wc-form" onSubmit={(e) => { e.preventDefault(); submitWc(); }} className="space-y-4 py-1">
          <div className="grid grid-cols-[1fr_2fr] gap-4">
            <Field label="Código" required>
              <Input value={wcForm.code} onChange={(e) => setWcForm((f) => ({ ...f, code: e.target.value }))} className="font-mono uppercase" placeholder="CT-01" />
            </Field>
            <Field label="Nome" required>
              <Input value={wcForm.name} onChange={(e) => setWcForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex.: Linha de solda" />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Capacidade (h/dia)">
              <Input type="number" min="0" step="0.5" value={wcForm.capacityHoursPerDay} onChange={(e) => setWcForm((f) => ({ ...f, capacityHoursPerDay: e.target.value }))} />
            </Field>
            <Field label="Operadores">
              <Input type="number" min="1" value={wcForm.operatorsCount} onChange={(e) => setWcForm((f) => ({ ...f, operatorsCount: e.target.value }))} />
            </Field>
            <Field label="Eficiência (%)">
              <Input type="number" min="0" max="100" value={wcForm.efficiencyPct} onChange={(e) => setWcForm((f) => ({ ...f, efficiencyPct: e.target.value }))} />
            </Field>
          </div>
        </form>
      </FormDialog>
    </div>
  );
}
