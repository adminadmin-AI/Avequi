'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { erroDeAcao } from '@/lib/feedback';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetBody, SheetFooter } from '@/components/ui/sheet';
import { formatBRL, formatCNPJ, formatDate, formatDateTime, formatNumber } from '@/lib/format';
import {
  SPM_RESOURCE,
  STATUS_META,
  KIND_LABEL,
  type PairDetail,
  type PairView,
  bomLabel,
  canActOnRow,
  eventLabel,
  pairDetailPath,
  primaryActionLabel,
  productLabel,
  sourceLabel,
} from './conciliation';

/**
 * Drawer de detalhe/auditoria do par. Secundário à fila: mostra tudo que a
 * API do PR-2 já devolve no `GET /pairs/:supplierId/:code` (métricas,
 * decisão, sugestão e a trilha `SupplierProductMapEvent`) e concentra as
 * ações menos frequentes (descartar sugestão, marcar para revisão).
 */
interface Props {
  row: PairView | null;
  canResolve: boolean;
  onOpenChange: (open: boolean) => void;
  onResolve: (row: PairView) => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-sm text-content-muted">{label}</dt>
      <dd className="text-right text-sm text-content">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-3 first:border-t-0 first:pt-0">
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-content-muted">{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

export function PairDetailSheet({ row, canResolve, onOpenChange, onResolve }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [reviewReason, setReviewReason] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);

  const path = row ? pairDetailPath(row) : null;
  const { data, isLoading, isError } = useQuery({
    queryKey: [SPM_RESOURCE, 'pair', row?.supplierId, row?.supplierProductCode],
    queryFn: async () => (await apiClient.get<PairDetail>(path!)).data,
    enabled: !!path,
  });

  const dismiss = useMutation({
    mutationFn: () => apiClient.post(`${path}/dismiss-suggestion`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: [SPM_RESOURCE] }),
  });
  const review = useMutation({
    mutationFn: (reason: string) => apiClient.post(`${path}/review`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [SPM_RESOURCE] }),
  });

  // detalhe (fresco) tem prioridade sobre a linha da lista
  const view: PairView | null = data ?? row;
  const actions = view ? canActOnRow(canResolve, view) : { resolve: false, dismiss: false, review: false };

  async function onDismiss() {
    if (!view) return;
    const ok = await confirm({
      title: 'Descartar sugestão?',
      description: 'O par volta para Pendente. A sugestão descartada fica registrada no histórico.',
      confirmLabel: 'Descartar',
      variant: 'danger',
    });
    if (!ok) return;
    dismiss.mutate(undefined, {
      onSuccess: () => toast.success('Sugestão descartada'),
      onError: (e) => toast.error(erroDeAcao('descartar a sugestão', e)),
    });
  }

  function onReview() {
    const reason = reviewReason.trim();
    if (reason.length < 3) return toast.error('Informe o motivo da revisão (mínimo 3 caracteres)');
    review.mutate(reason, {
      onSuccess: () => {
        toast.success('Marcado para revisão', 'O vínculo atual é mantido até nova decisão.');
        setReviewOpen(false);
        setReviewReason('');
      },
      onError: (e) => toast.error(erroDeAcao('marcar o item para revisão', e)),
    });
  }

  return (
    <Sheet open={!!row} onOpenChange={onOpenChange}>
      <SheetContent size="md">
        {view && (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{view.supplierProductCode}</span>
                <Badge variant={STATUS_META[view.status].variant}>{STATUS_META[view.status].label}</Badge>
              </SheetTitle>
              <SheetDescription>
                {view.supplierName ?? '—'}
                {view.supplierCnpj ? ` · ${formatCNPJ(view.supplierCnpj)}` : ''}
              </SheetDescription>
            </SheetHeader>

            <SheetBody className="space-y-4">
              {isError && <p className="text-sm text-danger">Não foi possível carregar o histórico deste item.</p>}

              <Section title="Item na nota">
                <Row label="Descrição atual">{view.lastDescription ?? '—'}</Row>
                <Row label="NCM">{view.lastNcm ?? '—'}</Row>
                <Row label="Unidade">{view.lastUnit ?? '—'}</Row>
                <Row label="Descrições distintas">{view.descriptionVariants}</Row>
              </Section>

              <Section title="Compras (notas autorizadas)">
                <Row label="Notas">{view.documentCount}</Row>
                <Row label="Linhas">{view.itemCount}</Row>
                <Row label="Quantidade">{formatNumber(view.totalQuantity)}</Row>
                <Row label="Valor acumulado">
                  <span className="tabular-nums">{formatBRL(view.totalValue)}</span>
                </Row>
                <Row label="Última compra">{view.lastPurchaseAt ? formatDate(view.lastPurchaseAt) : '—'}</Row>
                <Row label="Último preço unitário">
                  <span className="tabular-nums">{view.lastUnitPrice != null ? formatBRL(view.lastUnitPrice) : '—'}</span>
                </Row>
              </Section>

              <Section title="Decisão">
                <Row label="Impacto em BOM">
                  {bomLabel(view.bomRelevance) ? (
                    <Badge variant={view.priorityTier === 0 ? 'danger' : 'neutral'}>
                      {bomLabel(view.bomRelevance)}
                      {view.bomRelevance?.via === 'SUGGESTED' ? ' (pela sugestão)' : ''}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </Row>
                <Row label="Confirmado">
                  {view.canonical
                    ? view.canonical.kind === 'PRODUCT'
                      ? productLabel(view.canonical.productSku, view.canonical.productName)
                      : KIND_LABEL[view.canonical.kind]
                    : '—'}
                </Row>
                {view.canonical?.confirmedAt && <Row label="Confirmado em">{formatDateTime(view.canonical.confirmedAt)}</Row>}
                <Row label="Sugestão">
                  {view.suggestion
                    ? view.suggestion.productId
                      ? productLabel(view.suggestion.productSku, view.suggestion.productName)
                      : view.suggestion.kind
                        ? KIND_LABEL[view.suggestion.kind]
                        : '—'
                    : '—'}
                </Row>
                {sourceLabel(view.suggestion?.source) && <Row label="Origem da sugestão">{sourceLabel(view.suggestion?.source)}</Row>}
                {view.reviewReason && <Row label="Motivo da revisão">{view.reviewReason}</Row>}
                {view.notes && <Row label="Observações">{view.notes}</Row>}
              </Section>

              <Section title="Histórico">
                {isLoading && (
                  <div className="py-2">
                    <Spinner size="sm" />
                  </div>
                )}
                {!isLoading && (data?.events?.length ?? 0) === 0 && (
                  <p className="py-1 text-sm text-content-muted">Nenhuma decisão registrada ainda.</p>
                )}
                {data?.events?.map((ev) => (
                  <div key={ev.id} className="py-1.5">
                    <p className="text-sm text-content">
                      {eventLabel(ev.action)}
                      {ev.fromStatus && ev.toStatus && ev.fromStatus !== ev.toStatus && (
                        <span className="text-content-muted">
                          {' '}
                          · {STATUS_META[ev.fromStatus as keyof typeof STATUS_META]?.label ?? ev.fromStatus} →{' '}
                          {STATUS_META[ev.toStatus as keyof typeof STATUS_META]?.label ?? ev.toStatus}
                        </span>
                      )}
                    </p>
                    {ev.reason && <p className="text-xs text-content-muted">{ev.reason}</p>}
                    <p className="text-xs text-content-muted">{formatDateTime(ev.createdAt)}</p>
                  </div>
                ))}
              </Section>

              {reviewOpen && (
                <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
                  <Label required>Motivo da revisão</Label>
                  <Textarea value={reviewReason} onChange={(e) => setReviewReason(e.target.value.slice(0, 500))} rows={2} />
                  <div className="mt-2 flex justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setReviewOpen(false)}>
                      Cancelar
                    </Button>
                    <Button type="button" size="sm" loading={review.isPending} onClick={onReview}>
                      Marcar para revisão
                    </Button>
                  </div>
                </div>
              )}
            </SheetBody>

            {(actions.resolve || actions.dismiss || actions.review) && (
              <SheetFooter className="flex flex-wrap justify-end gap-2">
                {actions.dismiss && (
                  <Button type="button" variant="outline" size="sm" loading={dismiss.isPending} onClick={onDismiss}>
                    Descartar sugestão
                  </Button>
                )}
                {actions.review && !reviewOpen && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setReviewOpen(true)}>
                    Marcar para revisão
                  </Button>
                )}
                {actions.resolve && (
                  <Button type="button" size="sm" onClick={() => onResolve(view)}>
                    {primaryActionLabel(view)}
                  </Button>
                )}
              </SheetFooter>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
