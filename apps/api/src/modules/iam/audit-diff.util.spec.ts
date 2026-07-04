import { computeDiff, redactSensitive, REDACTED } from './audit-diff.util';

describe('audit-diff.util (#343)', () => {
  describe('computeDiff', () => {
    it('retorna apenas os campos alterados', () => {
      const before = { name: 'Reboque A', price: 100, status: 'DRAFT' };
      const after = { name: 'Reboque A', price: 150, status: 'CONFIRMED' };

      const diff = computeDiff(before, after);

      expect(diff).toEqual({
        oldValue: { price: 100, status: 'DRAFT' },
        newValue: { price: 150, status: 'CONFIRMED' },
      });
      // campo inalterado NÃO aparece
      expect(diff!.oldValue).not.toHaveProperty('name');
      expect(diff!.newValue).not.toHaveProperty('name');
    });

    it('retorna null quando nada mudou', () => {
      const state = { name: 'X', qty: 5, nested: { a: 1 } };
      expect(computeDiff(state, { ...state, nested: { a: 1 } })).toBeNull();
    });

    it('detecta campo adicionado e campo removido', () => {
      const diff = computeDiff({ a: 1, removed: 'x' }, { a: 1, added: 'y' });
      expect(diff).toEqual({
        oldValue: { removed: 'x' },
        newValue: { added: 'y' },
      });
    });

    it('redige campos sensíveis alterados (passwordHash, tokens, secrets)', () => {
      const diff = computeDiff(
        { passwordHash: 'old-hash', apiToken: 'old-token', name: 'A' },
        { passwordHash: 'new-hash', apiToken: 'new-token', name: 'B' },
      );
      expect(diff!.oldValue.passwordHash).toBe(REDACTED);
      expect(diff!.newValue.passwordHash).toBe(REDACTED);
      expect(diff!.oldValue.apiToken).toBe(REDACTED);
      expect(diff!.newValue.apiToken).toBe(REDACTED);
      // campo não sensível segue em claro
      expect(diff!.oldValue.name).toBe('A');
      expect(diff!.newValue.name).toBe('B');
    });

    it('nunca vaza valor sensível mesmo em objeto aninhado', () => {
      const diff = computeDiff(
        { config: { clientSecret: 'abc', url: 'x' } },
        { config: { clientSecret: 'def', url: 'y' } },
      );
      const serialized = JSON.stringify(diff);
      expect(serialized).not.toContain('abc');
      expect(serialized).not.toContain('def');
      expect((diff!.newValue.config as any).clientSecret).toBe(REDACTED);
    });

    it('normaliza Date para ISO string e compara por valor', () => {
      const d = new Date('2026-07-04T10:00:00.000Z');
      const same = computeDiff({ at: d }, { at: new Date(d) });
      expect(same).toBeNull();

      const changed = computeDiff({ at: d }, { at: new Date('2026-07-05T10:00:00.000Z') });
      expect(changed!.oldValue.at).toBe('2026-07-04T10:00:00.000Z');
    });

    it('trata before/after nulos (criação e deleção)', () => {
      const created = computeDiff(null, { name: 'novo' });
      expect(created).toEqual({ oldValue: {}, newValue: { name: 'novo' } });

      const deleted = computeDiff({ name: 'velho' }, null);
      expect(deleted).toEqual({ oldValue: { name: 'velho' }, newValue: {} });
    });
  });

  describe('redactSensitive', () => {
    it('redige campos sensíveis recursivamente (objetos e arrays)', () => {
      const result = redactSensitive({
        email: 'a@b.com',
        password: '123',
        senha: 'abc',
        refreshToken: 'tok',
        items: [{ secretKey: 's3cr3t', qty: 2 }],
      }) as any;

      expect(result.email).toBe('a@b.com');
      expect(result.password).toBe(REDACTED);
      expect(result.senha).toBe(REDACTED);
      expect(result.refreshToken).toBe(REDACTED);
      expect(result.items[0].secretKey).toBe(REDACTED);
      expect(result.items[0].qty).toBe(2);
    });

    it('passa valores primitivos adiante sem alterar', () => {
      expect(redactSensitive('texto')).toBe('texto');
      expect(redactSensitive(42)).toBe(42);
      expect(redactSensitive(null)).toBeNull();
    });
  });
});
