import { describe, it, expect } from 'vitest';
import { num, remainingOf, sourceLabel, findCategoryName } from './detail';
import type { FinancialCategory } from '@/types/api';

describe('helpers do painel de detalhe da Carteira de Pagáveis', () => {
  it('num converte decimal-string e trata vazio', () => {
    expect(num('123.45')).toBe(123.45);
    expect(num(null)).toBe(0);
    expect(num(undefined)).toBe(0);
  });

  it('remainingOf = valor − pago (sem pagamento = valor cheio)', () => {
    expect(remainingOf({ amount: '100.00', paidAmount: '40.00' })).toBe(60);
    expect(remainingOf({ amount: '100.00', paidAmount: null })).toBe(100);
  });

  it('sourceLabel traduz as origens conhecidas', () => {
    expect(sourceLabel('MANUAL')).toBe('Lançamento manual');
    expect(sourceLabel('AUTO_SALES')).toBe('Automático — venda');
    expect(sourceLabel('AUTO_PURCHASE')).toBe('Automático — compra');
  });

  describe('findCategoryName', () => {
    const cat = (id: string, name: string, children?: FinancialCategory[]) =>
      ({ id, name, children }) as FinancialCategory;
    const tree = [
      cat('root-desp', 'Despesa', [
        cat('c1', 'Fretes'),
        cat('c2', 'Matéria-prima', [cat('c2a', 'Aço')]),
      ]),
      cat('root-rec', 'Receita'),
    ];

    it('acha na raiz, no filho e no neto', () => {
      expect(findCategoryName(tree, 'root-rec')).toBe('Receita');
      expect(findCategoryName(tree, 'c1')).toBe('Fretes');
      expect(findCategoryName(tree, 'c2a')).toBe('Aço');
    });

    it('id desconhecido/ausente → null', () => {
      expect(findCategoryName(tree, 'nope')).toBeNull();
      expect(findCategoryName(tree, null)).toBeNull();
      expect(findCategoryName([], 'c1')).toBeNull();
    });
  });
});
