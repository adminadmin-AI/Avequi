import { describe, expect, it } from 'vitest';
import { deltaTone, formatDeltaPct, longBusinessDate } from './my-day';

describe('deltaTone', () => {
  it('sem base de comparação é neutro (nunca "subiu")', () => {
    expect(deltaTone(null)).toBe('flat');
  });

  it('variação menor que 1% é estável, não ruído colorido', () => {
    expect(deltaTone(0.4)).toBe('flat');
    expect(deltaTone(-0.9)).toBe('flat');
  });

  it('acima do limiar colore para cima/para baixo', () => {
    expect(deltaTone(12)).toBe('up');
    expect(deltaTone(-5)).toBe('down');
  });
});

describe('formatDeltaPct', () => {
  it('null vira "sem base" — jamais +∞% ou +100% inventado', () => {
    expect(formatDeltaPct(null)).toBe('sem base');
  });

  it('formata com sinal e arredonda', () => {
    expect(formatDeltaPct(12.4)).toBe('+12%');
    expect(formatDeltaPct(-57.14)).toBe('-57%');
  });

  it('ruído vira "estável"', () => {
    expect(formatDeltaPct(0.2)).toBe('estável');
  });
});

describe('longBusinessDate', () => {
  it('não desloca o dia por fuso (31/07 continua 31)', () => {
    expect(longBusinessDate('2026-07-31')).toContain('31 de julho');
  });

  it('data inválida não quebra a interface', () => {
    expect(longBusinessDate('não-é-data')).toBe('');
  });
});
