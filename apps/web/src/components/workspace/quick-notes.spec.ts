import { describe, expect, it } from 'vitest';
import { NOTE_COLORS, NOTE_STYLE, safeColor, tiltFor } from './quick-notes';

/** Helpers puros das Notas rápidas. */

describe('safeColor', () => {
  it('aceita cores conhecidas', () => {
    for (const c of NOTE_COLORS) expect(safeColor(c)).toBe(c);
  });

  it('cai no amarelo para valor inválido/ausente', () => {
    expect(safeColor('teal')).toBe('yellow');
    expect(safeColor('')).toBe('yellow');
    expect(safeColor(null)).toBe('yellow');
    expect(safeColor(undefined)).toBe('yellow');
  });
});

describe('NOTE_STYLE', () => {
  it('tem estilo para toda cor do catálogo', () => {
    for (const c of NOTE_COLORS) {
      expect(NOTE_STYLE[c].paper).toBeTruthy();
      expect(NOTE_STYLE[c].edge).toBeTruthy();
    }
  });
});

describe('tiltFor', () => {
  it('é determinística e estável para o mesmo id', () => {
    expect(tiltFor('nota-abc')).toBe(tiltFor('nota-abc'));
  });

  it('fica na faixa suave [-2.2, 2.2]', () => {
    for (const id of ['a', 'zzz', 'clr123', 'n-9f8e', 'longa-id-de-teste']) {
      const t = tiltFor(id);
      expect(t).toBeGreaterThanOrEqual(-2.2);
      expect(t).toBeLessThanOrEqual(2.2);
    }
  });

  it('varia entre ids diferentes (não é tudo zero)', () => {
    // ids realistas (cuids); ângulo espalha bem entre notas distintas
    const angles = new Set(
      ['ckv1a', 'ckv2b7', 'ckv3c99', 'nota-xyz', 'lembrete-42', 'clr-9f8e'].map(tiltFor),
    );
    expect(angles.size).toBeGreaterThan(1);
  });
});
