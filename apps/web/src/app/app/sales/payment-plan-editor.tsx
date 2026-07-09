'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useList } from '@/hooks/use-resource';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatBRL } from '@/lib/format';

/**
 * #584 — editor do plano de pagamento (1+ formas). Compartilhado entre a
 * Venda Balcão (#595) e o detalhe da OV (PATCH /sales/:id/payments).
 * A soma das formas deve fechar itens + frete — o indicador mostra ao vivo.
 */

export interface DraftPayment {
  method: string;
  amount: number;
  installments: number;
  acquirerId?: string;
  brand?: string;
}

interface Acquirer {
  id: string;
  name: string;
}

export const PAYMENT_METHODS: Array<{ value: string; label: string }> = [
  { value: 'DINHEIRO', label: 'Dinheiro' },
  { value: 'PIX', label: 'PIX' },
  { value: 'CARTAO_CREDITO', label: 'Cartão de crédito' },
  { value: 'CARTAO_DEBITO', label: 'Cartão de débito' },
  { value: 'BOLETO', label: 'Boleto' },
  { value: 'TED', label: 'TED' },
  { value: 'CHEQUE', label: 'Cheque' },
];

export const PAYMENT_METHOD_LABEL: Record<string, string> = Object.fromEntries(
  PAYMENT_METHODS.map((m) => [m.value, m.label]),
);

export const CARD_BRANDS = ['VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD'];

export const isCardMethod = (method: string) =>
  method === 'CARTAO_CREDITO' || method === 'CARTAO_DEBITO';

/** Valida o plano; retorna a mensagem de erro ou null quando ok */
export function validatePlan(payments: DraftPayment[], total: number): string | null {
  if (payments.length === 0) return 'Monte o plano de pagamento';
  const sum = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const remaining = Math.round((total - sum) * 100) / 100;
  if (remaining > 0.005) return `Faltam ${formatBRL(remaining)} no plano de pagamento`;
  if (remaining < -0.005) return `Plano de pagamento excede o total em ${formatBRL(-remaining)}`;
  if (payments.some((p) => isCardMethod(p.method) && !p.acquirerId)) {
    return 'Pagamento com cartão exige a adquirente (maquininha)';
  }
  return null;
}

export function PaymentPlanEditor({
  payments,
  onChange,
  total,
  disabled,
}: {
  payments: DraftPayment[];
  onChange: (payments: DraftPayment[]) => void;
  total: number;
  disabled?: boolean;
}) {
  // #584: endpoint escopado de vendas — vendedor escolhe a maquininha SEM ver
  // as taxas negociadas (finance.acquirers.view é restrito, decisão E1 #623)
  const { data: acquirers = [] } = useList<Acquirer>('/sales/acquirer-options');

  const sum = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const remaining = Math.round((total - sum) * 100) / 100;

  function add() {
    onChange([...payments, { method: 'PIX', amount: remaining > 0 ? remaining : 0, installments: 1 }]);
  }
  function update(idx: number, patch: Partial<DraftPayment>) {
    onChange(
      payments.map((p, i) => {
        if (i !== idx) return p;
        const next = { ...p, ...patch };
        if (patch.method !== undefined && !isCardMethod(patch.method)) {
          next.acquirerId = undefined;
          next.brand = undefined;
          next.installments = 1;
        }
        if (next.method === 'CARTAO_DEBITO') next.installments = 1;
        return next;
      }),
    );
  }
  function remove(idx: number) {
    onChange(payments.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-3">
      {payments.length === 0 && (
        <p className="py-2 text-center text-sm text-content-muted">
          Nenhuma forma adicionada — a soma deve fechar {formatBRL(total)}.
        </p>
      )}
      {payments.map((p, idx) => (
        <div key={idx} className="flex flex-wrap items-end gap-3 rounded-lg bg-surface-secondary p-3">
          <div className="w-44">
            <Label>Forma</Label>
            <Select
              aria-label="Forma de pagamento"
              value={p.method}
              onChange={(e) => update(idx, { method: e.target.value })}
              disabled={disabled}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-32">
            <Label>Valor (R$)</Label>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={p.amount || ''}
              onChange={(e) => update(idx, { amount: Number(e.target.value) })}
              disabled={disabled}
            />
          </div>
          {p.method === 'CARTAO_CREDITO' && (
            <div className="w-24">
              <Label>Parcelas</Label>
              <Select
                aria-label="Parcelas"
                value={String(p.installments)}
                onChange={(e) => update(idx, { installments: Number(e.target.value) })}
                disabled={disabled}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}x
                  </option>
                ))}
              </Select>
            </div>
          )}
          {isCardMethod(p.method) && (
            <>
              <div className="w-48">
                <Label required>Adquirente</Label>
                <Select
                  aria-label="Adquirente"
                  value={p.acquirerId ?? ''}
                  onChange={(e) => update(idx, { acquirerId: e.target.value || undefined })}
                  disabled={disabled}
                >
                  <option value="">— Maquininha —</option>
                  {acquirers.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-36">
                <Label>Bandeira</Label>
                <Select
                  aria-label="Bandeira"
                  value={p.brand ?? ''}
                  onChange={(e) => update(idx, { brand: e.target.value || undefined })}
                  disabled={disabled}
                >
                  <option value="">— Qualquer —</option>
                  {CARD_BRANDS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          )}
          {!disabled && (
            <button
              onClick={() => remove(idx)}
              title="Remover forma"
              className="mb-2 rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-danger"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      ))}

      <div className="flex items-center justify-between border-t border-line pt-3 text-sm">
        {!disabled && (
          <Button type="button" variant="secondary" size="sm" onClick={add}>
            <Plus size={14} />
            Adicionar forma
          </Button>
        )}
        <div className="ml-auto flex gap-6">
          <span className="text-content-secondary">
            Plano: <strong className="tabular-nums">{formatBRL(sum)}</strong>
          </span>
          <span className={Math.abs(remaining) > 0.005 ? 'font-medium text-danger' : 'text-content-secondary'}>
            {remaining > 0.005
              ? `Faltam ${formatBRL(remaining)}`
              : remaining < -0.005
                ? `Excede em ${formatBRL(-remaining)}`
                : 'Plano fechado ✓'}
          </span>
        </div>
      </div>
    </div>
  );
}
