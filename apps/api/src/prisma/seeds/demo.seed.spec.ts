import * as bcrypt from 'bcryptjs';
import { createFakePrisma, extractEmails, STRUCTURAL_CATALOG_MODELS } from './fake-prisma';
import {
  DEMO_ADMIN_EMAIL,
  DEMO_EMAIL_DOMAIN,
  DEMO_FILIAL_NAME,
  DEMO_MATRIZ_NAME,
  DEMO_USERS,
  seedDemo,
} from '../../../prisma/seeds/demo.seed';
import { REAL_COMPANY_MARKERS } from '../../../prisma/seeds/seed-guard';
import { SEED_GRANTED_BY } from '../../../prisma/seeds/user-role-mirror';
import { ENUM_ROLE_TO_SYSTEM_ROLE } from '../../modules/iam/roles.catalog';

const PASSWORD = 'Senha-De-Teste-Forte-123';

describe('seedDemo (Onda 0 — higiene do seed IAM)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(bcrypt, 'hash').mockResolvedValue('$2a$10$hash-de-teste' as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('exige senha (nunca default)', async () => {
    const fake = createFakePrisma();
    await expect(seedDemo(fake.client, { password: '' })).rejects.toThrow(/senha/);
    expect(fake.calls).toHaveLength(0);
  });

  it('funciona fora de produção: cria 2 empresas fictícias e os usuários demo', async () => {
    const fake = createFakePrisma();
    const summary = await seedDemo(fake.client, { password: PASSWORD });

    expect(summary).toEqual({ companies: 2, users: DEMO_USERS.length, roleAssignmentsCreated: DEMO_USERS.length });
    expect(fake.callsOf('company', 'upsert')).toHaveLength(2);
    expect(fake.callsOf('user', 'upsert')).toHaveLength(DEMO_USERS.length);
  });

  it('exercita todos os blocos demo (catálogo, BOM, roteiro, armazéns, estoque, fiscal, financeiro, centros de custo)', async () => {
    const fake = createFakePrisma();
    await seedDemo(fake.client, { password: PASSWORD });

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
    await seedDemo(fake.client, { password: PASSWORD });

    for (const model of STRUCTURAL_CATALOG_MODELS) {
      const writes = fake.callsOf(model).filter((c) => !/^find|^count/.test(c.method));
      expect(writes).toEqual([]);
    }
    // a única leitura do catálogo é a dos perfis system, para vincular os usuários demo
    const roleReads = fake.callsOf('role');
    expect(roleReads.map((c) => c.method)).toEqual(['findMany']);
    expect(roleReads[0].args.where).toMatchObject({ companyId: null, isSystem: true });
  });

  it('cria o UserRoleAssignment v2 de CADA usuário demo com o perfil system equivalente', async () => {
    const fake = createFakePrisma();
    await seedDemo(fake.client, { password: PASSWORD });

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
    // não depende do fallback legado: nenhum usuário demo fica sem atribuição v2
    const userIds = new Set(assignments.map((a) => a.userId));
    expect(userIds.size).toBe(DEMO_USERS.length);
  });

  it('só cria a atribuição que falta (idempotente)', async () => {
    const fake = createFakePrisma({ 'userRoleAssignment.findUnique': () => ({ id: 'ja-existe' }) });
    const summary = await seedDemo(fake.client, { password: PASSWORD });
    expect(fake.callsOf('userRoleAssignment', 'create')).toEqual([]);
    expect(summary.roleAssignmentsCreated).toBe(0);
  });

  it('sem os perfis system (db:seed não rodou): falha claramente orientando a rodar db:seed antes', async () => {
    const fake = createFakePrisma({ 'role.findMany': () => [] });
    await expect(seedDemo(fake.client, { password: PASSWORD })).rejects.toThrow(/npm run db:seed`.*antes de `npm run db:seed:demo`/);
    expect(fake.callsOf('userRoleAssignment')).toEqual([]);
    // nunca tenta criar o catálogo por conta própria
    expect(fake.callsOf('role').filter((c) => c.method !== 'findMany')).toEqual([]);
  });

  it('nenhum usuário demo usa @gdr.com.br ou @crd.com.br', async () => {
    const fake = createFakePrisma();
    await seedDemo(fake.client, { password: PASSWORD });

    const emails = fake.callsOf('user', 'upsert').map((c) => String(c.args.create.email).toLowerCase());
    expect(emails).toHaveLength(DEMO_USERS.length);
    for (const e of emails) {
      expect(e.endsWith(`@${DEMO_EMAIL_DOMAIN}`)).toBe(true);
      expect(e).not.toMatch(/@(.*\.)?gdr\.com\.br$/);
      expect(e).not.toMatch(/@(.*\.)?crd\.com\.br$/);
    }
    expect(emails).toContain(DEMO_ADMIN_EMAIL);
    expect(emails).not.toContain('admin@gdr.com.br');
    expect(emails).not.toContain('diretor@gdr.com.br');
    expect(emails).not.toContain('gerente@gdr.com.br');
    expect(emails).not.toContain('loja@gdr.com.br');
  });

  it('TODOS os e-mails gravados (usuários, empresas, clientes, fornecedores…) usam o domínio fictício', async () => {
    const fake = createFakePrisma();
    await seedDemo(fake.client, { password: PASSWORD });

    const emails = extractEmails(JSON.stringify(fake.calls));
    expect(emails.length).toBeGreaterThanOrEqual(DEMO_USERS.length + 2 + 2); // usuários + 2 empresas + 2 clientes
    for (const e of emails) {
      expect(e.endsWith(`@${DEMO_EMAIL_DOMAIN}`)).toBe(true);
    }
    expect(emails).not.toContain('joao@email.com');
    expect(emails).not.toContain('compras@modas.com');
  });

  it('nenhuma escrita do demo contém identidade real (e-mail, nome de empresa, referência a operação real)', async () => {
    const fake = createFakePrisma();
    await seedDemo(fake.client, { password: PASSWORD });

    const payload = JSON.stringify(fake.calls);
    expect(payload).not.toMatch(/gdr\.com\.br/i);
    expect(payload).not.toMatch(/crd\.com\.br/i);
    expect(payload).not.toMatch(/GDR Reboques/i);
    expect(payload).not.toMatch(/\bGDR\b/);
    expect(payload).not.toMatch(/\bCRD\b/);
    expect(payload).not.toMatch(/14236/);

    for (const c of fake.callsOf('company', 'upsert')) {
      for (const field of ['name', 'razaoSocial']) {
        const value = String(c.args.create[field]);
        for (const re of REAL_COMPANY_MARKERS) expect(value).not.toMatch(re);
      }
    }
    expect(fake.callsOf('company', 'upsert').map((c) => c.args.create.name)).toEqual([DEMO_MATRIZ_NAME, DEMO_FILIAL_NAME]);
  });

  it('usuários nascem com mustChangePassword e hash (nunca senha em claro)', async () => {
    const fake = createFakePrisma();
    await seedDemo(fake.client, { password: PASSWORD });

    for (const c of fake.callsOf('user', 'upsert')) {
      expect(c.args.create.mustChangePassword).toBe(true);
      expect(c.args.create.passwordHash).toBe('$2a$10$hash-de-teste');
      expect(c.args.update).toEqual({});
    }
    expect(JSON.stringify(fake.calls)).not.toContain(PASSWORD);
  });
});
