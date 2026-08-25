'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { erroDeAcao } from '@/lib/feedback';
import { useProductOptions } from '@/hooks/use-product-customer-options';
import { FormDialog } from '@/components/ui/form-dialog';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Combobox } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import {
  SPM_RESOURCE,
  KIND_LABEL,
  NON_PRODUCT_KINDS,
  type Decision,
  type DecisionMode,
  type NonProductKind,
  type PairView,
  decisionIsValid,
  decisionRequest,
  describeDecision,
  initialDecisionMode,
  productLabel,
  sourceLabel,
  suggestedNonProductKind,
} from './conciliation';

/**
 * Diálogo de decisão humana sobre um par (fornecedor + cProd).
 *
 * Três caminhos, sempre um par por vez (sem bulk):
 * - confirmar a sugestão existente (Product) → `POST .../confirm-product`;
 * - escolher outro Product ativo da company (busca server-side) → idem;
 * - classificar como não-produto (Consumo / Ativo / Frete-outro) → `POST .../classify`.
 *
 * Antes do botão, o bloco "O que será gravado" mostra a frase exata da
 * decisão. A sugestão é contexto: só vira verdade quando a pessoa confirma.
 */
interface Props {
  row: PairView | null;
  onOpenChange: (open: boolean) => void;
  onResolved?: (row: PairView) => void;
}

const MODE_OPTIONS: { value: DecisionMode; label: string }[] = [
  { value: 'SUGGESTION', label: 'Confirmar sugestão' },
  { value: 'PRODUCT', label: 'Escolher Product' },
  { value: 'KIND', label: 'Não é produto' },
];

export function ResolveDialog({ row, onOpenChange, onResolved }: Props) {
  const toast = useToast();
  const qc = useQueryClient();

  const [mode, setMode] = useState<DecisionMode>('PRODUCT');
  const [productId, setProductId] = useState('');
  const [productLbl, setProductLbl] = useState<string | undefined>(undefined);
  const [productSearch, setProductSearch] = useState('');
  const [kind, setKind] = useState<NonProductKind>('CONSUMABLE');
  const [reason, setReason] = useState('');

  // reinicia o formulário a cada par aberto
  useEffect(() => {
    if (!row) return;
    setMode(initialDecisionMode(row));
    setProductId('');
    setProductLbl(undefined);
    setProductSearch('');
    setKind(suggestedNonProductKind(row) ?? (row.canonical && row.canonical.kind !== 'PRODUCT' ? (row.canonical.kind as NonProductKind) : 'CONSUMABLE'));
    setReason('');
  }, [row]);

  // busca de Products ativos da company (tenant pelo JWT) — a query só existe
  // no modo "Escolher Product"; nos outros modos não sai request nenhuma
  const { options: productOptions, items: productItems, isLoading: productsLoading } = useProductOptions(
    { search: productSearch, isActive: true, take: 20 },
    { enabled: !!row && mode === 'PRODUCT' },
  );

  const hasProductSuggestion = !!row?.suggestion?.productId;
  const modeOptions = useMemo(
    () => MODE_OPTIONS.filter((o) => o.value !== 'SUGGESTION' || hasProductSuggestion),
    [hasProductSuggestion],
  );

  const decision: Decision | null = useMemo(() => {
    if (!row) return null;
    const r = reason.trim() || undefined;
    if (mode === 'SUGGESTION' && row.suggestion?.productId) {
      return {
        mode: 'SUGGESTION',
        productId: row.suggestion.productId,
        productLabel: productLabel(row.suggestion.productSku, row.suggestion.productName),
        reason: r,
      };
    }
    if (mode === 'PRODUCT') {
      if (!productId) return null;
      return { mode: 'PRODUCT', productId, productLabel: productLbl ?? productId, reason: r };
    }
    if (mode === 'KIND') return { mode: 'KIND', kind, reason: r };
    return null;
  }, [row, mode, productId, productLbl, kind, reason]);

  const resolve = useMutation({
    mutationFn: async (d: Decision) => {
      if (!row) throw new Error('par não selecionado');
      const { path, body } = decisionRequest(row, d);
      return apiClient.post(path, body);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [SPM_RESOURCE] }),
  });

  function submit() {
    if (!row || !decisionIsValid(decision)) {
      toast.error('Escolha um Product ou uma classificação');
      return;
    }
    resolve.mutate(decision, {
      onSuccess: () => {
        toast.success(
          decision.mode === 'KIND' ? 'Item classificado' : 'Product confirmado',
          `${row.supplierName ?? 'Fornecedor'} · ${row.supplierProductCode}`,
        );
        onResolved?.(row);
        onOpenChange(false);
      },
      onError: (e) => toast.error(erroDeAcao(decision.mode === 'KIND' ? 'classificar o item' : 'confirmar o Product', e)),
    });
  }

  const valid = decisionIsValid(decision);

  return (
    <FormDialog
      open={!!row}
      onOpenChange={onOpenChange}
      title={row?.status === 'CONFIRMED' ? 'Trocar decisão' : 'Resolver item de compra'}
      description={row ? `${row.supplierName ?? 'Fornecedor'} · cProd ${row.supplierProductCode}` : ''}
      formId="spm-resolve-form"
      submitLabel={mode === 'KIND' ? 'Classificar' : 'Confirmar Product'}
      loading={resolve.isPending}
      dirty={reason.length > 0 || productId.length > 0}
    >
      <form
        id="spm-resolve-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-4 py-1"
      >
        {row && (
          <div className="rounded-lg bg-surface-secondary px-3 py-2 text-sm">
            <p className="text-content">{row.lastDescription ?? '—'}</p>
            <p className="text-xs text-content-muted">
              {row.lastNcm ? `NCM ${row.lastNcm} · ` : ''}
              {row.lastUnit ? `${row.lastUnit} · ` : ''}
              {row.documentCount} nota{row.documentCount === 1 ? '' : 's'}
            </p>
            {row.canonical && (
              <p className="mt-1 text-xs text-content-muted">
                Decisão atual:{' '}
                <span className="text-content">
                  {row.canonical.kind === 'PRODUCT'
                    ? productLabel(row.canonical.productSku, row.canonical.productName)
                    : KIND_LABEL[row.canonical.kind]}
                </span>
              </p>
            )}
          </div>
        )}

        <SegmentedControl options={modeOptions} value={mode} onValueChange={setMode} size="sm" className="w-full" />

        {mode === 'SUGGESTION' && row?.suggestion?.productId && (
          <div className="rounded-lg border border-info/40 bg-info/5 px-3 py-2">
            <p className="text-xs text-content-muted">Sugestão</p>
            <p className="text-sm font-medium text-content">
              {productLabel(row.suggestion.productSku, row.suggestion.productName)}
            </p>
            {sourceLabel(row.suggestion.source) && (
              <p className="mt-0.5 text-xs text-content-muted">Origem: {sourceLabel(row.suggestion.source)}</p>
            )}
          </div>
        )}

        {mode === 'PRODUCT' && (
          <div>
            <Label required>Product do catálogo (ativos desta empresa)</Label>
            <Combobox
              options={productOptions}
              value={productId}
              onValueChange={(v) => {
                setProductId(v);
                const p = productItems.find((i) => i.id === v);
                setProductLbl(p ? `${p.sku} · ${p.name}` : undefined);
              }}
              onQueryChange={setProductSearch}
              serverSideSearch
              selectedLabel={productLbl}
              loading={productsLoading}
              placeholder="Selecione"
              searchPlaceholder="Buscar por SKU ou nome..."
              emptyMessage="Nenhum Product ativo encontrado"
            />
          </div>
        )}

        {mode === 'KIND' && (
          <div>
            <Label required>Classificação</Label>
            <Select value={kind} onChange={(e) => setKind(e.target.value as NonProductKind)}>
              {NON_PRODUCT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
            {suggestedNonProductKind(row ?? { suggestion: null }) && (
              <p className="mt-1 text-xs text-content-muted">
                Sugestão: {KIND_LABEL[suggestedNonProductKind(row!)!]}
                {sourceLabel(row?.suggestion?.source) ? ` (${sourceLabel(row?.suggestion?.source)})` : ''}
              </p>
            )}
          </div>
        )}

        <div>
          <Label>Motivo (opcional)</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} rows={2} placeholder="Ex.: conferido fisicamente com o almoxarifado" />
        </div>

        <div className="rounded-lg border border-line px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-content-muted">O que será gravado</p>
          {row && valid ? (
            <p className="mt-1 text-sm text-content">{describeDecision(row, decision)}</p>
          ) : (
            <p className="mt-1 text-sm text-content-muted">Escolha um Product ou uma classificação.</p>
          )}
          <p className="mt-1 text-xs text-content-muted">
            <Badge variant="neutral" className="mr-1">
              auditado
            </Badge>
            Fica registrado quem decidiu e quando; a descrição da nota não vira identidade.
          </p>
        </div>
      </form>
    </FormDialog>
  );
}
