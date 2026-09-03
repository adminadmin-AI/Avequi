import {
  assertDemoCompanyName,
  assertDemoIdentity,
  assertSeedAllowed,
  demoPasswordFromEnv,
  resolveDatabaseTarget,
  SeedBlockedError,
} from '../../../prisma/seeds/seed-guard';

// Hosts fictícios: nenhum host/credencial real de produção aqui.
const LOCAL = 'postgresql://dev:dev@localhost:5432/avequi_dev';
const LOCAL_IP = 'postgresql://dev:dev@127.0.0.1:5432/avequi_dev';
const LOCAL_V6 = 'postgresql://dev:dev@[::1]:5432/avequi_dev';
const REMOTE = 'postgresql://app:secret@db.exemplo.test:6543/postgres';
const REMOTE_POOLER = 'postgres://app:secret@aws-0-sa-east-1.pooler.exemplo.test:6543/postgres?pgbouncer=true';

describe('seed-guard (Onda 0 — higiene do seed IAM)', () => {
  describe('resolveDatabaseTarget', () => {
    it('loopback explícito é local', () => {
      expect(resolveDatabaseTarget(LOCAL)).toEqual({ kind: 'local', host: 'localhost' });
      expect(resolveDatabaseTarget(LOCAL_IP)).toEqual({ kind: 'local', host: '127.0.0.1' });
      expect(resolveDatabaseTarget(LOCAL_V6)).toEqual({ kind: 'local', host: '::1' });
      expect(resolveDatabaseTarget('postgres://dev@LOCALHOST/db')).toEqual({ kind: 'local', host: 'localhost' });
    });

    it('qualquer outro host é remoto (inclusive nomes que "parecem" dev)', () => {
      expect(resolveDatabaseTarget(REMOTE).kind).toBe('remote');
      expect(resolveDatabaseTarget(REMOTE_POOLER).kind).toBe('remote');
      expect(resolveDatabaseTarget('postgresql://a:b@dev-db.exemplo.test/x').kind).toBe('remote');
      expect(resolveDatabaseTarget('postgresql://a:b@10.0.0.5/x').kind).toBe('remote');
      expect(resolveDatabaseTarget('postgresql://a:b@localhost.exemplo.test/x').kind).toBe('remote');
    });

    it('ausente, vazia, inválida, esquema errado ou sem host → bloqueia', () => {
      for (const url of [undefined, '', '   ', 'nao-e-url', 'mysql://a:b@localhost/x', 'postgresql:///x', 'postgresql://', 'http://localhost/x']) {
        expect(() => resolveDatabaseTarget(url)).toThrow(SeedBlockedError);
      }
    });

    it('a mensagem de erro nunca ecoa a URL (pode ter credencial)', () => {
      try {
        resolveDatabaseTarget('mysql://usuario:segredo-xyz@localhost/x');
        fail('deveria lançar');
      } catch (e) {
        expect(String((e as Error).message)).not.toContain('segredo-xyz');
      }
    });
  });

  describe('assertSeedAllowed — matriz obrigatória', () => {
    const cases: Array<[string, Parameters<typeof assertSeedAllowed>[0], Record<string, string | undefined>, 'ok' | 'block']> = [
      // DATABASE_URL ausente / inválida → bloqueia (demo e estrutural)
      ['DATABASE_URL ausente → demo bloqueado', 'demo', { NODE_ENV: 'development' }, 'block'],
      ['DATABASE_URL ausente → estrutural bloqueado', 'structural', { NODE_ENV: 'development' }, 'block'],
      ['DATABASE_URL inválida → demo bloqueado', 'demo', { NODE_ENV: 'development', DATABASE_URL: 'nao-e-url' }, 'block'],
      ['DATABASE_URL inválida → estrutural bloqueado', 'structural', { NODE_ENV: 'development', DATABASE_URL: 'nao-e-url' }, 'block'],
      // local + development
      ['localhost + development → demo permitido', 'demo', { NODE_ENV: 'development', DATABASE_URL: LOCAL }, 'ok'],
      ['localhost + development → estrutural permitido', 'structural', { NODE_ENV: 'development', DATABASE_URL: LOCAL }, 'ok'],
      ['127.0.0.1 + NODE_ENV ausente → demo permitido', 'demo', { DATABASE_URL: LOCAL_IP }, 'ok'],
      ['::1 + test → estrutural permitido', 'structural', { NODE_ENV: 'test', DATABASE_URL: LOCAL_V6 }, 'ok'],
      // remoto → demo sempre bloqueado
      ['remoto + NODE_ENV ausente → demo BLOQUEADO', 'demo', { DATABASE_URL: REMOTE }, 'block'],
      ['remoto + development → demo BLOQUEADO', 'demo', { NODE_ENV: 'development', DATABASE_URL: REMOTE }, 'block'],
      ['remoto + staging → demo BLOQUEADO', 'demo', { NODE_ENV: 'staging', DATABASE_URL: REMOTE }, 'block'],
      ['remoto + test → demo BLOQUEADO', 'demo', { NODE_ENV: 'test', DATABASE_URL: REMOTE_POOLER }, 'block'],
      ['remoto + development + ALLOW_PROD_SEED=true → demo continua BLOQUEADO', 'demo', { NODE_ENV: 'development', DATABASE_URL: REMOTE, ALLOW_PROD_SEED: 'true' }, 'block'],
      // remoto → estrutural exige a flag
      ['remoto + development → estrutural BLOQUEADO sem flag', 'structural', { NODE_ENV: 'development', DATABASE_URL: REMOTE }, 'block'],
      ['remoto + NODE_ENV ausente → estrutural BLOQUEADO sem flag', 'structural', { DATABASE_URL: REMOTE }, 'block'],
      ['remoto + development + ALLOW_PROD_SEED=false → estrutural BLOQUEADO', 'structural', { NODE_ENV: 'development', DATABASE_URL: REMOTE, ALLOW_PROD_SEED: 'false' }, 'block'],
      ['remoto + development + ALLOW_PROD_SEED=1 → estrutural BLOQUEADO (só "true" exato)', 'structural', { NODE_ENV: 'development', DATABASE_URL: REMOTE, ALLOW_PROD_SEED: '1' }, 'block'],
      ['remoto + development + ALLOW_PROD_SEED=true → estrutural permitido', 'structural', { NODE_ENV: 'development', DATABASE_URL: REMOTE, ALLOW_PROD_SEED: 'true' }, 'ok'],
      // defesa em profundidade: production com banco local
      ['localhost + production → demo BLOQUEADO', 'demo', { NODE_ENV: 'production', DATABASE_URL: LOCAL }, 'block'],
      ['localhost + production + ALLOW_PROD_SEED=true → demo BLOQUEADO', 'demo', { NODE_ENV: 'production', DATABASE_URL: LOCAL, ALLOW_PROD_SEED: 'true' }, 'block'],
      ['localhost + production → estrutural BLOQUEADO sem flag', 'structural', { NODE_ENV: 'production', DATABASE_URL: LOCAL }, 'block'],
      ['localhost + production + ALLOW_PROD_SEED=true → estrutural permitido', 'structural', { NODE_ENV: 'production', DATABASE_URL: LOCAL, ALLOW_PROD_SEED: 'true' }, 'ok'],
      // production + remoto
      ['remoto + production → demo BLOQUEADO', 'demo', { NODE_ENV: 'production', DATABASE_URL: REMOTE }, 'block'],
      ['remoto + production → estrutural BLOQUEADO sem flag', 'structural', { NODE_ENV: 'production', DATABASE_URL: REMOTE }, 'block'],
      ['remoto + production + ALLOW_PROD_SEED=true → estrutural permitido', 'structural', { NODE_ENV: 'production', DATABASE_URL: REMOTE, ALLOW_PROD_SEED: 'true' }, 'ok'],
    ];

    it.each(cases)('%s', (_label, kind, env, expected) => {
      if (expected === 'ok') {
        expect(() => assertSeedAllowed(kind, env)).not.toThrow();
      } else {
        expect(() => assertSeedAllowed(kind, env)).toThrow(SeedBlockedError);
      }
    });

    it('mensagem do demo remoto cita o host e a ausência de override', () => {
      expect(() => assertSeedAllowed('demo', { NODE_ENV: 'development', DATABASE_URL: REMOTE, ALLOW_PROD_SEED: 'true' })).toThrow(
        /REMOTO \(db\.exemplo\.test\).*não existe flag/,
      );
    });

    it('mensagem do estrutural remoto pede ALLOW_PROD_SEED=true', () => {
      expect(() => assertSeedAllowed('structural', { NODE_ENV: 'development', DATABASE_URL: REMOTE })).toThrow(
        /REMOTO \(db\.exemplo\.test\).*ALLOW_PROD_SEED=true/,
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
