import {
  assertDemoCompanyName,
  assertDemoIdentity,
  assertSeedAllowed,
  demoPasswordFromEnv,
  SeedBlockedError,
} from '../../../prisma/seeds/seed-guard';

describe('seed-guard (Onda 0 — higiene do seed IAM)', () => {
  describe('assertSeedAllowed', () => {
    it('fora de produção libera estrutural e demo', () => {
      for (const NODE_ENV of [undefined, 'development', 'test', 'staging']) {
        expect(() => assertSeedAllowed('structural', { NODE_ENV })).not.toThrow();
        expect(() => assertSeedAllowed('demo', { NODE_ENV })).not.toThrow();
      }
    });

    it('produção: estrutural bloqueado sem ALLOW_PROD_SEED=true', () => {
      expect(() => assertSeedAllowed('structural', { NODE_ENV: 'production' })).toThrow(SeedBlockedError);
      expect(() => assertSeedAllowed('structural', { NODE_ENV: 'production', ALLOW_PROD_SEED: 'false' })).toThrow(
        SeedBlockedError,
      );
      expect(() => assertSeedAllowed('structural', { NODE_ENV: 'production', ALLOW_PROD_SEED: '1' })).toThrow(
        SeedBlockedError,
      );
    });

    it('produção: estrutural liberado só com ALLOW_PROD_SEED=true exato', () => {
      expect(() => assertSeedAllowed('structural', { NODE_ENV: 'production', ALLOW_PROD_SEED: 'true' })).not.toThrow();
    });

    it('produção: demo é HARD-BLOCKED, sem override por flag', () => {
      expect(() => assertSeedAllowed('demo', { NODE_ENV: 'production' })).toThrow(SeedBlockedError);
      expect(() => assertSeedAllowed('demo', { NODE_ENV: 'production', ALLOW_PROD_SEED: 'true' })).toThrow(
        /DEMONSTRAÇÃO bloqueado em produção/,
      );
    });
  });

  describe('assertDemoIdentity', () => {
    it('aceita domínio fictício', () => {
      expect(() => assertDemoIdentity('admin@exemplo.test')).not.toThrow();
      expect(() => assertDemoIdentity('loja@exemplo.test')).not.toThrow();
    });

    it('rejeita @gdr.com.br e @crd.com.br (qualquer caixa, subdomínio incluso)', () => {
      for (const e of [
        'admin@gdr.com.br',
        'diretor@gdr.com.br',
        'gerente@gdr.com.br',
        'loja@gdr.com.br',
        'ADMIN@GDR.COM.BR',
        'admin@crd.com.br',
        'x@fiscal.gdr.com.br',
      ]) {
        expect(() => assertDemoIdentity(e)).toThrow(SeedBlockedError);
      }
    });

    it('rejeita e-mail sem domínio', () => {
      expect(() => assertDemoIdentity('semarroba')).toThrow(SeedBlockedError);
    });
  });

  describe('assertDemoCompanyName', () => {
    it('aceita nome fictício', () => {
      expect(() => assertDemoCompanyName('Exemplo Calçados (Matriz)')).not.toThrow();
    });

    it('rejeita nomes que pareçam a empresa real', () => {
      for (const n of ['GDR Matriz', 'GDR Loja São Paulo', 'gdr reboques', 'CRD Comércio', 'Avecchi Ltda', 'Fábrica de Reboques X']) {
        expect(() => assertDemoCompanyName(n)).toThrow(SeedBlockedError);
      }
    });
  });

  describe('demoPasswordFromEnv', () => {
    it('sem SEED_USER_PASSWORD falha (nunca há default)', () => {
      expect(() => demoPasswordFromEnv({})).toThrow(SeedBlockedError);
      expect(() => demoPasswordFromEnv({ SEED_USER_PASSWORD: '' })).toThrow(SeedBlockedError);
    });

    it('com SEED_USER_PASSWORD devolve o valor', () => {
      expect(demoPasswordFromEnv({ SEED_USER_PASSWORD: 'x'.repeat(16) })).toBe('x'.repeat(16));
    });
  });
});
