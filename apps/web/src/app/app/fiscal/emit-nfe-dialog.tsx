'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileUp, Info } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type { SalesOrder } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { salesOrderTotal } from '../sales/sales-status';
import { formatBRL } from '@/lib/format';

/**
 * Botão "Emitir NF-e" + dialog. O backend NÃO tem endpoint dedicado
 * POST /fiscal/emit/:salesOrderId; a emissão acontece ao FATURAR a OV
 * (PATCH /sales/:id/invoice), que só é válida em READY_TO_INVOICE.
 * Após disparar, faz polling em /fiscal por até ~30s para mostrar o desfecho.
 */
export function EmitNfeDialog() {
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [salesOrderId, setSalesOrderId] = useState('');
  const [polling, setPolling] = useState(false);

  const { data: orders = [] } = useList<SalesOrder>('/sales');
  // Apenas OVs prontas para faturar podem emitir NF-e.
  const ready = orders.filter((o) => o.status === 'READY_TO_INVOICE');

  const emit = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/sales/${id}/invoice`, {}),
  });

  async function pollFiscal(): Promise<void> {
    setPolling(true);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      await qc.invalidateQueries({ queryKey: ['/fiscal'] });
      try {
        const { data } = await apiClient.get<any[]>('/fiscal', { params: { salesOrderId } });
        const doc = Array.isArray(data) ? data.find((d) => d.salesOrderId === salesOrderId) : null;
        if (doc && ['AUTHORIZED', 'REJECTED', 'ERROR'].includes(doc.status)) {
          setPolling(false);
          if (doc.status === 'AUTHORIZED') toast.success('NF-e autorizada!');
          else toast.error(`NF-e ${doc.status === 'REJECTED' ? 'rejeitada' : 'com erro'}`);
          return;
        }
      } catch {
        /* continua tentando */
      }
    }
    setPolling(false);
    toast.success('Emissão em processamento — acompanhe na lista.');
  }

  function submit() {
    if (!salesOrderId) return toast.error('Selecione a ordem de venda');
    emit.mutate(salesOrderId, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['/sales'] });
        qc.invalidateQueries({ queryKey: ['/fiscal'] });
        toast.success('Faturamento disparado — emitindo NF-e...');
        setOpen(false);
        void pollFiscal();
      },
      onError: () => toast.error('Não foi possível faturar/emitir'),
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} loading={polling}>
        <FileUp size={16} />
        Emitir NF-e
      </Button>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Emitir NF-e"
        description="Fatura uma ordem de venda pronta e emite a NF-e."
        formId="emit-form"
        submitLabel="Faturar e emitir"
        loading={emit.isPending}
      >
        <form id="emit-form" onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4 py-1">
          <div>
            <Label required>Ordem de venda (pronta para faturar)</Label>
            <Select value={salesOrderId} onChange={(e) => setSalesOrderId(e.target.value)}>
              <option value="">— Selecione —</option>
              {ready.map((o) => (
                <option key={o.id} value={o.id}>
                  OV #{o.id.slice(-6).toUpperCase()} — {o.customer?.name ?? 'sem cliente'} ({formatBRL(salesOrderTotal(o))})
                </option>
              ))}
            </Select>
            {ready.length === 0 && (
              <p className="mt-1 text-xs text-warning">
                Nenhuma OV no status "Pronta p/ faturar" no momento.
              </p>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-secondary px-3 py-2 text-xs text-content-muted">
            <Info size={14} className="mt-0.5 shrink-0" />
            <span>
              A emissão é feita ao <strong>faturar a OV</strong> (o backend não tem endpoint
              dedicado de emissão). Após confirmar, acompanhamos o status por ~30s; o resultado
              também aparece na lista de documentos.
            </span>
          </div>
        </form>
      </FormDialog>
    </>
  );
}
