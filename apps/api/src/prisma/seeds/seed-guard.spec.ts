import {
  assertDemoCompanyName,
  assertDemoIdentity,
  assertSeedAllowed,
  demoPasswordFromEnv,
  resolveDatabaseEndpoint,
  SeedBlockedError,
} from '../../../prisma/seeds/seed-guard';

// Hosts fictícios: nenhum host/credencial real de produção aqui.
const LOCAL = 'postgresql://dev:dev@localhost:5432/avequi_dev';
const LOCAL_IP = 'postgresql://dev:dev@127.0.0.1:5432/avequi_dev';
const LOCAL_V6 = 'postgresql://dev:dev@[::1]:5432/avequi_dev';
const REMOTE = 'postgresql://app:secret@db.exemplo.test:6543/postgres';
const REMOTE_POOLER = 'postgres://app:secret@aws-0-sa-east-1.pooler.exemplo.test:6543/postgres?pgbouncer=true';

describe('seed-guard (Onda 0 — higiene do seed IAM)', () => {
  describe('resolveDatabaseEndpoint (endpoint APARENTE — não prova o banco por trás)', () => {
    it('loopback explícito é loopback', () => {
      expect(resolveDatabaseEndpoint(LOCAL)).toEqual({ kind: 'loopback', host: 'localhost' });
      expect(resolveDatabaseEndpoint(LOCAL_IP)).toEqual({ kind: 'loopback', host: '127.0.0.1' });
      expect(resolveDatabaseEndpoint(LOCAL_V6)).toEqual({ kind: 'loopback', host: '::1' });
      expect(resolveDatabaseEndpoint('postgres://dev@LOCALHOST/db')).toEqual({ kind: 'loopback', host: 'localhost' });
    });

    it('qualquer outro host é remoto (inclusive nomes que "parecem" dev)', () => {
      expect(resolveDatabaseEndpoint(REMOTE).kind).toBe('remote');
      expect(resolveDatabaseEndpoint(REMOTE_POOLER).kind).toBe('remote');
      expect(resolveDatabaseEndpoint('postgresql://a:b@dev-db.exemplo.test/x').kind).toBe('remote');
      expect(resolveDatabaseEndpoint('postgresql://a:b@10.0.0.5/x').kind).toBe('remote');
      expect(resolveDatabaseEndpoint('postgresql://a:b@localhost.exemplo.test/x').kind).toBe('remote');
    });

    it('ausente, vazia, inválida, esquema errado ou sem host → bloqueia', () => {
      for (const url of [undefined, '', '   ', 'nao-e-url', 'mysql://a:b@localhost/x', 'postgresql:///x', 'postgresql://', 'http://localhost/x']) {
        expect(() => resolveDatabaseEndpoint(url)).toThrow(SeedBlockedError);
      }
    });

    it('a mensagem de erro nunca ecoa a URL (pode ter credencial)', () => {
      try {
        resolveDatabaseEndpoint('mysql://usuario:segredo-xyz@localhost/x');
        fail('deveria lançar');
      } catch (e) {
        expect(String((e as Error).message)).not.toContain('segredo-xyz');
      }
    });
  });

  describe('assertSeedAllowed — matriz obrigatória', () => {
    const DEMO_OK = { NODE_ENV: 'development', DATABASE_URL: LOCAL, CONFIRM_DEMO_SEED: 'true' };
    const cases: Array<[string, Parameters<typeof assertSeedAllowed>[0], Record<string, string | undefined>, 'ok' | 'block']> = [
      // DATABASE_URL ausente / inválida → bloqueia (demo e estrutural)
      ['DATABASE_URL ausente → demo bloqueado', 'demo', { ...DEMO_OK, DATABASE_URL: undefined }, 'block'],
      ['DATABASE_URL ausente → estrutural bloqueado', 'structural', { NODE_ENV: 'development' }, 'block'],
      ['DATABASE_URL inválida → demo bloqueado', 'demo', { ...DEMO_OK, DATABASE_URL: 'nao-e-url' }, 'block'],
      ['DATABASE_URL inválida → estrutural bloqueado', 'structural', { NODE_ENV: 'development', DATABASE_URL: 'nao-e-url' }, 'block'],
      // demo: caminho feliz (único)
      ['development + loopback + CONFIRM_DEMO_SEED=true → demo permitido', 'demo', DEMO_OK, 'ok'],
      ['development + 127.0.0.1 + confirmação → demo permitido', 'demo', { ...DEMO_OK, DATABASE_URL: LOCAL_IP }, 'ok'],
      ['development + ::1 + confirmação → demo permitido', 'demo', { ...DEMO_OK, DATABASE_URL: LOCAL_V6 }, 'ok'],
      // demo: NODE_ENV — só development exato
      ['NODE_ENV ausente → demo bloqueado', 'demo', { ...DEMO_OK, NODE_ENV: undefined }, 'block'],
      ['NODE_ENV=test → demo bloqueado', 'demo', { ...DEMO_OK, NODE_ENV: 'test' }, 'block'],
      ['NODE_ENV=staging → demo bloqueado', 'demo', { ...DEMO_OK, NODE_ENV: 'staging' }, 'block'],
      ['NODE_ENV=production → demo bloqueado', 'demo', { ...DEMO_OK, NODE_ENV: 'production' }, 'block'],
      ['NODE_ENV=Development (caixa) → demo bloqueado', 'demo', { ...DEMO_OK, NODE_ENV: 'Development' }, 'block'],
      // demo: confirmação — só "true" exato, e não é override
      ['development + loopback sem CONFIRM_DEMO_SEED → demo bloqueado', 'demo', { ...DEMO_OK, CONFIRM_DEMO_SEED: undefined }, 'block'],
      ['CONFIRM_DEMO_SEED=false → demo bloqueado', 'demo', { ...DEMO_OK, CONFIRM_DEMO_SEED: 'false' }, 'block'],
      ['CONFIRM_DEMO_SEED=1 → demo bloqueado', 'demo', { ...DEMO_OK, CONFIRM_DEMO_SEED: '1' }, 'block'],
      ['CONFIRM_DEMO_SEED=TRUE (caixa) → demo bloqueado', 'demo', { ...DEMO_OK, CONFIRM_DEMO_SEED: 'TRUE' }, 'block'],
      ['confirmação NÃO libera production', 'demo', { ...DEMO_OK, NODE_ENV: 'production' }, 'block'],
      ['confirmação NÃO libera host não-loopback', 'demo', { ...DEMO_OK, DATABASE_URL: REMOTE }, 'block'],
      ['confirmação + ALLOW_PROD_SEED NÃO liberam host não-loopback', 'demo', { ...DEMO_OK, DATABASE_URL: REMOTE, ALLOW_PROD_SEED: 'true' }, 'block'],
      // demo: endpoint não-loopback com qualquer NODE_ENV
      ['não-loopback + NODE_ENV ausente → demo bloqueado', 'demo', { DATABASE_URL: REMOTE, CONFIRM_DEMO_SEED: 'true' }, 'block'],
      ['não-loopback + development → demo bloqueado', 'demo', { ...DEMO_OK, DATABASE_URL: REMOTE_POOLER }, 'block'],
      ['não-loopback + staging → demo bloqueado', 'demo', { NODE_ENV: 'staging', DATABASE_URL: REMOTE, CONFIRM_DEMO_SEED: 'true' }, 'block'],
      // estrutural: loopback
      ['loopback + development → estrutural permitido', 'structural', { NODE_ENV: 'development', DATABASE_URL: LOCAL }, 'ok'],
      ['loopback + NODE_ENV ausente → estrutural permitido', 'structural', { DATABASE_URL: LOCAL_IP }, 'ok'],
      ['loopback + test → estrutural permitido', 'structural', { NODE_ENV: 'test', DATABASE_URL: LOCAL_V6 }, 'ok'],
      ['loopback + production → estrutural bloqueado sem flag', 'structural', { NODE_ENV: 'production', DATABASE_URL: LOCAL }, 'block'],
      ['loopback + production + ALLOW_PROD_SEED=true → estrutural permitido', 'structural', { NODE_ENV: 'production', DATABASE_URL: LOCAL, ALLOW_PROD_SEED: 'true' }, 'ok'],
      // estrutural: não-loopback exige a flag exata
      ['não-loopback + development → estrutural bloqueado sem flag', 'structural', { NODE_ENV: 'development', DATABASE_URL: REMOTE }, 'block'],
      ['não-loopback + NODE_ENV ausente → estrutural bloqueado sem flag', 'structural', { DATABASE_URL: REMOTE }, 'block'],
      ['não-loopback + development + ALLOW_PROD_SEED=false → estrutural bloqueado', 'structural', { NODE_ENV: 'development', DATABASE_URL: REMOTE, ALLOW_PROD_SEED: 'false' }, 'block'],
      ['não-loopback + development + ALLOW_PROD_SEED=1 → estrutural bloqueado', 'structural', { NODE_ENV: 'development', DATABASE_URL: REMOTE, ALLOW_PROD_SEED: '1' }, 'block'],
      ['não-loopback + development + ALLOW_PROD_SEED=true → estrutural permitido', 'structural', { NODE_ENV: 'development', DATABASE_URL: REMOTE, ALLOW_PROD_SEED: 'true' }, 'ok'],
      ['não-loopback + production → estrutural bloqueado sem flag', 'structural', { NODE_ENV: 'production', DATABASE_URL: REMOTE }, 'block'],
      ['não-loopback + production + ALLOW_PROD_SEED=true → estrutural permitido', 'structural', { NODE_ENV: 'production', DATABASE_URL: REMOTE, ALLOW_PROD_SEED: 'true' }, 'ok'],
      // CONFIRM_DEMO_SEED não interfere no estrutural
      ['CONFIRM_DEMO_SEED=true não libera estrutural em production', 'structural', { NODE_ENV: 'production', DATABASE_URL: LOCAL, CONFIRM_DEMO_SEED: 'true' }, 'block'],
    ];

    it.each(cases)('%s', (_label, kind, env, expected) => {
      if (expected === 'ok') {
        expect(() => assertSeedAllowed(kind, env)).not.toThrow();
      } else {
        expect(() => assertSeedAllowed(kind, env)).toThrow(SeedBlockedError);
      }
    });

    it('mensagens do demo explicam cada camada sem ecoar credencial', () => {
      expect(() => assertSeedAllowed('demo', { ...DEMO_OK, NODE_ENV: 'staging' })).toThrow(/NODE_ENV=staging.*NODE_ENV=development exato/);
      expect(() => assertSeedAllowed('demo', { ...DEMO_OK, NODE_ENV: undefined })).toThrow(/NODE_ENV=\(ausente\)/);
      expect(() => assertSeedAllowed('demo', { ...DEMO_OK, DATABASE_URL: REMOTE })).toThrow(/não-loopback \(db\.exemplo\.test\).*não existe flag/);
      expect(() => assertSeedAllowed('demo', { ...DEMO_OK, CONFIRM_DEMO_SEED: undefined })).toThrow(/CONFIRM_DEMO_SEED=true.*não libera production nem host remoto/);
      try {
        assertSeedAllowed('demo', { ...DEMO_OK, DATABASE_URL: 'postgresql://app:segredo-xyz@db.exemplo.test/x' });
        fail('deveria lançar');
      } catch (e) {
        expect(String((e as Error).message)).not.toContain('segredo-xyz');
      }
    });

    it('mensagem do estrutural não-loopback pede ALLOW_PROD_SEED=true', () => {
      expect(() => assertSeedAllowed('structural', { NODE_ENV: 'development', DATABASE_URL: REMOTE })).toThrow(
        /não-loopback \(db\.exemplo\.test\).*ALLOW_PROD_SEED=true/,
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
