'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { FormDialog } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { erroDeAcao } from '@/lib/feedback';

const RESOURCE = '/fiscal';

/**
 * #758 (extra) — Inutilização de faixa de numeração de NF-e.
 * POST /fiscal/void-range — gated por fiscal.nfe.void-range no botão que abre este dialog.
 */
export function VoidRangeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const toast = useToast();
  const qc = useQueryClient();

  const [serie, setSerie] = useState('1');
  const [numberStart, setNumberStart] = useState('');
  const [numberEnd, setNumberEnd] = useState('');
  const [justificativa, setJustificativa] = useState('');

  const voidRange = useMutation({
    mutationFn: () =>
      apiClient.post(`${RESOURCE}/void-range`, {
        serie,
        numberStart: Number(numberStart),
        numberEnd: Number(numberEnd),
        justificativa,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: [RESOURCE] });
      const protocol = (res.data as { protocol?: string } | undefined)?.protocol;
      toast.success(protocol ? `Numeração inutilizada (protocolo ${protocol})` : 'Numeração inutilizada');
      reset();
      onOpenChange(false);
    },
    onError: (err: any) => toast.error(erroDeAcao('inutilizar a numeração', err)),
  });

  function reset() {
    setSerie('1');
    setNumberStart('');
    setNumberEnd('');
    setJustificativa('');
  }

  function submit() {
    if (!serie.trim()) return toast.error('Informe a série');
    const start = Number(numberStart);
    const end = Number(numberEnd);
    if (!start || start < 1) return toast.error('Número inicial inválido');
    if (!end || end < start) return toast.error('Número final deve ser >= ao número inicial');
    if (justificativa.trim().length < 15) return toast.error('Justificativa deve ter ao menos 15 caracteres');
    voidRange.mutate();
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title="Inutilizar numeração"
      description="Inutiliza uma faixa de números de NF-e não utilizada na SEFAZ (ex.: gap por erro de numeração)."
      formId="void-range-form"
      submitLabel="Inutilizar"
      loading={voidRange.isPending}
    >
      <form id="void-range-form" onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3 py-1">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label required>Série</Label>
            <Input value={serie} onChange={(e) => setSerie(e.target.value)} placeholder="1" />
          </div>
          <div>
            <Label required>Número inicial</Label>
            <Input type="number" min={1} value={numberStart} onChange={(e) => setNumberStart(e.target.value)} placeholder="101" />
          </div>
          <div>
            <Label required>Número final</Label>
            <Input type="number" min={1} value={numberEnd} onChange={(e) => setNumberEnd(e.target.value)} placeholder="104" />
          </div>
        </div>
        <div>
          <Label required>Justificativa (mín. 15 caracteres)</Label>
          <Textarea
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            placeholder="Ex.: erro de numeração no sistema (gap entre notas 100 e 105)"
          />
        </div>
      </form>
    </FormDialog>
  );
}
