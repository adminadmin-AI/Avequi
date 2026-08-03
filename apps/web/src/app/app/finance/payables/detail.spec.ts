import { describe, it, expect } from 'vitest';
import {
  num,
  remainingOf,
  sourceLabel,
  findCategoryName,
  paymentMethodLabel,
  installmentLabel,
  paymentDataVisibility,
  actionLabel,
  changedFieldsSummary,
  diasAtras,
  bankingAlertMessage,
} from './detail';
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

  it('paymentMethodLabel traduz e trata vazio', () => {
    expect(paymentMethodLabel('BOLETO')).toBe('Boleto');
    expect(paymentMethodLabel('PIX')).toBe('PIX');
    expect(paymentMethodLabel('DEBITO_AUTOMATICO')).toBe('Débito automático');
    expect(paymentMethodLabel('OUTROS')).toBe('Outros');
    expect(paymentMethodLabel(null)).toBeNull();
    expect(paymentMethodLabel(undefined)).toBeNull();
  });

  it('installmentLabel: "1/10" com total, "1" sem total, null à vista', () => {
    expect(installmentLabel({ installmentNumber: 1, installmentTotal: 10 })).toBe('1/10');
    expect(installmentLabel({ installmentNumber: 3, installmentTotal: null })).toBe('3');
    expect(installmentLabel({ installmentNumber: null, installmentTotal: null })).toBeNull();
  });

  describe('paymentDataVisibility — drawer adaptado à forma de pagamento', () => {
    const forn = { pixKey: 'chave@pix', bankName: 'Sicoob' };

    it('boleto mostra boleto e esconde PIX/banco (mesmo com chave no fornecedor)', () => {
      expect(
        paymentDataVisibility(
          { paymentMethod: 'BOLETO', boletoBarcode: '123', pixCopiaECola: null },
          forn,
        ),
      ).toEqual({ boleto: true, pix: false, banco: false });
    });

    it('PIX mostra PIX e esconde boleto/banco', () => {
      expect(
        paymentDataVisibility(
          { paymentMethod: 'PIX', boletoBarcode: null, pixCopiaECola: null },
          forn,
        ),
      ).toEqual({ boleto: false, pix: true, banco: false });
    });

    it('TED/débito automático mostram dados bancários', () => {
      expect(
        paymentDataVisibility(
          { paymentMethod: 'DEBITO_AUTOMATICO', boletoBarcode: null, pixCopiaECola: null },
          forn,
        ),
      ).toEqual({ boleto: false, pix: false, banco: true });
    });

    it('dado existente nunca é escondido (boleto com PIX Copia e Cola gravado)', () => {
      expect(
        paymentDataVisibility(
          { paymentMethod: 'BOLETO', boletoBarcode: '123', pixCopiaECola: 'br.gov.bcb.pix...' },
          forn,
        ).pix,
      ).toBe(true);
    });

    it('sem forma informada mostra o que existir', () => {
      expect(
        paymentDataVisibility({ paymentMethod: null, boletoBarcode: '123', pixCopiaECola: null }, forn),
      ).toEqual({ boleto: true, pix: true, banco: true });
      expect(
        paymentDataVisibility({ paymentMethod: null, boletoBarcode: null, pixCopiaECola: null }, null),
      ).toEqual({ boleto: false, pix: false, banco: false });
    });
  });

  it('actionLabel traduz ações conhecidas e devolve o cru nas demais', () => {
    expect(actionLabel('UPDATE')).toBe('Editado');
    expect(actionLabel('CREATE_PAYABLE')).toBe('Criado (compra)');
    expect(actionLabel('ALGO_NOVO')).toBe('ALGO_NOVO');
  });

  describe('#864 — mensagem do aviso anti-fraude', () => {
    const NOW = new Date('2026-07-31T15:00:00');

    it('diasAtras: hoje / 1 dia / N dias', () => {
      expect(diasAtras('2026-07-31T09:00:00', NOW)).toBe('hoje');
      expect(diasAtras('2026-07-30T09:00:00', NOW)).toBe('há 1 dia');
      expect(diasAtras('2026-07-16T09:00:00', NOW)).toBe('há 15 dias');
    });

    it('chave PIX trocada com ator', () => {
      expect(
        bankingAlertMessage(
          { at: '2026-07-29T10:00:00', by: { name: 'Manu' }, fields: ['pixKey'] },
          NOW,
        ),
      ).toBe('chave PIX alterada há 2 dias por Manu');
    });

    it('múltiplos campos e sem ator (sistema)', () => {
      expect(
        bankingAlertMessage(
          { at: '2026-07-31T10:00:00', by: null, fields: ['bankName', 'bankAccount'] },
          NOW,
        ),
      ).toBe('banco, conta alterados hoje');
    });
  });

  it('changedFieldsSummary resume os campos alterados em pt', () => {
    expect(
      changedFieldsSummary({
        amount: { from: 1, to: 2 },
        dueDate: { from: 'a', to: 'b' },
        boletoBarcode: { from: null, to: 'x' },
      }),
    ).toBe('valor, vencimento, código de barras');
    expect(changedFieldsSummary({ desconhecido: { from: 1, to: 2 } })).toBe('desconhecido');
    expect(changedFieldsSummary(null)).toBeNull();
    expect(changedFieldsSummary({})).toBeNull();
  });
});
