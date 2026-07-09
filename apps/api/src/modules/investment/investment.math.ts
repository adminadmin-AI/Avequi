// #399 Matemática de análise de investimentos — funções puras e testáveis.
// `flows` é indexado por período: flows[0] = aporte inicial (tipicamente < 0).

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Valor Presente Líquido a uma taxa por período (decimal, ex.: 0.1 = 10%). */
export function npv(rate: number, flows: number[]): number {
  return flows.reduce((s, cf, t) => s + cf / Math.pow(1 + rate, t), 0);
}

/**
 * Taxa Interna de Retorno (decimal). Newton-Raphson com fallback para bisseção.
 * Retorna null quando não há raiz no intervalo (ex.: fluxos todos de mesmo sinal).
 */
export function irr(flows: number[]): number | null {
  const f = (r: number) => npv(r, flows);

  // Newton-Raphson
  let r = 0.1;
  for (let i = 0; i < 100; i++) {
    const v = f(r);
    const d = flows.reduce((s, cf, t) => s - (t * cf) / Math.pow(1 + r, t + 1), 0);
    if (!isFinite(v) || !isFinite(d) || Math.abs(d) < 1e-12) break;
    const rn = r - v / d;
    if (!isFinite(rn) || rn <= -0.9999) break;
    if (Math.abs(rn - r) < 1e-9) {
      return Math.abs(f(rn)) < 1e-6 ? rn : bisection(f);
    }
    r = rn;
  }
  return bisection(f);
}

function bisection(f: (r: number) => number): number | null {
  let lo = -0.9999;
  let hi = 10;
  let flo = f(lo);
  let fhi = f(hi);
  if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null; // sem troca de sinal
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < 1e-9 || (hi - lo) / 2 < 1e-10) return mid;
    if (flo * fm < 0) {
      hi = mid;
      fhi = fm;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Payback (em períodos, fracionário) a partir de uma série acumulada.
 * Retorna null se o acumulado nunca fica ≥ 0.
 */
export function paybackFromSeries(flows: number[]): number | null {
  let cum = 0;
  for (let t = 0; t < flows.length; t++) {
    const prev = cum;
    cum += flows[t];
    if (cum >= 0) {
      if (t === 0) return 0;
      const needed = -prev; // quanto faltava recuperar no início do período t
      const fraction = flows[t] !== 0 ? needed / flows[t] : 0;
      return round2(t - 1 + fraction);
    }
  }
  return null;
}

/** Payback simples (fluxos nominais). */
export function paybackSimple(flows: number[]): number | null {
  return paybackFromSeries(flows);
}

/** Payback descontado (fluxos trazidos a valor presente pela taxa). */
export function paybackDiscounted(rate: number, flows: number[]): number | null {
  return paybackFromSeries(flows.map((cf, t) => cf / Math.pow(1 + rate, t)));
}
