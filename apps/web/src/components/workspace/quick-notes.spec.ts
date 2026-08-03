import { describe, expect, it } from 'vitest';
import { moveNote, NOTE_COLORS, NOTE_PALETTE, safeColor, tiltFor } from './quick-notes';

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

describe('NOTE_PALETTE', () => {
  it('tem paleta completa para toda cor do catálogo', () => {
    for (const c of NOTE_COLORS) {
      const pal = NOTE_PALETTE[c];
      expect(pal.paper).toHaveLength(2);
      expect(pal.pin).toHaveLength(3);
      expect(pal.text).toMatch(/^#[0-9a-f]{6}$/i);
      // stops são cores hex válidas
      for (const hex of [...pal.paper, ...pal.pin]) expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
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

describe('moveNote', () => {
  const board = ['a', 'b', 'c', 'd'];

  it('move a nota para a posição de destino', () => {
    expect(moveNote(board, 'd', 'a')).toEqual(['d', 'a', 'b', 'c']);
    expect(moveNote(board, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
  });

  it('soltar no mesmo lugar não mexe no mural', () => {
    expect(moveNote(board, 'b', 'b')).toBe(board);
  });

  it('id desconhecido (nota que sumiu do cache) devolve a ordem intacta', () => {
    expect(moveNote(board, 'z', 'a')).toBe(board);
    expect(moveNote(board, 'a', 'z')).toBe(board);
  });

  it('não perde nem duplica nota', () => {
    const out = moveNote(board, 'c', 'a');
    expect(out).toHaveLength(board.length);
    expect(new Set(out)).toEqual(new Set(board));
  });
});
