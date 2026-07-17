import { describe, expect, it } from 'vitest';
import {
  FISCAL_FINALIDADE_LABEL,
  FISCAL_FINALIDADE_FILTER_OPTIONS,
  TIPO_NOTA_DEBITO_LABEL,
  TIPO_NOTA_CREDITO_LABEL,
} from './fiscal-status';

// #758 — badges/labels de finalidade da Reforma Tributária (Nota de Débito/Crédito)
describe('FISCAL_FINALIDADE_LABEL', () => {
  it('NORMAL é neutro (default, sem destaque)', () => {
    expect(FISCAL_FINALIDADE_LABEL.NORMAL.variant).toBe('neutral');
  });

  it('DEVOLUCAO é âmbar (warning)', () => {
    expect(FISCAL_FINALIDADE_LABEL.DEVOLUCAO.variant).toBe('warning');
  });

  it('NOTA_DEBITO é vermelho (danger)', () => {
    expect(FISCAL_FINALIDADE_LABEL.NOTA_DEBITO.variant).toBe('danger');
  });

  it('NOTA_CREDITO é verde (success)', () => {
    expect(FISCAL_FINALIDADE_LABEL.NOTA_CREDITO.variant).toBe('success');
  });

  it('COMPLEMENTAR e AJUSTE são neutros (cinza)', () => {
    expect(FISCAL_FINALIDADE_LABEL.COMPLEMENTAR.variant).toBe('neutral');
    expect(FISCAL_FINALIDADE_LABEL.AJUSTE.variant).toBe('neutral');
  });

  it('cobre as 6 finalidades do enum Prisma', () => {
    expect(Object.keys(FISCAL_FINALIDADE_LABEL).sort()).toEqual(
      ['AJUSTE', 'COMPLEMENTAR', 'DEVOLUCAO', 'NORMAL', 'NOTA_CREDITO', 'NOTA_DEBITO'].sort(),
    );
  });
});

describe('FISCAL_FINALIDADE_FILTER_OPTIONS', () => {
  it('expõe Normal/Devolução/Nota de Débito/Nota de Crédito para o filtro da listagem', () => {
    expect(FISCAL_FINALIDADE_FILTER_OPTIONS.map((o) => o.value)).toEqual([
      'NORMAL',
      'DEVOLUCAO',
      'NOTA_DEBITO',
      'NOTA_CREDITO',
    ]);
  });
});

describe('catálogos de motivo (SINIEF 49/2025)', () => {
  it('tipoNotaDebito cobre 01-08', () => {
    expect(Object.keys(TIPO_NOTA_DEBITO_LABEL)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08']);
  });

  it('tipoNotaCredito cobre 01-06', () => {
    expect(Object.keys(TIPO_NOTA_CREDITO_LABEL)).toEqual(['01', '02', '03', '04', '05', '06']);
  });
});
