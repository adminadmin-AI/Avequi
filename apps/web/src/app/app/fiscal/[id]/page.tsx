'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, RotateCcw, Ban, FileEdit, Copy } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useDetail } from '@/hooks/use-resource';
import type { FiscalDocument } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { FormDialog } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatBRL, formatDateTime } from '@/lib/format';
import { FISCAL_STATUS, FISCAL_TYPE_LABEL } from '../fiscal-status';

const RESOURCE = '/fiscal';

// findOne inclui salesOrder.items (com product) — usados como itens da nota.
interface DocWithOrder extends FiscalDocument {
  salesOrder?: {
    id: string;
    customer?: { id: string; name: string } | null;
    items?: { id: string; quantity: string; unitPrice: string; product?: { id: string; sku: string; name: string; ncm?: string | null } | null }[];
  } | null;
}

export default function FiscalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const { data: doc, isLoading } = useDetail<DocWithOrder>(RESOURCE, id);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const [cceOpen, setCceOpen] = useState(false);
  const [correcao, setCorrecao] = useState('');

  const retry = useMutation({
    mutationFn: () => apiClient.post(`${RESOURCE}/${id}/retry`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: [RESOURCE] }),
  });
  const cancel = useMutation({
    mutationFn: (justificativa: string) => apiClient.post(`${RESOURCE}/${id}/cancel`, { justificativa }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [RESOURCE] }),
  });
  const correction = useMutation({
    mutationFn: (correcao: string) => apiClient.post(`${RESOURCE}/${id}/correction`, { correcao }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [RESOURCE] }),
  });

  function doRetry() {
    confirm({ title: 'Reprocessar documento?', confirmLabel: 'Reprocessar' }).then(
      (ok) =>
        ok &&
        retry.mutate(undefined, {
          onSuccess: () => toast.success('Documento reenviado para processamento'),
          onError: () => toast.error('Falha ao reprocessar'),
        }),
    );
  }
  function submitCancel() {
    if (justificativa.trim().length < 15) return toast.error('Justificativa deve ter ao menos 15 caracteres');
    cancel.mutate(justificativa, {
      onSuccess: () => {
        toast.success('Documento cancelado');
        setCancelOpen(false);
        setJustificativa('');
      },
      onError: () => toast.error('Falha ao cancelar'),
    });
  }
  function submitCce() {
    if (correcao.trim().length < 15) return toast.error('Correção deve ter ao menos 15 caracteres');
    correction.mutate(correcao, {
      onSuccess: () => {
        toast.success('Carta de correção emitida');
        setCceOpen(false);
        setCorrecao('');
      },
      onError: () => toast.error('Falha ao emitir CC-e'),
    });
  }

  if (isLoading || !doc) {
    return (
      <div>
        <PageHeader title="Documento Fiscal" />
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  const items = doc.salesOrder?.items ?? [];
  const canRetry = doc.status === 'REJECTED' || doc.status === 'ERROR';
  const canCancel = doc.status === 'AUTHORIZED';
  const canCce = doc.status === 'AUTHORIZED';

  return (
    <div>
      <PageHeader
        title={`${FISCAL_TYPE_LABEL[doc.type]} ${doc.focusRef ?? ''}`}
        description={doc.salesOrder?.customer?.name ?? '—'}
        actions={
          <Button variant="secondary" onClick={() => router.push('/app/fiscal')}>
            <ArrowLeft size={16} />
            Voltar
          </Button>
        }
      />

      <Card className="mb-5">
        <CardContent className="space-y-4 py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-content-muted">Status</p>
                <Badge variant={FISCAL_STATUS[doc.status].variant}>{FISCAL_STATUS[doc.status].label}</Badge>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-content-muted">Tipo</p>
                <p className="text-content">{FISCAL_TYPE_LABEL[doc.type]}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-content-muted">Emissão</p>
                <p className="text-content">{formatDateTime(doc.createdAt)}</p>
              </div>
              {doc.salesOrderId && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-content-muted">OV vinculada</p>
                  <Link href={`/app/sales/${doc.salesOrderId}`} className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 hover:underline">
                    <ExternalLink size={13} /> Ver OV
                  </Link>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {canRetry && (
                <Button onClick={doRetry} loading={retry.isPending}>
                  <RotateCcw size={16} /> Reprocessar
                </Button>
              )}
              {canCce && (
                <Button variant="secondary" onClick={() => setCceOpen(true)}>
                  <FileEdit size={16} /> Carta de correção
                </Button>
              )}
              {canCancel && (
                <Button variant="danger" onClick={() => setCancelOpen(true)}>
                  <Ban size={16} /> Cancelar NF-e
                </Button>
              )}
            </div>
          </div>

          {doc.chave && (
            <div className="border-t border-line pt-3">
              <p className="text-xs uppercase tracking-wide text-content-muted">Chave de acesso</p>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(doc.chave!);
                  toast.success('Chave copiada');
                }}
                className="mt-0.5 inline-flex items-center gap-1.5 font-mono text-sm text-content-secondary hover:text-brand-600 dark:hover:text-brand-400"
              >
                {doc.chave} <Copy size={13} />
              </button>
            </div>
          )}

          {(doc.status === 'REJECTED' || doc.status === 'ERROR') && doc.rejectionReason && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              <strong>Motivo:</strong> {doc.rejectionCode ? `[${doc.rejectionCode}] ` : ''}
              {doc.rejectionReason}
            </div>
          )}
          {doc.status === 'CANCELLED' && doc.cancellationJustification && (
            <div className="rounded-lg border border-line bg-surface-secondary px-3 py-2 text-sm text-content-secondary">
              <strong>Cancelamento:</strong> {doc.cancellationJustification}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Itens da nota</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="py-6 text-center text-sm text-content-muted">Itens não disponíveis para este documento.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-content-muted">
                  <th className="py-2 text-left font-medium">Produto</th>
                  <th className="py-2 text-left font-medium">NCM</th>
                  <th className="py-2 text-right font-medium">Qtd</th>
                  <th className="py-2 text-right font-medium">Valor unit.</th>
                  <th className="py-2 text-right font-medium">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b border-line">
                    <td className="py-2">
                      <p className="text-content">{it.product?.name ?? '—'}</p>
                      <p className="font-mono text-xs text-content-muted">{it.product?.sku}</p>
                    </td>
                    <td className="py-2 font-mono text-xs text-content-muted">{it.product?.ncm ?? '—'}</td>
                    <td className="py-2 text-right tabular-nums">{Number(it.quantity)}</td>
                    <td className="py-2 text-right tabular-nums">{formatBRL(Number(it.unitPrice))}</td>
                    <td className="py-2 text-right font-medium tabular-nums">{formatBRL(Number(it.quantity) * Number(it.unitPrice))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-content-muted">
            Itens exibidos a partir da OV vinculada. Download do XML não disponível (sem endpoint no backend).
          </p>
        </CardContent>
      </Card>

      {/* Cancelar */}
      <FormDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancelar NF-e"
        description="Cancelamento na SEFAZ (prazo de 24h após autorização)."
        formId="cancel-form"
        submitLabel="Cancelar NF-e"
        loading={cancel.isPending}
      >
        <form id="cancel-form" onSubmit={(e) => { e.preventDefault(); submitCancel(); }} className="space-y-3 py-1">
          <div>
            <Label required>Justificativa (mín. 15 caracteres)</Label>
            <Input value={justificativa} onChange={(e) => setJustificativa(e.target.value)} placeholder="Motivo do cancelamento" />
          </div>
        </form>
      </FormDialog>

      {/* CC-e */}
      <FormDialog
        open={cceOpen}
        onOpenChange={setCceOpen}
        title="Carta de Correção (CC-e)"
        description="Corrige informações da NF-e autorizada (não altera valores)."
        formId="cce-form"
        submitLabel="Emitir CC-e"
        loading={correction.isPending}
      >
        <form id="cce-form" onSubmit={(e) => { e.preventDefault(); submitCce(); }} className="space-y-3 py-1">
          <div>
            <Label required>Texto da correção (mín. 15 caracteres)</Label>
            <Input value={correcao} onChange={(e) => setCorrecao(e.target.value)} placeholder="Descreva a correção" />
          </div>
        </form>
      </FormDialog>
    </div>
  );
}
