'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, RotateCcw, Ban, FileEdit, Copy, FileDown, FileText, FileStack, Undo2, Link2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useDetail } from '@/hooks/use-resource';
import type { FiscalDocument, SalesOrderStatus } from '@/types/api';
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
import { Can } from '@/components/can';
import { formatBRL, formatDateTime } from '@/lib/format';
import { erroDeAcao } from '@/lib/feedback';
import { FISCAL_STATUS, FISCAL_TYPE_LABEL, FISCAL_FINALIDADE_LABEL, TIPO_NOTA_DEBITO_LABEL, TIPO_NOTA_CREDITO_LABEL } from '../fiscal-status';
import { AdjustmentNoteDialog } from '../adjustment-note-dialog';

const RESOURCE = '/fiscal';

// findOne inclui salesOrder.items (com product) — usados como itens da nota.
interface DocWithOrder extends FiscalDocument {
  salesOrder?: {
    id: string;
    status?: SalesOrderStatus;
    customer?: { id: string; name: string } | null;
    items?: { id: string; quantity: string; unitPrice: string; product?: { id: string; sku: string; name: string; ncm?: string | null } | null }[];
  } | null;
}

// #758 — rótulo do motivo (tipoNotaDebito/tipoNotaCredito) por finalidade
function motivoLabel(doc: Pick<FiscalDocument, 'finalidade' | 'tipoNotaDebito' | 'tipoNotaCredito'>): string | null {
  if (doc.finalidade === 'NOTA_DEBITO' && doc.tipoNotaDebito) return TIPO_NOTA_DEBITO_LABEL[doc.tipoNotaDebito] ?? doc.tipoNotaDebito;
  if (doc.finalidade === 'NOTA_CREDITO' && doc.tipoNotaCredito) return TIPO_NOTA_CREDITO_LABEL[doc.tipoNotaCredito] ?? doc.tipoNotaCredito;
  return null;
}

export default function FiscalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const { data: doc, isLoading } = useDetail<DocWithOrder>(RESOURCE, id);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const [cceOpen, setCceOpen] = useState(false);
  const [correcao, setCorrecao] = useState('');
  // #758 — wizard de nota de ajuste (débito/crédito IBS/CBS)
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  // #747 — devolução: motivo vai nas informações complementares da NF-e de devolução
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnMotivo, setReturnMotivo] = useState('');

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
  const returnNote = useMutation({
    mutationFn: (motivo: string) => apiClient.post(`${RESOURCE}/${id}/return-note`, { motivo: motivo || undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [RESOURCE] }),
  });

  function doRetry() {
    confirm({ title: 'Reprocessar documento?', confirmLabel: 'Reprocessar' }).then(
      (ok) =>
        ok &&
        retry.mutate(undefined, {
          onSuccess: () => toast.success('Documento reenviado para processamento'),
          onError: (e: unknown) => toast.error(erroDeAcao('reprocessar o documento', e)),
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
      onError: (e: unknown) => toast.error(erroDeAcao('cancelar o documento', e)),
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
      onError: (e: unknown) => toast.error(erroDeAcao('emitir a carta de correção', e)),
    });
  }
  function submitReturn() {
    returnNote.mutate(returnMotivo, {
      onSuccess: () => {
        toast.success('NF-e de devolução em processamento');
        setReturnOpen(false);
        setReturnMotivo('');
      },
      onError: (err: any) => toast.error(erroDeAcao('emitir a NF-e de devolução', err)),
    });
  }

  if (isLoading || !doc) {
    return (
      <div>
        <PageHeader title="Documento fiscal" />
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
  // #758 — ajuste/devolução só fazem sentido sobre a NF-e de venda original autorizada
  const isAdjustableOriginal = doc.type === 'NFE' && doc.status === 'AUTHORIZED' && doc.finalidade === 'NORMAL';
  const canReturnNote = isAdjustableOriginal && doc.salesOrder?.status === 'RETURNED';

  // #482 — baixa o XML armazenado no banco com o nome padrão <chave>-nfe.xml
  function downloadXml() {
    if (!doc?.xml) return;
    const blob = new Blob([doc.xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.chave ?? doc.focusRef ?? 'nota'}-nfe.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* detail page pattern (F3.2 #317): back + metadata no header */}
      <PageHeader
        title={`${FISCAL_TYPE_LABEL[doc.type]} ${doc.focusRef ?? ''}`}
        description={doc.salesOrder?.customer?.name ?? '—'}
        backHref="/app/fiscal"
        meta={
          <>
            <Badge variant={FISCAL_STATUS[doc.status].variant}>
              {FISCAL_STATUS[doc.status].label}
            </Badge>
            {/* #758 — badge de finalidade quando ≠ NORMAL (venda comum não precisa de destaque) */}
            {doc.finalidade !== 'NORMAL' && (
              <Badge variant={FISCAL_FINALIDADE_LABEL[doc.finalidade].variant}>
                {FISCAL_FINALIDADE_LABEL[doc.finalidade].label}
              </Badge>
            )}
            <span className="text-caption text-content-muted">
              Emitido em {formatDateTime(doc.createdAt)}
            </span>
          </>
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
                  <p className="text-xs uppercase tracking-wide text-content-muted">Pedido vinculado</p>
                  <Link href={`/app/sales/${doc.salesOrderId}`} className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 hover:underline">
                    <ExternalLink size={13} /> Ver pedido
                  </Link>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {/* #482 — download do XML autorizado e do DANFE (caminho da Focus) */}
              {doc.xml && (
                <Button variant="secondary" onClick={downloadXml}>
                  <FileDown size={16} /> XML
                </Button>
              )}
              {doc.danfeUrl && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    window.open(
                      doc.danfeUrl!.startsWith('http')
                        ? doc.danfeUrl!
                        : `https://api.focusnfe.com.br${doc.danfeUrl}`,
                      '_blank',
                    )
                  }
                >
                  <FileText size={16} /> DANFE
                </Button>
              )}
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
              {/* #758 — Nota de Débito/Crédito IBS/CBS (Ajuste SINIEF 49/2025) */}
              {isAdjustableOriginal && (
                <Can anyOf={['fiscal.nfe.debit-note', 'fiscal.nfe.credit-note']}>
                  <Button variant="secondary" onClick={() => setAdjustmentOpen(true)}>
                    <FileStack size={16} /> Nota de ajuste
                  </Button>
                </Can>
              )}
              {/* #747 — NF-e de devolução (exige OV RETURNED) */}
              {canReturnNote && (
                <Can permission="fiscal.nfe.return-note">
                  <Button variant="secondary" onClick={() => setReturnOpen(true)}>
                    <Undo2 size={16} /> Emitir NF-e de devolução
                  </Button>
                </Can>
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
            Itens exibidos a partir do pedido de venda vinculado. O download do XML ainda não está
            disponível. Em breve.
          </p>
        </CardContent>
      </Card>

      {/* #758 — vínculo bidirecional com devolução/nota de débito/crédito */}
      {(doc.referencedDocument || (doc.referencingDocuments && doc.referencingDocuments.length > 0)) && (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle className="text-base">Documentos vinculados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {doc.referencedDocument && (
              <Link
                href={`/app/fiscal/${doc.referencedDocument.id}`}
                className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:underline dark:text-brand-400"
              >
                <Link2 size={14} />
                Referência {FISCAL_TYPE_LABEL[doc.referencedDocument.type]} {doc.referencedDocument.number ?? '—'}/{doc.referencedDocument.series ?? 1}
              </Link>
            )}
            {doc.referencingDocuments && doc.referencingDocuments.length > 0 && (
              <ul className="space-y-2">
                {doc.referencingDocuments.map((ref) => (
                  <li key={ref.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2 text-sm">
                    <Badge variant={FISCAL_FINALIDADE_LABEL[ref.finalidade].variant}>
                      {FISCAL_FINALIDADE_LABEL[ref.finalidade].label}
                    </Badge>
                    <Badge variant={FISCAL_STATUS[ref.status].variant}>{FISCAL_STATUS[ref.status].label}</Badge>
                    {motivoLabel(ref) && <span className="text-content-secondary">{motivoLabel(ref)}</span>}
                    <span className="text-content-muted">{formatDateTime(ref.createdAt)}</span>
                    <Link
                      href={`/app/fiscal/${ref.id}`}
                      className="ml-auto inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400"
                    >
                      Ver documento <ExternalLink size={13} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

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

      {/* #747 — NF-e de devolução */}
      <FormDialog
        open={returnOpen}
        onOpenChange={setReturnOpen}
        title="Emitir NF-e de devolução"
        description="NF-e de entrada referenciando esta NF-e original (finalidade Devolução, CFOP 1202/2202)."
        formId="return-form"
        submitLabel="Emitir devolução"
        loading={returnNote.isPending}
      >
        <form id="return-form" onSubmit={(e) => { e.preventDefault(); submitReturn(); }} className="space-y-3 py-1">
          <div>
            <Label>Motivo (opcional)</Label>
            <Input value={returnMotivo} onChange={(e) => setReturnMotivo(e.target.value)} placeholder="Ex.: Produto com defeito de fabricação" maxLength={200} />
          </div>
        </form>
      </FormDialog>

      {/* #758 — wizard de nota de ajuste (débito/crédito IBS/CBS) — invalida [RESOURCE]
          internamente ao confirmar, o que já cobre o refetch do detalhe (prefix match) */}
      <AdjustmentNoteDialog open={adjustmentOpen} onOpenChange={setAdjustmentOpen} documentId={id} items={doc.items} />
    </div>
  );
}
