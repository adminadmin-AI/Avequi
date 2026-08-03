import { describe, expect, it } from 'vitest';
import {
  INVOICE_METHOD_LABEL,
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_VARIANT,
  formatPeriod,
} from './billing-format';

// OPS WP5 (#912) — labels/variants e formatação de competência do billing.
describe('INVOICE_STATUS_LABEL / INVOICE_STATUS_VARIANT', () => {
  it('cobre os 4 status do enum Prisma InvoiceStatus', () => {
    expect(Object.keys(INVOICE_STATUS_LABEL).sort()).toEqual(['OPEN', 'OVERDUE', 'PAID', 'VOID'].sort());
    expect(Object.keys(INVOICE_STATUS_VARIANT).sort()).toEqual(['OPEN', 'OVERDUE', 'PAID', 'VOID'].sort());
  });

  it('OVERDUE é vermelho (danger) — precisa saltar aos olhos na lista', () => {
    expect(INVOICE_STATUS_VARIANT.OVERDUE).toBe('danger');
  });

  it('PAID é verde (success) e VOID é neutro (cinza)', () => {
    expect(INVOICE_STATUS_VARIANT.PAID).toBe('success');
    expect(INVOICE_STATUS_VARIANT.VOID).toBe('neutral');
  });

  it('OPEN é âmbar (warning) — nem tudo aberto é problema ainda', () => {
    expect(INVOICE_STATUS_VARIANT.OPEN).toBe('warning');
  });
});

describe('INVOICE_METHOD_LABEL', () => {
  it('cobre os 4 métodos aceitos pelo backend (INVOICE_METHODS)', () => {
    expect(Object.keys(INVOICE_METHOD_LABEL).sort()).toEqual(['BOLETO', 'OUTRO', 'PIX', 'TRANSFER'].sort());
  });
});

describe('formatPeriod', () => {
  it('formata a competência (1º dia do mês, ISO) como MM/AAAA', () => {
    expect(formatPeriod('2026-08-01T00:00:00.000Z')).toBe('08/2026');
  });

  it('preenche o mês com zero à esquerda', () => {
    expect(formatPeriod('2026-01-01T00:00:00.000Z')).toBe('01/2026');
  });

  it('data inválida vira travessão em vez de "Invalid Date"', () => {
    expect(formatPeriod('not-a-date')).toBe('—');
  });
});
