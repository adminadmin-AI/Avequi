import { PaymentMethod } from '@prisma/client';
import { comoDataOperacional } from '../../common/date/dia-operacional';
import { parcelasAPrazo, splitInstallments } from './parcelas-da-venda';

/**
 * #1152 — fonte única das parcelas a prazo do cliente: o financeiro gera os
 * títulos daqui e a NF-e monta as duplicatas daqui. Se este contrato mudar,
 * DANFE e contas a receber divergem.
 */
describe('parcelasAPrazo (#1152)', () => {
  const dia = comoDataOperacional('2026-09-03');

  it('boleto 4× de 6.689,03 → 4 parcelas a cada 30 dias, centavo na última, soma exata', () => {
    const out = parcelasAPrazo(
      [{ id: 'sp-1', method: PaymentMethod.BOLETO, amount: '6689.03', installments: 4 }],
      dia,
    );
    expect(out.map((p) => p.vencimento)).toEqual(['2026-10-03', '2026-11-02', '2026-12-02', '2027-01-01']);
    expect(out.map((p) => p.amount)).toEqual([1672.25, 1672.25, 1672.25, 1672.28]);
    expect(Number(out.reduce((s, p) => s + p.amount, 0).toFixed(2))).toBe(6689.03);
    expect(out[0]).toMatchObject({ salesPaymentId: 'sp-1', number: 1, total: 4 });
  });

  it('cartão e à vista NÃO viram parcela do cliente (adquirente deve; PIX é D+0)', () => {
    const out = parcelasAPrazo(
      [
        { id: 'a', method: PaymentMethod.CARTAO_CREDITO, amount: 300, installments: 3 },
        { id: 'b', method: PaymentMethod.PIX, amount: 100 },
        { id: 'c', method: PaymentMethod.DINHEIRO, amount: 50 },
      ],
      dia,
    );
    expect(out).toEqual([]);
  });

  it('misto: PIX + cheque 2× → só as 2 parcelas do cheque, na ordem do plano', () => {
    const out = parcelasAPrazo(
      [
        { id: 'pix', method: PaymentMethod.PIX, amount: 100 },
        { id: 'chq', method: PaymentMethod.CHEQUE, amount: 200, installments: 2 },
      ],
      dia,
    );
    expect(out).toHaveLength(2);
    expect(out.every((p) => p.salesPaymentId === 'chq')).toBe(true);
    expect(out.map((p) => p.amount)).toEqual([100, 100]);
  });

  it('installments ausente = 1 parcela em 30 dias', () => {
    const out = parcelasAPrazo([{ id: 'x', method: PaymentMethod.BOLETO, amount: 10 }], dia);
    expect(out).toEqual([
      expect.objectContaining({ number: 1, total: 1, amount: 10, vencimento: '2026-10-03' }),
    ]);
  });

  it('splitInstallments: N−1 iguais (piso) e a última absorve o resto', () => {
    expect(splitInstallments(100, 3)).toEqual([
      { number: 1, amount: 33.33 },
      { number: 2, amount: 33.33 },
      { number: 3, amount: 33.34 },
    ]);
  });
});
