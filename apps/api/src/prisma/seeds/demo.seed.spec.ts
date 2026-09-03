import * as bcrypt from 'bcryptjs';
import { createFakePrisma } from './fake-prisma';
import {
  DEMO_ADMIN_EMAIL,
  DEMO_EMAIL_DOMAIN,
  DEMO_FILIAL_NAME,
  DEMO_MATRIZ_NAME,
  DEMO_USERS,
  seedDemo,
} from '../../../prisma/seeds/demo.seed';
import { REAL_COMPANY_MARKERS } from '../../../prisma/seeds/seed-guard';

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

    expect(summary).toEqual({ companies: 2, users: DEMO_USERS.length });
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

  it('NÃO toca no que é estrutural (cClassTrib, permissões, perfis, planos)', async () => {
    const fake = createFakePrisma();
    await seedDemo(fake.client, { password: PASSWORD });
    for (const model of ['tributaryClassification', 'permission', 'role', 'rolePermission', 'userRoleAssignment', 'plan']) {
      expect(fake.modelsTouched()).not.toContain(model);
    }
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

  it('nenhuma escrita do demo contém identidade real (e-mail ou nome de empresa)', async () => {
    const fake = createFakePrisma();
    await seedDemo(fake.client, { password: PASSWORD });

    const payload = JSON.stringify(fake.calls);
    expect(payload).not.toMatch(/gdr\.com\.br/i);
    expect(payload).not.toMatch(/crd\.com\.br/i);
    expect(payload).not.toMatch(/GDR Reboques/i);
    expect(payload).not.toMatch(/\bGDR\b/);
    expect(payload).not.toMatch(/\bCRD\b/);

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
