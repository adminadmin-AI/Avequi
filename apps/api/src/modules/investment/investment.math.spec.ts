import { irr, npv, paybackDiscounted, paybackSimple } from './investment.math';

// Projeto clássico: aporte 1000, retornos 500 por 3 períodos
const FLOWS = [-1000, 500, 500, 500];

describe('investment.math', () => {
  describe('npv', () => {
    it('desconta os fluxos à taxa por período', () => {
      // -1000 + 500/1.1 + 500/1.21 + 500/1.331 = 243.43
      expect(npv(0.1, FLOWS)).toBeCloseTo(243.43, 2);
    });

    it('VPL na própria TIR é ~0', () => {
      const r = irr(FLOWS)!;
      expect(npv(r, FLOWS)).toBeCloseTo(0, 4);
    });
  });

  describe('irr', () => {
    it('encontra a TIR do projeto (~23,37%)', () => {
      const r = irr(FLOWS)!;
      expect(r * 100).toBeGreaterThan(23);
      expect(r * 100).toBeLessThan(24);
    });

    it('retorna null quando não há troca de sinal (fluxos todos positivos)', () => {
      expect(irr([100, 100, 100])).toBeNull();
    });
  });

  describe('payback', () => {
    it('payback simples cai no período em que o acumulado zera', () => {
      expect(paybackSimple(FLOWS)).toBe(2);
    });

    it('payback descontado é maior que o simples', () => {
      const disc = paybackDiscounted(0.1, FLOWS)!;
      expect(disc).toBeGreaterThan(2);
      expect(disc).toBeCloseTo(2.35, 2);
    });

    it('payback fracionário interpola dentro do período', () => {
      // -1000, +400, +900 → recupera entre t1 (acum -600) e t2: 600/900 = 0.67
      expect(paybackSimple([-1000, 400, 900])).toBeCloseTo(1.67, 2);
    });

    it('retorna null quando nunca recupera o investimento', () => {
      expect(paybackSimple([-1000, 100, 100])).toBeNull();
    });
  });
});
