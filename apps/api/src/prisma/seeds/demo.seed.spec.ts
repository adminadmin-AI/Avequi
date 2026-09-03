import * as bcrypt from 'bcryptjs';
import { createFakePrisma, extractEmails, STRUCTURAL_CATALOG_MODELS } from './fake-prisma';
import {
  DEMO_ADMIN_EMAIL,
  DEMO_COMPANY_CNPJS,
  DEMO_EMAIL_DOMAIN,
  DEMO_FILIAL_NAME,
  DEMO_MATRIZ_NAME,
  DEMO_USERS,
  preflightDemoDatabase,
  seedDemo,
} from '../../../prisma/seeds/demo.seed';
import { REAL_COMPANY_MARKERS, SeedBlockedError } from '../../../prisma/seeds/seed-guard';
import { SEED_GRANTED_BY } from '../../../prisma/seeds/user-role-mirror';
import { ENUM_ROLE_TO_SYSTEM_ROLE } from '../../modules/iam/roles.catalog';

const PASSWORD = 'Senha-De-Teste-Forte-123';
// Hosts fictícios — nenhum host/credencial real.
const LOCAL_URL = 'postgresql://dev:dev@localhost:5432/avequi_dev';
const REMOTE_URL = 'postgresql://app:secret@db.exemplo.test:6543/postgres';
/** Único conjunto de env que passa pelo guard do demo. */
const OK = { NODE_ENV: 'development', DATABASE_URL: LOCAL_URL, CONFIRM_DEMO_SEED: 'true', SEED_USER_PASSWORD: PASSWORD };

/** Fakes que simulam um banco com conteúdo NÃO-demo atrás de um localhost (túnel/proxy). */
const NON_DEMO_COMPANY = { 'company.findMany': () => [{ cnpj: '00.000.000/0001-00' }] };
const NON_DEMO_USER = { 'user.findMany': () => [{ email: 'pessoa@empresa-real.example' }] };
/** Banco só com o demo canônico (rerun). */
const DEMO_ONLY = {
  'company.findMany': () => DEMO_COMPANY_CNPJS.map((cnpj) => ({ cnpj })),
  'user.findMany': () => DEMO_USERS.map((u) => ({ email: u.email.toUpperCase() })), // caixa não importa
};

const onlyReads = (calls: Array<{ model: string; method: string }>) => calls.every((c) => /^(find|count)/.test(c.method));

describe('seedDemo (Onda 0 — higiene do seed IAM)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(bcrypt, 'hash').mockResolvedValue('$2a$10$hash-de-teste' as never);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('chamada DIRETA de seedDemo() — nenhum caso pula a política', () => {
    it('production → bloqueia sem tocar no banco', async () => {
      const fake = createFakePrisma();
      await expect(seedDemo(fake.client, { ...OK, NODE_ENV: 'production' })).rejects.toThrow(SeedBlockedError);
      expect(fake.calls).toHaveLength(0);
    });

    it('NODE_ENV ausente / test / staging → bloqueia sem tocar no banco', async () => {
      const fake = createFakePrisma();
      for (const NODE_ENV of [undefined, 'test', 'staging']) {
        await expect(seedDemo(fake.client, { ...OK, NODE_ENV })).rejects.toThrow(/NODE_ENV=development exato/);
      }
      expect(fake.calls).toHaveLength(0);
    });

    it('endpoint não-loopback → bloqueia sem tocar no banco (mesmo com confirmação e ALLOW_PROD_SEED)', async () => {
      const fake = createFakePrisma();
      await expect(seedDemo(fake.client, { ...OK, DATABASE_URL: REMOTE_URL })).rejects.toThrow(/não-loopback/);
      await expect(seedDemo(fake.client, { ...OK, DATABASE_URL: REMOTE_URL, ALLOW_PROD_SEED: 'true' })).rejects.toThrow(/não-loopback/);
      expect(fake.calls).toHaveLength(0);
    });

    it('localhost sem CONFIRM_DEMO_SEED=true (ausente / false / 1) → bloqueia sem tocar no banco', async () => {
      const fake = createFakePrisma();
      for (const CONFIRM_DEMO_SEED of [undefined, 'false', '1']) {
        await expect(seedDemo(fake.client, { ...OK, CONFIRM_DEMO_SEED })).rejects.toThrow(/CONFIRM_DEMO_SEED=true/);
      }
      expect(fake.calls).toHaveLength(0);
    });

    it('DATABASE_URL ausente / inválida → bloqueia sem tocar no banco', async () => {
      const fake = createFakePrisma();
      await expect(seedDemo(fake.client, { ...OK, DATABASE_URL: undefined })).rejects.toThrow(/DATABASE_URL ausente/);
      await expect(seedDemo(fake.client, { ...OK, DATABASE_URL: 'nao-e-url' })).rejects.toThrow(/inválida/);
      expect(fake.calls).toHaveLength(0);
    });

    it('sem SEED_USER_PASSWORD → bloqueia sem tocar no banco (nunca default)', async () => {
      const fake = createFakePrisma();
      await expect(seedDemo(fake.client, { ...OK, SEED_USER_PASSWORD: undefined })).rejects.toThrow(/SEED_USER_PASSWORD/);
      expect(fake.calls).toHaveLength(0);
    });

    it('localhost confirmado, mas banco com Company não-demo → bloqueia; só leituras', async () => {
      const fake = createFakePrisma(NON_DEMO_COMPANY);
      await expect(seedDemo(fake.client, OK)).rejects.toThrow(/entidades NÃO-demo \(1 empresa\(s\), 0 usuário\(s\)\)/);
      expect(onlyReads(fake.calls)).toBe(true);
      expect(fake.calls.map((c) => `${c.model}.${c.method}`)).toEqual(['company.findMany', 'user.findMany']);
    });

    it('localhost confirmado, mas banco com User não-demo → bloqueia; só leituras', async () => {
      const fake = createFakePrisma(NON_DEMO_USER);
      await expect(seedDemo(fake.client, OK)).rejects.toThrow(/entidades NÃO-demo \(0 empresa\(s\), 1 usuário\(s\)\)/);
      expect(onlyReads(fake.calls)).toBe(true);
    });

    it('banco não-demo: a mensagem não vaza e-mail, CNPJ nem URL', async () => {
      const fake = createFakePrisma({ ...NON_DEMO_COMPANY, ...NON_DEMO_USER });
      let message = '';
      await seedDemo(fake.client, OK).catch((e) => (message = String(e.message)));
      for (const forbidden of ['pessoa@empresa-real.example', '00.000.000', 'postgresql://', 'localhost', 'dev:dev']) {
        expect(message).not.toContain(forbidden);
      }
    });
  });

  describe('preflightDemoDatabase (read-only)', () => {
    it('banco vazio → empty', async () => {
      const fake = createFakePrisma();
      await expect(preflightDemoDatabase(fake.client)).resolves.toEqual({ companies: 0, users: 0, state: 'empty' });
      expect(onlyReads(fake.calls)).toBe(true);
    });

    it('somente demo canônico → demo (reconhecimento POSITIVO por CNPJ e e-mail)', async () => {
      const fake = createFakePrisma(DEMO_ONLY);
      await expect(preflightDemoDatabase(fake.client)).resolves.toEqual({ companies: 2, users: DEMO_USERS.length, state: 'demo' });
    });

    it('empresa "que não é GDR" mas também não é demo → bloqueia (critério é positivo, não negativo)', async () => {
      const fake = createFakePrisma({ 'company.findMany': () => [{ cnpj: '99.999.999/0001-99' }] });
      await expect(preflightDemoDatabase(fake.client)).rejects.toThrow(SeedBlockedError);
    });

    it('usuário no domínio exemplo.test que NÃO está em DEMO_USERS → bloqueia', async () => {
      const fake = createFakePrisma({ 'user.findMany': () => [{ email: `outro@${DEMO_EMAIL_DOMAIN}` }] });
      await expect(preflightDemoDatabase(fake.client)).rejects.toThrow(SeedBlockedError);
    });
  });

  it('banco vazio, development + loopback + confirmação: cria 2 empresas fictícias e os usuários demo', async () => {
    const fake = createFakePrisma();
    const summary = await seedDemo(fake.client, OK);

    expect(summary).toEqual({ companies: 2, users: DEMO_USERS.length, roleAssignmentsCreated: DEMO_USERS.length });
    expect(fake.callsOf('company', 'upsert')).toHaveLength(2);
    expect(fake.callsOf('user', 'upsert')).toHaveLength(DEMO_USERS.length);
    // ordem: guard (sem query) → preflight de conteúdo → preflight IAM → escritas
    expect(fake.calls.slice(0, 3).map((c) => `${c.model}.${c.method}`)).toEqual(['company.findMany', 'user.findMany', 'role.findMany']);
  });

  it('rerun com somente entidades demo canônicas: permitido', async () => {
    const fake = createFakePrisma({ ...DEMO_ONLY, 'userRoleAssignment.findUnique': () => ({ id: 'ja-existe' }) });
    const summary = await seedDemo(fake.client, OK);
    expect(summary.roleAssignmentsCreated).toBe(0);
    expect(fake.callsOf('company', 'upsert')).toHaveLength(2);
  });

  it('exercita todos os blocos demo (catálogo, BOM, roteiro, armazéns, estoque, fiscal, financeiro, centros de custo)', async () => {
    const fake = createFakePrisma();
    await seedDemo(fake.client, OK);

    for (const model of [
      'product',
      'supplier',
      'customer',
      'bomVersion',
      'routingStep',
      'warehouse',
      'stockBalance',
      'stockMovement',
      'taxRule',
      'financialCategory',
      'costCenter',
    ]) {
      expect(fake.modelsTouched()).toContain(model);
    }
  });

  it('NÃO escreve no catálogo estrutural (cClassTrib, permissões, perfis, vínculos de perfil, planos)', async () => {
    const fake = createFakePrisma();
    await seedDemo(fake.client, OK);

    for (const model of STRUCTURAL_CATALOG_MODELS) {
      const writes = fake.callsOf(model).filter((c) => !/^find|^count/.test(c.method));
      expect(writes).toEqual([]);
    }
    const roleReads = fake.callsOf('role');
    expect(roleReads.map((c) => c.method)).toEqual(['findMany']);
    expect(roleReads[0].args.where).toMatchObject({ companyId: null, isSystem: true });
  });

  it('cria o UserRoleAssignment v2 de CADA usuário demo com o perfil system equivalente', async () => {
    const fake = createFakePrisma();
    await seedDemo(fake.client, OK);

    const userRows = fake.callsOf('user', 'upsert');
    const assignments = fake.callsOf('userRoleAssignment', 'create').map((c) => c.args.data);
    expect(assignments).toHaveLength(DEMO_USERS.length);

    for (const [i, demo] of DEMO_USERS.entries()) {
      const expectedRole = ENUM_ROLE_TO_SYSTEM_ROLE[demo.role as string];
      expect(expectedRole).toBeDefined();
      expect(assignments[i]).toEqual({
        userId: expect.any(String),
        roleId: `role-${expectedRole}`,
        companyId: userRows[i].args.create.companyId,
        grantedBy: SEED_GRANTED_BY,
      });
    }
    expect(new Set(assignments.map((a) => a.userId)).size).toBe(DEMO_USERS.length);
  });

  it('sem os perfis system (db:seed não rodou): falha orientando a rodar db:seed antes, só leituras', async () => {
    const fake = createFakePrisma({ 'role.findMany': () => [] });
    await expect(seedDemo(fake.client, OK)).rejects.toThrow(/npm run db:seed`.*antes de `npm run db:seed:demo`/);
    expect(fake.calls.map((c) => `${c.model}.${c.method}`)).toEqual(['company.findMany', 'user.findMany', 'role.findMany']);
  });

  it('nenhum usuário demo usa @gdr.com.br ou @crd.com.br', async () => {
    const fake = createFakePrisma();
    await seedDemo(fake.client, OK);

    const emails = fake.callsOf('user', 'upsert').map((c) => String(c.args.create.email).toLowerCase());
    expect(emails).toHaveLength(DEMO_USERS.length);
    for (const e of emails) {
      expect(e.endsWith(`@${DEMO_EMAIL_DOMAIN}`)).toBe(true);
      expect(e).not.toMatch(/@(.*\.)?gdr\.com\.br$/);
      expect(e).not.toMatch(/@(.*\.)?crd\.com\.br$/);
    }
    expect(emails).toContain(DEMO_ADMIN_EMAIL);
    for (const real of ['admin@gdr.com.br', 'diretor@gdr.com.br', 'gerente@gdr.com.br', 'loja@gdr.com.br']) {
      expect(emails).not.toContain(real);
    }
  });

  it('TODOS os e-mails gravados (usuários, empresas, clientes, fornecedores…) usam o domínio fictício', async () => {
    const fake = createFakePrisma();
    await seedDemo(fake.client, OK);

    const emails = extractEmails(JSON.stringify(fake.calls));
    expect(emails.length).toBeGreaterThanOrEqual(DEMO_USERS.length + 2 + 2);
    for (const e of emails) {
      expect(e.endsWith(`@${DEMO_EMAIL_DOMAIN}`)).toBe(true);
    }
  });

  it('nenhuma escrita do demo contém identidade real (e-mail, nome de empresa, referência a operação real)', async () => {
    const fake = createFakePrisma();
    await seedDemo(fake.client, OK);

    const payload = JSON.stringify(fake.calls);
    expect(payload).not.toMatch(/gdr\.com\.br/i);
    expect(payload).not.toMatch(/crd\.com\.br/i);
    expect(payload).not.toMatch(/GDR Reboques/i);
    expect(payload).not.toMatch(/\bGDR\b/);
    expect(payload).not.toMatch(/\bCRD\b/);
    expect(payload).not.toMatch(/14236/);

    for (const c of fake.callsOf('company', 'upsert')) {
      for (const field of ['name', 'razaoSocial']) {
        for (const re of REAL_COMPANY_MARKERS) expect(String(c.args.create[field])).not.toMatch(re);
      }
      expect(DEMO_COMPANY_CNPJS).toContain(c.args.create.cnpj);
    }
    expect(fake.callsOf('company', 'upsert').map((c) => c.args.create.name)).toEqual([DEMO_MATRIZ_NAME, DEMO_FILIAL_NAME]);
  });

  it('usuários nascem com mustChangePassword e hash (nunca senha em claro)', async () => {
    const fake = createFakePrisma();
    await seedDemo(fake.client, OK);

    for (const c of fake.callsOf('user', 'upsert')) {
      expect(c.args.create.mustChangePassword).toBe(true);
      expect(c.args.create.passwordHash).toBe('$2a$10$hash-de-teste');
      expect(c.args.update).toEqual({});
    }
    expect(JSON.stringify(fake.calls)).not.toContain(PASSWORD);
  });
});
