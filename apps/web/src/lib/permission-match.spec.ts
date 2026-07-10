import { describe, expect, it } from 'vitest';
import { permissionMatches } from './permission-match';

/**
 * Espelho dos casos do backend (permission.service.spec.ts) — se a semântica
 * mudar lá, estes testes devem quebrar aqui junto.
 */
describe('permissionMatches', () => {
  const effective = new Set(['sales.orders.view', 'sales.orders.create', 'finance.entries.view']);

  it('code exato: membership no conjunto', () => {
    expect(permissionMatches(effective, 'sales.orders.view')).toBe(true);
    expect(permissionMatches(effective, 'sales.orders.delete')).toBe(false);
  });

  it('wildcard de sufixo casa por prefixo', () => {
    expect(permissionMatches(effective, 'sales.*')).toBe(true);
    expect(permissionMatches(effective, 'sales.orders.*')).toBe(true);
    expect(permissionMatches(effective, 'fiscal.*')).toBe(false);
  });

  it('"*" sozinho: true se o conjunto não está vazio', () => {
    expect(permissionMatches(effective, '*')).toBe(true);
    expect(permissionMatches(new Set(), '*')).toBe(false);
  });

  it('padrões inválidos são fail-closed (false, sem lançar)', () => {
    expect(permissionMatches(effective, 'sa*les.orders.view')).toBe(false);
    expect(permissionMatches(effective, 'sales.*.view')).toBe(false);
    expect(permissionMatches(effective, '*.orders.view')).toBe(false);
  });

  it('wildcard não vaza para módulo com prefixo textual parecido', () => {
    const set = new Set(['salesforce.leads.view']);
    expect(permissionMatches(set, 'sales.*')).toBe(false);
  });
});
