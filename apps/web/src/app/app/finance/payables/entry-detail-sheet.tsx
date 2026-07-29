'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Copy, ExternalLink } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type { EntryHistory, FinancialCategory, FinancialEntry } from '@/types/api';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
} from '@/components/ui/sheet';
import { formatBRL, formatDate, formatDateTime, formatCpfCnpj, formatChaveNFe } from '@/lib/format';
import {
  num,
  remainingOf,
  sourceLabel,
  findCategoryName,
  paymentMethodLabel,
  actionLabel,
  changedFieldsSummary,
} from './detail';

/**
 * Painel de detalhe do título (Fase 1 do mestre-detalhe da Carteira de
 * Pagáveis): a tabela fica enxuta e TUDO sobre o título mora aqui, a um clique.
 *
 * Fase 2 (backend, coordenada): emissão, nº documento, forma de pagamento,
 * rateio de centro de custo e o histórico de eventos (AuditLog) — os blocos já
 * existem abaixo e mostram "—" até os campos virarem colunas de verdade.
 */

interface Props {
  entry: FinancialEntry | null;
  onOpenChange: (open: boolean) => void;
  /** Badge de status calculado pela tela (considera vencido "de fato"). */
  statusBadge?: React.ReactNode;
}

/** Linha rótulo→valor dos blocos do detalhe. */
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
    <section className="border-t border-line py-3 first:border-t-0">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-content-muted">
        {title}
      </h3>
      <dl>{children}</dl>
    </section>
  );
}

const DASH = <span className="text-content-muted">—</span>;

/** Valor copiável (chave PIX, código de barras…): mostra + botão 📋. */
function Copyable({ value, copied }: { value: string; copied: (v: string) => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span className="break-all font-mono text-xs">{value}</span>
      <button
        type="button"
        title="Copiar"
        onClick={() => copied(value)}
        className="shrink-0 rounded-md p-1 text-content-muted transition-colors hover:bg-neutral-100 hover:text-brand-600 dark:hover:bg-neutral-800 dark:hover:text-brand-400"
      >
        <Copy size={13} />
      </button>
    </span>
  );
}

export function EntryDetailSheet({ entry, onOpenChange, statusBadge }: Props) {
  const toast = useToast();
  // Árvore de categorias: fallback p/ resolver o nome enquanto a API em prod
  // não devolve a relação `category` (deploy da Fase 2).
  const { data: catRoots = [] } = useList<FinancialCategory>('/finance/categories');

  // Fase 2 — timeline "quem fez o quê" (só busca com o painel aberto; 404 do
  // backend antigo cai no catch do apiClient → seção degrada p/ "criado em").
  const history = useQuery({
    queryKey: ['/finance/entries', entry?.id, 'history'],
    queryFn: async () =>
      (await apiClient.get<EntryHistory>(`/finance/entries/${entry!.id}/history`)).data,
    enabled: !!entry,
    retry: false,
  });

  function copy(v: string) {
    navigator.clipboard?.writeText(v);
    toast.success('Copiado');
  }

  if (!entry) return null;

  const supplier = entry.supplier ?? entry.purchaseOrder?.supplier ?? null;
  const catName = entry.category?.name ?? findCategoryName(catRoots, entry.categoryId);
  const splits = entry.costCenterSplits ?? [];
  const remaining = remainingOf(entry);
  const paid = num(entry.paidAmount);

  return (
    <Sheet open={!!entry} onOpenChange={onOpenChange}>
      <SheetContent size="lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="truncate">{supplier?.name ?? 'Título sem fornecedor'}</span>
            {statusBadge}
          </SheetTitle>
          {entry.description && <SheetDescription>{entry.description}</SheetDescription>}
        </SheetHeader>

        <SheetBody>
          <Section title="Valores">
            <Row label="Valor">
              <span className="font-medium tabular-nums">{formatBRL(num(entry.amount))}</span>
            </Row>
            <Row label="Pago">
              <span className="tabular-nums">{paid > 0 ? formatBRL(paid) : DASH}</span>
            </Row>
            {entry.status !== 'PAID' && entry.status !== 'CANCELLED' && (
              <Row label="Em aberto">
                <span className="font-medium tabular-nums">{formatBRL(remaining)}</span>
              </Row>
            )}
          </Section>

          <Section title="Datas">
            <Row label="Emissão">{entry.issueDate ? formatDate(entry.issueDate) : DASH}</Row>
            <Row label="Vencimento">{formatDate(entry.dueDate)}</Row>
            <Row label="Previsão de pagamento">
              {formatDate(entry.expectedPaymentDate ?? entry.dueDate)}
            </Row>
            <Row label="Pagamento">{entry.paidAt ? formatDate(entry.paidAt) : DASH}</Row>
          </Section>

          <Section title="Documento">
            <Row label="Nº do documento">{entry.documentNumber ?? DASH}</Row>
            <Row label="Forma de pagamento">
              {paymentMethodLabel(entry.paymentMethod) ?? DASH}
            </Row>
            <Row label="Parcela">{entry.installmentNumber ?? DASH}</Row>
            <Row label="NF-e">
              {entry.fiscalDocument?.chave ? (
                <span className="break-all font-mono text-xs">
                  {formatChaveNFe(entry.fiscalDocument.chave)}
                </span>
              ) : (
                DASH
              )}
            </Row>
            <Row label="Pedido de compra">
              {entry.purchaseOrderId ? (
                <Link
                  href={`/app/purchase/${entry.purchaseOrderId}`}
                  className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400"
                >
                  <ExternalLink size={13} /> Ver PO
                </Link>
              ) : (
                DASH
              )}
            </Row>
          </Section>

          <Section title="Dados de pagamento">
            <Row label="Chave PIX">
              {supplier?.pixKey ? (
                <Copyable value={supplier.pixKey} copied={copy} />
              ) : supplier ? (
                // deep-link: abre a tela de fornecedores já com ESTE fornecedor em edição
                <Link
                  href={`/app/suppliers?edit=${supplier.id}`}
                  className="text-xs text-brand-600 hover:underline dark:text-brand-400"
                  title="A chave fica no cadastro do fornecedor e aparece em todas as contas dele"
                >
                  cadastrar no fornecedor
                </Link>
              ) : (
                DASH
              )}
            </Row>
            <Row label="Banco">
              {supplier?.bankName ? (
                <span>
                  {supplier.bankName}
                  {supplier.bankAgency && ` · ag. ${supplier.bankAgency}`}
                  {supplier.bankAccount && ` · cc. ${supplier.bankAccount}`}
                </span>
              ) : (
                DASH
              )}
            </Row>
            <Row label="Boleto (código de barras)">
              {entry.boletoBarcode ? <Copyable value={entry.boletoBarcode} copied={copy} /> : DASH}
            </Row>
            <Row label="PIX Copia e Cola desta conta">
              {entry.pixCopiaECola ? <Copyable value={entry.pixCopiaECola} copied={copy} /> : DASH}
            </Row>
          </Section>

          <Section title="Classificação">
            <Row label="Categoria">{catName ?? DASH}</Row>
            {splits.length === 0 ? (
              <Row label="Centro de custo">{DASH}</Row>
            ) : splits.length === 1 ? (
              <Row label="Centro de custo">{splits[0].costCenter.name}</Row>
            ) : (
              // rateio multi-centro (migração Omie): nome · % · valor
              <Row label="Centro de custo">
                <span className="flex flex-col items-end gap-0.5">
                  {splits.map((s) => (
                    <span key={s.id} className="text-xs">
                      {s.costCenter.name} · {Number(s.percentage)}% ·{' '}
                      <span className="tabular-nums">{formatBRL(num(s.amount))}</span>
                    </span>
                  ))}
                </span>
              </Row>
            )}
            <Row label="Origem">
              <Badge variant="neutral">{sourceLabel(entry.source)}</Badge>
            </Row>
          </Section>

          <Section title="Fornecedor">
            <Row label="Nome">{supplier?.name ?? DASH}</Row>
            <Row label="CNPJ/CPF">
              {supplier?.cnpj ? (
                <span className="tabular-nums">{formatCpfCnpj(supplier.cnpj)}</span>
              ) : (
                DASH
              )}
            </Row>
          </Section>

          {entry.paymentNote && (
            <Section title="Observações">
              <p className="text-sm text-content">{entry.paymentNote}</p>
            </Section>
          )}

          <Section title="Histórico">
            <ol className="space-y-2 pt-1">
              {/* eventos do AuditLog, mais recente primeiro */}
              {[...(history.data?.events ?? [])].reverse().map((ev, i) => {
                const fields = changedFieldsSummary(ev.changes);
                return (
                  <li key={i} className="text-sm">
                    <span className="font-medium text-content">{actionLabel(ev.action)}</span>
                    {ev.user && <span className="text-content-muted"> por {ev.user.name}</span>}
                    <span className="text-content-muted"> — {formatDateTime(ev.at)}</span>
                    {fields && <div className="text-xs text-content-muted">alterou: {fields}</div>}
                  </li>
                );
              })}
              {/* âncora: criação (títulos migrados não têm log de criação) */}
              <li className="text-sm">
                <span className="font-medium text-content">Criado</span>
                <span className="text-content-muted"> — {formatDateTime(entry.createdAt)}</span>
              </li>
            </ol>
            {history.isError && (
              <p className="pt-2 text-xs text-content-muted">
                Linha do tempo completa disponível após a próxima atualização do servidor.
              </p>
            )}
          </Section>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
