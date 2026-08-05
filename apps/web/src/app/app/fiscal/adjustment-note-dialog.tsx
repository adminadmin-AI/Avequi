'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { FiscalDocumentItem } from '@/types/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Stepper, type Step } from '@/components/ui/stepper';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { formatBRL, formatPercent } from '@/lib/format';
import { erroDeAcao } from '@/lib/feedback';
import { TIPO_NOTA_DEBITO_OPTIONS, TIPO_NOTA_CREDITO_OPTIONS } from './fiscal-status';

const RESOURCE = '/fiscal';

type Especie = 'DEBITO' | 'CREDITO';
type Modo = 'FULL' | 'TOTAL' | 'ITEMS' | 'AMOUNT';

const STEPS: Step[] = [
  { id: 'especie', label: 'Espécie' },
  { id: 'valor', label: 'Valor' },
  { id: 'justificativa', label: 'Justificativa' },
  { id: 'revisao', label: 'Revisão' },
];

// #757 — modos de valor permitidos por espécie (crédito aceita estorno
// integral/redução total; débito só valor avulso ou por item — mesma regra
// dos DTOs DebitNoteFiscalDto/CreditNoteFiscalDto do backend)
const MODO_OPTIONS: Record<Especie, { value: Modo; label: string }[]> = {
  CREDITO: [
    { value: 'FULL', label: 'Estorno integral' },
    { value: 'TOTAL', label: 'Redução total (R$)' },
    { value: 'ITEMS', label: 'Por item' },
    { value: 'AMOUNT', label: 'Valor avulso' },
  ],
  DEBITO: [
    { value: 'AMOUNT', label: 'Valor avulso' },
    { value: 'ITEMS', label: 'Por item' },
  ],
};

interface PreviewItem {
  sku: string;
  name: string;
  ncm: string | null;
  base: number;
  cClassTrib: string;
  cstCbs: string;
  cbsAliquota: number;
  cbsValor: number;
  ibsUfAliquota: number;
  ibsUfValor: number;
  ibsMunAliquota: number;
  ibsMunValor: number;
}

interface PreviewResult {
  ok: boolean;
  items: PreviewItem[];
  totalBase: number;
  vCBS: number;
  vIBS: number;
}

interface AdjustmentNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  items?: FiscalDocumentItem[];
  onSuccess?: () => void;
}

/**
 * #758 — Wizard de Nota de Débito/Crédito IBS/CBS (Reforma Tributária, Ajuste
 * SINIEF 49/2025). 4 passos num único Dialog: espécie+motivo → valor →
 * justificativa → revisão (preview do motor #755 + confirmação).
 */
export function AdjustmentNoteDialog({
  open,
  onOpenChange,
  documentId,
  items,
  onSuccess,
}: AdjustmentNoteDialogProps) {
  const toast = useToast();
  const qc = useQueryClient();

  const [step, setStep] = useState(0);
  const [especie, setEspecie] = useState<Especie>('DEBITO');
  const [tipo, setTipo] = useState('');
  const [modo, setModo] = useState<Modo>(MODO_OPTIONS.DEBITO[0].value);
  const [totalDelta, setTotalDelta] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [itemDeltas, setItemDeltas] = useState<Record<string, string>>({});
  const [justificativa, setJustificativa] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  // "Por item" só lista itens com grupo IBS/CBS persistido (mesmo filtro do motor #755)
  const eligibleItems = (items ?? []).filter((it) => it.taxes?.[0]?.cClassTrib);

  function reset() {
    setStep(0);
    setEspecie('DEBITO');
    setTipo('');
    setModo(MODO_OPTIONS.DEBITO[0].value);
    setTotalDelta('');
    setAmount('');
    setDescription('');
    setItemDeltas({});
    setJustificativa('');
    setPreview(null);
  }

  function specBody(): Record<string, unknown> {
    switch (modo) {
      case 'FULL':
        return { full: true };
      case 'TOTAL':
        return { totalDelta: Number(totalDelta) };
      case 'AMOUNT':
        return { amount: Number(amount), description: description.trim() || undefined };
      case 'ITEMS':
        return {
          itemDeltas: Object.entries(itemDeltas)
            .filter(([, v]) => Number(v) > 0)
            .map(([fiscalDocumentItemId, v]) => ({ fiscalDocumentItemId, baseDelta: Number(v) })),
        };
      default:
        return {};
    }
  }

  const previewMutation = useMutation({
    mutationFn: () => apiClient.post<PreviewResult>(`${RESOURCE}/${documentId}/adjustment-preview`, specBody()),
    onSuccess: (res) => setPreview(res.data),
    onError: () => setPreview(null),
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      apiClient.post(`${RESOURCE}/${documentId}/${especie === 'DEBITO' ? 'debit-note' : 'credit-note'}`, {
        tipo,
        ...specBody(),
        justificativa: justificativa.trim() || undefined,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: [RESOURCE] });
      const message =
        (res.data as { message?: string } | undefined)?.message ??
        (especie === 'DEBITO' ? 'Nota de débito em processamento' : 'Nota de crédito em processamento');
      toast.success(message);
      handleClose();
      onSuccess?.();
    },
    onError: (err: any) =>
      toast.error(erroDeAcao(`emitir a nota de ${especie === 'DEBITO' ? 'débito' : 'crédito'}`, err)),
  });

  function handleClose() {
    reset();
    onOpenChange(false);
  }

  function canAdvance(): boolean {
    if (step === 0) return !!tipo;
    if (step === 1) {
      if (modo === 'TOTAL') return Number(totalDelta) > 0;
      if (modo === 'AMOUNT') return Number(amount) > 0;
      if (modo === 'ITEMS') return Object.values(itemDeltas).some((v) => Number(v) > 0);
      return true; // FULL
    }
    return true;
  }

  function next() {
    if (!canAdvance()) return;
    const nextStep = step + 1;
    setStep(nextStep);
    if (nextStep === 3) {
      setPreview(null);
      previewMutation.mutate();
    }
  }

  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  const motivoOptions = especie === 'DEBITO' ? TIPO_NOTA_DEBITO_OPTIONS : TIPO_NOTA_CREDITO_OPTIONS;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Nota de ajuste (IBS/CBS)</DialogTitle>
          <DialogDescription>
            Nota de débito ou crédito referenciando esta NF-e: Reforma Tributária (Ajuste SINIEF 49/2025).
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <Stepper steps={STEPS} current={step} onStepClick={(i) => i < step && setStep(i)} className="mb-6" />

          {step === 0 && (
            <div className="space-y-4">
              <div>
                <Label required>Espécie</Label>
                <SegmentedControl
                  aria-label="Espécie da nota"
                  value={especie}
                  onValueChange={(v) => {
                    const next = v as Especie;
                    setEspecie(next);
                    setTipo('');
                    setModo(MODO_OPTIONS[next][0].value);
                  }}
                  options={[
                    { value: 'DEBITO', label: 'Débito' },
                    { value: 'CREDITO', label: 'Crédito' },
                  ]}
                />
              </div>
              <div>
                <Label required>Motivo</Label>
                <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                  <option value="">Selecione</option>
                  {motivoOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.value} · {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <Label required>Modo do valor</Label>
                <SegmentedControl
                  aria-label="Modo do valor"
                  value={modo}
                  onValueChange={(v) => setModo(v as Modo)}
                  options={MODO_OPTIONS[especie]}
                />
              </div>

              {modo === 'TOTAL' && (
                <div>
                  <Label required>Redução total (R$)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={totalDelta}
                    onChange={(e) => setTotalDelta(e.target.value)}
                    placeholder="1000.00"
                  />
                  <p className="mt-1 text-xs text-content-muted">
                    Rateada proporcionalmente entre os itens da NF-e original.
                  </p>
                </div>
              )}

              {modo === 'AMOUNT' && (
                <div className="space-y-3">
                  <div>
                    <Label required>Valor (R$)</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="350.00"
                    />
                  </div>
                  <div>
                    <Label>Descrição do item</Label>
                    <Input
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="MULTA E JUROS ATRASO"
                      maxLength={120}
                    />
                  </div>
                </div>
              )}

              {modo === 'ITEMS' &&
                (eligibleItems.length === 0 ? (
                  <p className="py-4 text-center text-sm text-content-muted">
                    A NF-e original não tem itens com IBS/CBS gravados. Use outro modo.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-xs uppercase tracking-wide text-content-muted">
                        <th className="py-2 text-left font-medium">Item</th>
                        <th className="py-2 text-right font-medium">Base IBS/CBS</th>
                        <th className="py-2 text-right font-medium">Delta (R$)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eligibleItems.map((it) => (
                        <tr key={it.id} className="border-b border-line">
                          <td className="py-2">
                            <p className="text-content">{it.productName}</p>
                            <p className="font-mono text-xs text-content-muted">{it.productCode}</p>
                          </td>
                          <td className="py-2 text-right tabular-nums">{formatBRL(it.taxes?.[0]?.baseCbs)}</td>
                          <td className="py-2 text-right">
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              className="ml-auto w-32 text-right"
                              value={itemDeltas[it.id] ?? ''}
                              onChange={(e) => setItemDeltas((prev) => ({ ...prev, [it.id]: e.target.value }))}
                              placeholder="0,00"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}

              {modo === 'FULL' && (
                <p className="text-sm text-content-secondary">
                  Estorna a base IBS/CBS integral de todos os itens da NF-e original.
                </p>
              )}
            </div>
          )}

          {step === 2 && (
            <div>
              <Label>Justificativa (opcional, máx. 200 caracteres)</Label>
              <Textarea
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value.slice(0, 200))}
                placeholder="Detalhes adicionais para as informações complementares da nota"
                maxLength={200}
              />
              <p className="mt-1 text-right text-xs text-content-muted">{justificativa.length}/200</p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              {previewMutation.isPending && (
                <div className="flex justify-center py-10">
                  <Spinner size="lg" />
                </div>
              )}
              {previewMutation.isError && (
                <Alert
                  variant="danger"
                  title="Não foi possível calcular o preview"
                  description={
                    (previewMutation.error as any)?.response?.data?.message ??
                    'Tente ajustar o valor informado no passo anterior.'
                  }
                  action={
                    <Button size="sm" variant="secondary" onClick={() => previewMutation.mutate()}>
                      Tentar novamente
                    </Button>
                  }
                />
              )}
              {preview && (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-xs uppercase tracking-wide text-content-muted">
                        <th className="py-2 text-left font-medium">Item</th>
                        <th className="py-2 text-right font-medium">Base</th>
                        <th className="py-2 text-right font-medium">CBS</th>
                        <th className="py-2 text-right font-medium">IBS UF</th>
                        <th className="py-2 text-right font-medium">IBS Mun</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.items.map((it, i) => (
                        <tr key={i} className="border-b border-line">
                          <td className="py-2">
                            <p className="text-content">{it.name}</p>
                            <p className="font-mono text-xs text-content-muted">{it.sku}</p>
                          </td>
                          <td className="py-2 text-right tabular-nums">{formatBRL(it.base)}</td>
                          <td className="py-2 text-right tabular-nums">
                            {formatBRL(it.cbsValor)}
                            <span className="ml-1 text-xs text-content-muted">({formatPercent(it.cbsAliquota)})</span>
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {formatBRL(it.ibsUfValor)}
                            <span className="ml-1 text-xs text-content-muted">({formatPercent(it.ibsUfAliquota)})</span>
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {formatBRL(it.ibsMunValor)}
                            <span className="ml-1 text-xs text-content-muted">({formatPercent(it.ibsMunAliquota)})</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 rounded-lg bg-surface-secondary px-4 py-3 text-sm">
                    <span>
                      Base total: <strong className="tabular-nums">{formatBRL(preview.totalBase)}</strong>
                    </span>
                    <span>
                      vCBS: <strong className="tabular-nums">{formatBRL(preview.vCBS)}</strong>
                    </span>
                    <span>
                      vIBS: <strong className="tabular-nums">{formatBRL(preview.vIBS)}</strong>
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={handleClose} disabled={submitMutation.isPending}>
            Cancelar
          </Button>
          {step > 0 && (
            <Button type="button" variant="secondary" onClick={back} disabled={submitMutation.isPending}>
              Voltar
            </Button>
          )}
          {step < 3 ? (
            <Button type="button" onClick={next} disabled={!canAdvance()}>
              Próximo
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => submitMutation.mutate()}
              loading={submitMutation.isPending}
              disabled={!preview || previewMutation.isPending}
            >
              Confirmar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
