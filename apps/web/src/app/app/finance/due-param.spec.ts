import { describe, expect, it } from 'vitest';
import { dueFromSearch, parseDueParam } from './due-param';

/** Deep-link ?due= do calendário da Home — validação fail-quiet. */

describe('parseDueParam', () => {
  it('aceita ISO yyyy-mm-dd válido', () => {
    expect(parseDueParam('2026-07-31')).toBe('2026-07-31');
  });

  it('rejeita formato errado, data impossível e vazio', () => {
    expect(parseDueParam('31/07/2026')).toBeNull();
    expect(parseDueParam('2026-7-1')).toBeNull();
    expect(parseDueParam('2026-13-40')).toBeNull();
    expect(parseDueParam('')).toBeNull();
    expect(parseDueParam(null)).toBeNull();
    expect(parseDueParam(undefined)).toBeNull();
  });
});

describe('dueFromSearch', () => {
  it('extrai da query string com ou sem "?"', () => {
    expect(dueFromSearch('?due=2026-08-03')).toBe('2026-08-03');
    expect(dueFromSearch('due=2026-08-03&x=1')).toBe('2026-08-03');
  });

  it('sem parâmetro ou inválido → null', () => {
    expect(dueFromSearch('?x=1')).toBeNull();
    expect(dueFromSearch('?due=amanhã')).toBeNull();
  });
});
