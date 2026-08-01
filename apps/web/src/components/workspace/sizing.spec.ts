import { describe, expect, it } from 'vitest';
import { GRID_COLUMNS, MIN_INVITE_SPAN, SIZE_SPAN, normalizeSize, trailingGap } from './sizing';

describe('tiers de tamanho', () => {
  it('os três tiers dividem o grid em partes exatas', () => {
    expect(GRID_COLUMNS % SIZE_SPAN.small).toBe(0); // P+P+P fecha a linha
    expect(GRID_COLUMNS % SIZE_SPAN.medium).toBe(0); // M+M fecha a linha
    expect(SIZE_SPAN.large).toBe(GRID_COLUMNS);
    expect(SIZE_SPAN.small * 3).toBe(GRID_COLUMNS);
    expect(SIZE_SPAN.medium * 2).toBe(GRID_COLUMNS);
  });
});

describe('normalizeSize', () => {
  it('traduz o vocabulário legado dos layouts já salvos', () => {
    expect(normalizeSize('half')).toBe('medium');
    expect(normalizeSize('full')).toBe('large');
  });

  it('aceita os tiers atuais', () => {
    expect(normalizeSize('small')).toBe('small');
    expect(normalizeSize('medium')).toBe('medium');
    expect(normalizeSize('large')).toBe('large');
  });

  it('valor desconhecido não derruba a Home — vira undefined', () => {
    expect(normalizeSize('gigante')).toBeUndefined();
    expect(normalizeSize(undefined)).toBeUndefined();
    expect(normalizeSize(42)).toBeUndefined();
  });
});

describe('trailingGap', () => {
  it('linha fechada não deixa vão', () => {
    expect(trailingGap(['large'])).toBe(0);
    expect(trailingGap(['medium', 'medium'])).toBe(0);
    expect(trailingGap(['small', 'small', 'small'])).toBe(0);
    expect(trailingGap([])).toBe(0);
  });

  it('o que sobra na última linha é o espaço do convite', () => {
    expect(trailingGap(['medium'])).toBe(6);
    expect(trailingGap(['small'])).toBe(8);
    expect(trailingGap(['small', 'small'])).toBe(4);
    expect(trailingGap(['large', 'medium', 'small'])).toBe(2);
    // P + M deixa sobra de 2 colunas: fina demais para virar convite
    expect(trailingGap(['small', 'medium'])).toBeLessThan(MIN_INVITE_SPAN);
  });
});
