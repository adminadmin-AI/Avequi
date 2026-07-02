'use client';

import { forwardRef } from 'react';
import { Input, type InputProps } from './input';

/**
 * MaskedInput — F2.2 (#308)
 *
 * Input com máscara brasileira aplicada durante a digitação (progressiva —
 * diferente dos formatters de exibição do lib/format.ts, que assumem valor
 * completo e fazem padStart). Sem dependência externa.
 *
 * Máscaras: cpf · cnpj · cpf-cnpj (alterna pelo tamanho) · phone (fixo/celular)
 * · cep · ncm · currency (BRL, centavos-first: digitar 1234 → R$ 12,34).
 *
 * Integração com react-hook-form:
 *  - via register: <MaskedInput mask="phone" {...register('phone')} /> —
 *    o valor mascarado chega no e.target.value antes do onChange do RHF.
 *  - via Controller: passe `value` cru ou mascarado (o componente normaliza
 *    a exibição) e leia e.target.value no onChange.
 *  - `onValueChange` entrega o valor cru (dígitos, ou number no currency).
 */

export type MaskType = 'cpf' | 'cnpj' | 'cpf-cnpj' | 'phone' | 'cep' | 'ncm' | 'currency';

const onlyDigits = (v: string): string => v.replace(/\D/g, '');

/** Aplica `pattern` ('#' = dígito) progressivamente, parando onde a digitação parou. */
function applyPattern(digits: string, pattern: string): string {
  let out = '';
  let i = 0;
  for (const ch of pattern) {
    if (i >= digits.length) break;
    if (ch === '#') {
      out += digits[i++];
    } else {
      out += ch;
    }
  }
  return out;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Mascara um valor cru (ou parcialmente mascarado) para exibição durante digitação. */
export function maskValue(mask: MaskType, raw: string): string {
  const d = onlyDigits(raw);
  switch (mask) {
    case 'cpf':
      return applyPattern(d.slice(0, 11), '###.###.###-##');
    case 'cnpj':
      return applyPattern(d.slice(0, 14), '##.###.###/####-##');
    case 'cpf-cnpj':
      return d.length <= 11
        ? applyPattern(d, '###.###.###-##')
        : applyPattern(d.slice(0, 14), '##.###.###/####-##');
    case 'phone':
      return d.length <= 10
        ? applyPattern(d, '(##) ####-####')
        : applyPattern(d.slice(0, 11), '(##) #####-####');
    case 'cep':
      return applyPattern(d.slice(0, 8), '#####-###');
    case 'ncm':
      return applyPattern(d.slice(0, 8), '####.##.##');
    case 'currency':
      return d ? brl.format(Number(d) / 100) : '';
  }
}

/** Valor cru a partir do mascarado: dígitos (string), ou number no currency. */
export function unmaskValue(mask: MaskType, masked: string): string | number {
  const d = onlyDigits(masked);
  if (mask === 'currency') return d ? Number(d) / 100 : 0;
  return d;
}

export interface MaskedInputProps extends InputProps {
  mask: MaskType;
  /** Valor cru após cada digitação (dígitos; number no currency). */
  onValueChange?: (raw: string | number) => void;
}

export const MaskedInput = forwardRef<HTMLInputElement, MaskedInputProps>(
  ({ mask, onChange, onValueChange, value, defaultValue, ...props }, ref) => {
    const handleChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
      const masked = maskValue(mask, e.target.value);
      e.target.value = masked;
      onChange?.(e);
      onValueChange?.(unmaskValue(mask, masked));
    };

    return (
      <Input
        ref={ref}
        inputMode="numeric"
        {...props}
        value={typeof value === 'string' ? maskValue(mask, value) : value}
        defaultValue={
          typeof defaultValue === 'string' ? maskValue(mask, defaultValue) : defaultValue
        }
        onChange={handleChange}
      />
    );
  },
);
MaskedInput.displayName = 'MaskedInput';
