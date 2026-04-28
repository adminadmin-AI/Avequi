import { computeAvgCost } from './avg-cost';

describe('computeAvgCost', () => {
  // S06.05 – saldo zero (primeiro recebimento do produto)
  it('retorna o próprio custo unitário quando saldo anterior é zero', () => {
    expect(computeAvgCost(0, 0, 100, 10)).toBe(10);
  });

  it('retorna 0 quando quantidade e saldo são ambos zero', () => {
    expect(computeAvgCost(0, 0, 0, 0)).toBe(0);
  });

  // S06.05 – saldo existente, recebimento com custo igual
  it('mantém o custo quando recebe ao mesmo custo', () => {
    expect(computeAvgCost(50, 10, 50, 10)).toBe(10);
  });

  // S06.05 – saldo existente, custo de entrada maior (eleva média)
  it('eleva o custo médio quando recebe a custo maior', () => {
    // 100 un @ 10 + 100 un @ 20 → média = 15
    const result = computeAvgCost(100, 10, 100, 20);
    expect(result).toBeCloseTo(15, 4);
  });

  // S06.05 – saldo existente, custo de entrada menor (reduz média)
  it('reduz o custo médio quando recebe a custo menor', () => {
    // 100 un @ 20 + 50 un @ 8 → (2000 + 400) / 150 = 16
    const result = computeAvgCost(100, 20, 50, 8);
    expect(result).toBeCloseTo(16, 4);
  });

  // S06.05 – múltiplos recebimentos sequenciais
  it('acumula custo médio corretamente em recebimentos sucessivos', () => {
    // 1º recebimento: 0 → 200 un @ 5 = 5.00
    const after1 = computeAvgCost(0, 0, 200, 5);
    expect(after1).toBe(5);

    // 2º recebimento: 200 @ 5 + 100 @ 8 → (1000 + 800) / 300 = 6.00
    const after2 = computeAvgCost(200, after1, 100, 8);
    expect(after2).toBeCloseTo(6, 4);

    // 3º recebimento: 300 @ 6 + 200 @ 3 → (1800 + 600) / 500 = 4.80
    const after3 = computeAvgCost(300, after2, 200, 3);
    expect(after3).toBeCloseTo(4.8, 4);
  });

  // Cenário GDR – matéria-prima couro
  it('calcula corretamente cenário realista de matéria-prima', () => {
    // Estoque: 500 m² @ R$ 12,50/m²
    // Recebimento: 300 m² @ R$ 14,00/m²
    // Esperado: (500*12.50 + 300*14.00) / 800 = (6250 + 4200) / 800 = 13.0625
    const result = computeAvgCost(500, 12.5, 300, 14);
    expect(result).toBeCloseTo(13.0625, 4);
  });
});
