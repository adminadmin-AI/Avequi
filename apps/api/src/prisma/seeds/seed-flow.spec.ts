/**
 * Fluxo documentado, de ponta a ponta e sem banco: `db:seed` (estrutural)
 * → `db:seed:demo`. Usa o store em memória com os seeds REAIS (sem mock de
 * seedIam/seedPlans) para provar que cada usuário demo termina com o seu
 * UserRoleAssignment v2 e não depende do fallback legado de User.role.
 */
import * as bcrypt from 'bcryptjs';
import { createMemoryPrisma, DEMO_ONLY_MODELS, STRUCTURAL_CATALOG_MODELS } from './fake-prisma';
import { DEMO_COMPANY_CNPJS, DEMO_USERS } from '../../../prisma/seeds/demo.seed';
import { runDemoSeed, runStructuralSeed } from '../../../prisma/seeds/runners';
import { SeedBlockedError } from '../../../prisma/seeds/seed-guard';
import { SEED_GRANTED_BY } from '../../../prisma/seeds/user-role-mirror';
import { ENUM_ROLE_TO_SYSTEM_ROLE, SYSTEM_ROLES } from '../../modules/iam/roles.catalog';
import { CCLASSTRIB_TABLE } from '../../modules/tax/data/cclasstrib.data';

const DEV = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://dev:dev@localhost:5432/avequi_dev',
  CONFIRM_DEMO_SEED: 'true',
  SEED_USER_PASSWORD: 'Senha-De-Teste-Forte-123',
};

describe('fluxo db:seed → db:seed:demo (Onda 0 — higiene do seed IAM)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(bcrypt, 'hash').mockResolvedValue('$2a$10$hash-de-teste' as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('estrutural primeiro: catálogo IAM + cClassTrib + planos, zero Company/User', async () => {
    const db = createMemoryPrisma();
    const summary = await runStructuralSeed(db.client, DEV);

    expect(db.rows('role').filter((r) => r.isSystem && r.companyId == null)).toHaveLength(SYSTEM_ROLES.length);
    expect(db.rows('permission').length).toBe(summary.iam.permissionsUpserted);
    expect(db.rows('tributaryClassification')).toHaveLength(CCLASSTRIB_TABLE.length);
    expect(db.rows('plan').length).toBe(summary.plansUpserted);
    expect(db.rows('company')).toEqual([]);
    expect(db.rows('user')).toEqual([]);
    expect(db.rows('userRoleAssignment')).toEqual([]);
  });

  it('demo depois: cada usuário demo recebe o UserRoleAssignment v2 do perfil system equivalente', async () => {
    const db = createMemoryPrisma();
    await runStructuralSeed(db.client, DEV);
    const summary = await runDemoSeed(db.client, DEV);

    expect(summary.roleAssignmentsCreated).toBe(DEMO_USERS.length);
    const users = db.rows('user');
    expect(users).toHaveLength(DEMO_USERS.length);

    for (const demo of DEMO_USERS) {
      const user = users.find((u) => u.email === demo.email);
      expect(user).toBeDefined();

      const expectedCode = ENUM_ROLE_TO_SYSTEM_ROLE[demo.role as string];
      const systemRole = db.rows('role').find((r) => r.code === expectedCode && r.isSystem && r.companyId == null);
      expect(systemRole).toBeDefined();

      const assignments = db.rows('userRoleAssignment').filter((a) => a.userId === user.id);
      // RBAC v2 resolvido por atribuição própria — sem depender de User.role (fallback)
      expect(assignments).toHaveLength(1);
      expect(assignments[0]).toMatchObject({
        roleId: systemRole.id,
        companyId: user.companyId,
        grantedBy: SEED_GRANTED_BY,
      });
    }
  });

  it('demo não altera o catálogo estrutural criado pelo db:seed', async () => {
    const db = createMemoryPrisma();
    await runStructuralSeed(db.client, DEV);
    const snapshot = JSON.stringify({
      permission: db.rows('permission'),
      role: db.rows('role'),
      rolePermission: db.rows('rolePermission'),
      plan: db.rows('plan'),
      tributaryClassification: db.rows('tributaryClassification'),
    });

    await runDemoSeed(db.client, DEV);

    expect(
      JSON.stringify({
        permission: db.rows('permission'),
        role: db.rows('role'),
        rolePermission: db.rows('rolePermission'),
        plan: db.rows('plan'),
        tributaryClassification: db.rows('tributaryClassification'),
      }),
    ).toBe(snapshot);
  });

  it('rodar o demo duas vezes é idempotente (sem duplicar usuário nem atribuição)', async () => {
    const db = createMemoryPrisma();
    await runStructuralSeed(db.client, DEV);
    await runDemoSeed(db.client, DEV);
    const second = await runDemoSeed(db.client, DEV);

    expect(second.roleAssignmentsCreated).toBe(0);
    expect(db.rows('user')).toHaveLength(DEMO_USERS.length);
    expect(db.rows('userRoleAssignment')).toHaveLength(DEMO_USERS.length);
    expect(db.rows('company')).toHaveLength(2);
  });

  it('rodar o estrutural DEPOIS do demo não duplica as atribuições dos usuários demo', async () => {
    const db = createMemoryPrisma();
    await runStructuralSeed(db.client, DEV);
    await runDemoSeed(db.client, DEV);
    const again = await runStructuralSeed(db.client, DEV);

    expect(again.iam.userAssignmentsCreated).toBe(0);
    expect(again.iam.usersSkipped).toBe(0);
    expect(db.rows('userRoleAssignment')).toHaveLength(DEMO_USERS.length);
  });

  it('demo ANTES do estrutural (banco vazio): fail-fast com ZERO escrita — nenhuma população parcial', async () => {
    const db = createMemoryPrisma();
    await expect(runDemoSeed(db.client, DEV)).rejects.toThrow(/rode `npm run db:seed` \(estrutural\) antes de `npm run db:seed:demo`/);

    // modelo a modelo: nada do demo nem do catálogo existe
    for (const model of [...DEMO_ONLY_MODELS, 'userRoleAssignment', ...STRUCTURAL_CATALOG_MODELS]) {
      expect(db.rows(model)).toEqual([]);
    }
    // robusto: o store inteiro está vazio e as ÚNICAS chamadas foram leituras (preflight de conteúdo + perfis)
    expect(Object.values(db.store).flat()).toEqual([]);
    expect(db.calls.map((c) => `${c.model}.${c.method}`)).toEqual(['company.findMany', 'user.findMany', 'role.findMany']);
  });

  it('TÚNEL/PROXY simulado pelo CONTEÚDO: localhost + development + confirmação, mas o banco tem Company/User não-demo → bloqueado, ZERO escrita', async () => {
    const db = createMemoryPrisma();
    await runStructuralSeed(db.client, DEV);
    // "banco real" atrás de um localhost: uma empresa e um usuário que não são o demo canônico
    db.rows('company').push({ id: 'real-co', name: 'Empresa Real Qualquer', cnpj: '00.000.000/0001-00' });
    db.rows('user').push({ id: 'real-user', email: 'pessoa@empresa-real.example', role: 'DIRECTOR', companyId: 'real-co' });
    const snapshot = JSON.stringify(db.store);
    const callsBefore = db.calls.length;

    await expect(runDemoSeed(db.client, DEV)).rejects.toThrow(SeedBlockedError);
    await expect(runDemoSeed(db.client, DEV)).rejects.toThrow(/entidades NÃO-demo \(1 empresa\(s\), 1 usuário\(s\)\)/);

    expect(JSON.stringify(db.store)).toBe(snapshot); // nada mudou
    const newCalls = db.calls.slice(callsBefore).map((c) => `${c.model}.${c.method}`);
    expect(newCalls.every((c) => c.endsWith('.findMany'))).toBe(true); // só leituras
    expect(db.rows('userRoleAssignment')).toEqual([]);
  });

  it('conteúdo não-demo: basta UM usuário não-demo (mesmo com empresas demo) para bloquear', async () => {
    const db = createMemoryPrisma();
    await runStructuralSeed(db.client, DEV);
    await runDemoSeed(db.client, DEV); // ambiente demo canônico
    db.rows('user').push({ id: 'intruso', email: 'alguem@outra-empresa.example', role: 'STORE', companyId: db.rows('company')[0].id });
    const snapshot = JSON.stringify(db.store);

    await expect(runDemoSeed(db.client, DEV)).rejects.toThrow(/entidades NÃO-demo \(0 empresa\(s\), 1 usuário\(s\)\)/);
    expect(JSON.stringify(db.store)).toBe(snapshot);
  });

  it('a mensagem de bloqueio por conteúdo não expõe e-mail, nome, CNPJ nem URL', async () => {
    const db = createMemoryPrisma();
    await runStructuralSeed(db.client, DEV);
    db.rows('company').push({ id: 'real-co', name: 'Nome Sensível Ltda', cnpj: '11.111.111/0001-11' });
    db.rows('user').push({ id: 'real-user', email: 'segredo@pessoa.example', role: 'DIRECTOR', companyId: 'real-co' });
    let message = '';
    try {
      await runDemoSeed(db.client, DEV);
    } catch (e) {
      message = String((e as Error).message);
    }
    expect(message).toMatch(/NÃO-demo/);
    for (const forbidden of ['segredo@pessoa.example', 'Nome Sensível', '11.111.111', 'postgresql://', 'localhost']) {
      expect(message).not.toContain(forbidden);
    }
  });

  it('rerun em banco que contém SOMENTE o demo canônico é permitido e reconhecido positivamente', async () => {
    const db = createMemoryPrisma();
    await runStructuralSeed(db.client, DEV);
    await runDemoSeed(db.client, DEV);
    expect(db.rows('company').map((c) => c.cnpj).sort()).toEqual([...DEMO_COMPANY_CNPJS].sort());
    expect(db.rows('user').map((u) => u.email).sort()).toEqual(DEMO_USERS.map((u) => u.email).sort());
    await expect(runDemoSeed(db.client, DEV)).resolves.toMatchObject({ roleAssignmentsCreated: 0 });
  });

  it('demo com perfis system parcialmente presentes: também falha antes de qualquer escrita', async () => {
    const db = createMemoryPrisma();
    await runStructuralSeed(db.client, DEV);
    // simula catálogo incompleto: remove o perfil do vendedor demo (STORE → LOJA_OPERACIONAL)
    db.store.role = db.rows('role').filter((r) => r.code !== ENUM_ROLE_TO_SYSTEM_ROLE.STORE);
    const callsBefore = db.calls.length;

    await expect(runDemoSeed(db.client, DEV)).rejects.toThrow(/perfis system ausentes \(LOJA_OPERACIONAL\)/);

    expect(db.rows('company')).toEqual([]);
    expect(db.rows('user')).toEqual([]);
    expect(db.rows('userRoleAssignment')).toEqual([]);
    expect(db.calls.slice(callsBefore).map((c) => `${c.model}.${c.method}`)).toEqual(['company.findMany', 'user.findMany', 'role.findMany']);
  });
});
