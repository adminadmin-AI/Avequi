'use client';

import Link from 'next/link';
import { Copy, ExternalLink } from 'lucide-react';
import { useList } from '@/hooks/use-resource';
import type { FinancialCategory, FinancialEntry } from '@/types/api';
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
import { num, remainingOf, sourceLabel, findCategoryName } from './detail';

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
  // Árvore de categorias p/ resolver o nome (o GET /finance não inclui a
  // relação; react-query deduplica com o fetch do Novo Lançamento).
  const { data: catRoots = [] } = useList<FinancialCategory>('/finance/categories');

  function copy(v: string) {
    navigator.clipboard?.writeText(v);
    toast.success('Copiado');
  }

  if (!entry) return null;

  const supplier = entry.supplier ?? entry.purchaseOrder?.supplier ?? null;
  const catName = findCategoryName(catRoots, entry.categoryId);
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
            <Row label="Emissão">{DASH /* Fase 2 — campo ainda não existe no ERP */}</Row>
            <Row label="Vencimento">{formatDate(entry.dueDate)}</Row>
            <Row label="Previsão de pagamento">
              {formatDate(entry.expectedPaymentDate ?? entry.dueDate)}
            </Row>
            <Row label="Pagamento">{entry.paidAt ? formatDate(entry.paidAt) : DASH}</Row>
          </Section>

          <Section title="Documento">
            <Row label="Nº do documento">{DASH /* Fase 2 */}</Row>
            <Row label="Forma de pagamento">{DASH /* Fase 2 */}</Row>
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
                <Link
                  href="/app/suppliers"
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
            <Row label="Boleto (código de barras)">{DASH /* Fase 2 — por conta */}</Row>
            <Row label="PIX Copia e Cola desta conta">{DASH /* Fase 2 — por conta */}</Row>
          </Section>

          <Section title="Classificação">
            <Row label="Categoria">{catName ?? DASH}</Row>
            <Row label="Centro de custo">{DASH /* Fase 2 — rateio via splits */}</Row>
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
            <Row label="Criado em">{formatDateTime(entry.createdAt)}</Row>
            <p className="pt-1 text-xs text-content-muted">
              A linha do tempo completa (quem criou, editou, baixou — e o que mudou) chega na
              Fase 2 do detalhe.
            </p>
          </Section>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
