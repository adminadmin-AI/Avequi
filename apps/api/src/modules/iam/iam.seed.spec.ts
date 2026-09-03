/**
 * Testes do seed de IAM (#338/#339) — idempotência e reconciliação,
 * com Prisma FAKE em memória (convenção do repo: nunca banco real em unit test).
 */
import { seedIam, SEED_GRANTED_BY } from '../../../prisma/seeds/iam.seed';
import { PERMISSIONS_CATALOG } from './permissions.catalog';
import { SYSTEM_ROLES } from './roles.catalog';

interface FakeRecord {
  [key: string]: any;
}

function createFakePrisma(users: FakeRecord[] = []) {
  let seq = 0;
  const nextId = () => `id-${++seq}`;

  const permissions: FakeRecord[] = [];
  const roles: FakeRecord[] = [];
  const rolePermissions: FakeRecord[] = [];
  const userRoleAssignments: FakeRecord[] = [];

  const prisma = {
    permission: {
      upsert: jest.fn(async ({ where, update, create }: any) => {
        const found = permissions.find((p) => p.code === where.code);
        if (found) {
          Object.assign(found, update);
          return found;
        }
        const created = { id: nextId(), ...create };
        permissions.push(created);
        return created;
      }),
      findMany: jest.fn(async () => permissions.map((p) => ({ ...p }))),
    },
    role: {
      // Espelha o novo padrão do seed (findFirst por code+companyId, depois
      // create/update) — necessário porque com @@unique([companyId, code]) o
      // `code` não é mais unique isolado (#462).
      findFirst: jest.fn(async ({ where }: any) => {
        const found = roles.find(
          (r) =>
            r.code === where.code &&
            (r.companyId ?? null) === (where.companyId ?? null),
        );
        return found ? { ...found } : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const created = { id: nextId(), parentId: null, companyId: null, ...data };
        roles.push(created);
        return created;
      }),
      findMany: jest.fn(async ({ where }: any) => {
        const codes: string[] = where?.code?.in ?? [];
        return roles
          .filter((r) => codes.includes(r.code))
          .filter((r) => !('companyId' in (where ?? {})) || (r.companyId ?? null) === (where.companyId ?? null))
          .filter((r) => !('isSystem' in (where ?? {})) || !!r.isSystem === !!where.isSystem)
          .map((r) => ({ ...r }));
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const found = roles.find((r) => r.id === where.id);
        Object.assign(found, data);
        return found;
      }),
    },
    rolePermission: {
      findMany: jest.fn(async ({ where }: any) =>
        rolePermissions.filter((rp) => rp.roleId === where.roleId).map((rp) => ({ ...rp })),
      ),
      createMany: jest.fn(async ({ data }: any) => {
        for (const row of data) {
          const exists = rolePermissions.some(
            (rp) => rp.roleId === row.roleId && rp.permissionId === row.permissionId,
          );
          if (!exists) rolePermissions.push({ id: nextId(), ...row });
        }
        return { count: data.length };
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const ids: string[] = where.id.in;
        for (const id of ids) {
          const idx = rolePermissions.findIndex((rp) => rp.id === id);
          if (idx >= 0) rolePermissions.splice(idx, 1);
        }
        return { count: ids.length };
      }),
    },
    user: {
      findMany: jest.fn(async () => users.map((u) => ({ ...u }))),
    },
    userRoleAssignment: {
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where.userId_roleId_companyId;
        return (
          userRoleAssignments.find(
            (a) => a.userId === k.userId && a.roleId === k.roleId && a.companyId === k.companyId,
          ) ?? null
        );
      }),
      create: jest.fn(async ({ data }: any) => {
        const created = { id: nextId(), ...data };
        userRoleAssignments.push(created);
        return created;
      }),
    },
    _state: { permissions, roles, rolePermissions, userRoleAssignments, nextId },
  };
  return prisma;
}

const TOTAL_VINCULOS = SYSTEM_ROLES.reduce((acc, r) => acc + r.permissions.length, 0);

describe('Seed de IAM — idempotência (#338/#339)', () => {
  const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);

  afterAll(() => {
    consoleWarn.mockRestore();
    consoleLog.mockRestore();
  });

  it('primeira execução cria catálogo completo, perfis e vínculos', async () => {
    const prisma = createFakePrisma();
    const result = await seedIam(prisma as any);

    expect(result.permissionsUpserted).toBe(PERMISSIONS_CATALOG.length);
    expect(prisma._state.permissions.length).toBe(PERMISSIONS_CATALOG.length);
    expect(result.rolesUpserted).toBe(SYSTEM_ROLES.length);
    expect(prisma._state.roles.length).toBe(SYSTEM_ROLES.length);
    expect(result.rolePermissionsCreated).toBe(TOTAL_VINCULOS);
    expect(prisma._state.rolePermissions.length).toBe(TOTAL_VINCULOS);
    expect(result.rolePermissionsRemoved).toBe(0);
    expect(result.orphanPermissionCodes).toEqual([]);
  });

  it('re-execução NÃO duplica nada (idempotente)', async () => {
    const prisma = createFakePrisma();
    await seedIam(prisma as any);

    const snapshotPerms = prisma._state.permissions.length;
    const snapshotRoles = prisma._state.roles.length;
    const snapshotLinks = prisma._state.rolePermissions.length;

    const second = await seedIam(prisma as any);

    expect(prisma._state.permissions.length).toBe(snapshotPerms);
    expect(prisma._state.roles.length).toBe(snapshotRoles);
    expect(prisma._state.rolePermissions.length).toBe(snapshotLinks);
    expect(second.rolePermissionsCreated).toBe(0);
    expect(second.rolePermissionsRemoved).toBe(0);
    expect(second.userAssignmentsCreated).toBe(0);
  });

  it('perfis system são reconciliados: vínculo fora do catálogo é removido', async () => {
    const prisma = createFakePrisma();
    await seedIam(prisma as any);

    // Simula um vínculo "sujo" adicionado manualmente a um perfil system
    const visitante = prisma._state.roles.find((r) => r.code === 'VISITANTE');
    const permPagar = prisma._state.permissions.find((p) => p.code === 'finance.entries.pay');
    prisma._state.rolePermissions.push({
      id: prisma._state.nextId(),
      roleId: visitante.id,
      permissionId: permPagar.id,
      granted: true,
    });

    const result = await seedIam(prisma as any);
    expect(result.rolePermissionsRemoved).toBe(1);
    const doVisitante = prisma._state.rolePermissions.filter((rp) => rp.roleId === visitante.id);
    expect(doVisitante.some((rp) => rp.permissionId === permPagar.id)).toBe(false);
  });

  it('perfis customizados de empresa NUNCA são tocados', async () => {
    const prisma = createFakePrisma();
    await seedIam(prisma as any);

    // Perfil custom da empresa (companyId preenchido) com um vínculo próprio
    const permQualquer = prisma._state.permissions.find((p) => p.code === 'sales.orders.create');
    const customRole = {
      id: prisma._state.nextId(),
      code: 'COMPRADOR_JUNIOR_GDR',
      name: 'Comprador Júnior',
      isSystem: false,
      companyId: 'company-gdr',
      parentId: null,
    };
    prisma._state.roles.push(customRole);
    const customLink = {
      id: prisma._state.nextId(),
      roleId: customRole.id,
      permissionId: permQualquer.id,
      granted: true,
    };
    prisma._state.rolePermissions.push(customLink);

    await seedIam(prisma as any);

    expect(prisma._state.roles.find((r) => r.code === 'COMPRADOR_JUNIOR_GDR')).toBeDefined();
    expect(
      prisma._state.rolePermissions.filter((rp) => rp.roleId === customRole.id),
    ).toEqual([customLink]);
  });

  it('permissão órfã no banco (fora do catálogo) é avisada, não apagada', async () => {
    const prisma = createFakePrisma();
    await seedIam(prisma as any);
    prisma._state.permissions.push({
      id: prisma._state.nextId(),
      code: 'legacy.thing.view',
      name: 'Permissão antiga',
      module: 'legacy',
      resource: 'thing',
      action: 'view',
    });

    const result = await seedIam(prisma as any);
    expect(result.orphanPermissionCodes).toEqual(['legacy.thing.view']);
    expect(prisma._state.permissions.some((p) => p.code === 'legacy.thing.view')).toBe(true);
  });

  it('espelha User.role (enum) em UserRoleAssignment, sem duplicar em re-execução', async () => {
    const users = [
      { id: 'u1', role: 'SUPER_ADMIN', companyId: 'c1' },
      { id: 'u2', role: 'WAREHOUSE', companyId: 'c1' },
      { id: 'u3', role: 'STORE', companyId: 'c2' },
    ];
    const prisma = createFakePrisma(users);

    const first = await seedIam(prisma as any);
    expect(first.userAssignmentsCreated).toBe(3);
    expect(prisma._state.userRoleAssignments.length).toBe(3);
    expect(prisma._state.userRoleAssignments.every((a) => a.grantedBy === SEED_GRANTED_BY)).toBe(true);

    const roleLoja = prisma._state.roles.find((r) => r.code === 'LOJA_OPERACIONAL');
    const doU3 = prisma._state.userRoleAssignments.find((a) => a.userId === 'u3');
    expect(doU3.roleId).toBe(roleLoja.id);

    const second = await seedIam(prisma as any);
    expect(second.userAssignmentsCreated).toBe(0);
    expect(prisma._state.userRoleAssignments.length).toBe(3);
  });

  it('herança é persistida: SUPERVISOR_PRODUCAO aponta para OPERADOR_PRODUCAO', async () => {
    const prisma = createFakePrisma();
    await seedIam(prisma as any);

    const operador = prisma._state.roles.find((r) => r.code === 'OPERADOR_PRODUCAO');
    const supervisor = prisma._state.roles.find((r) => r.code === 'SUPERVISOR_PRODUCAO');
    expect(supervisor.parentId).toBe(operador.id);

    const semPai = prisma._state.roles.find((r) => r.code === 'ADMIN_GLOBAL');
    expect(semPai.parentId).toBeNull();
  });

  it('REGRESSÃO (Codex/#1151): Role CUSTOM de empresa com o MESMO code de um perfil system não é confundido com ele', async () => {
    // Usuário DIRECTOR da empresa X: precisa cair no perfil SYSTEM, não no custom
    const prisma = createFakePrisma([{ id: 'user-x', role: 'DIRECTOR', companyId: 'company-x' }]);
    await seedIam(prisma as any); // cria o catálogo system (e já espelha user-x no system)

    const systemDiretor = prisma._state.roles.find((r) => r.code === 'DIRETOR' && r.companyId == null && r.isSystem);
    const systemAdmin = prisma._state.roles.find((r) => r.code === 'ADMIN_GLOBAL' && r.companyId == null && r.isSystem);
    expect(systemDiretor).toBeDefined();
    const permA = prisma._state.permissions.find((p) => p.code === 'sales.orders.create');
    const permB = prisma._state.permissions.find((p) => p.code === 'sales.orders.view');

    // Perfil CUSTOM da empresa com o MESMO code 'DIRETOR', inserido DEPOIS do
    // system (cenário em que um Map por ordem de retorno pegaria o custom).
    const customDiretor = {
      id: prisma._state.nextId(),
      code: 'DIRETOR',
      name: 'Diretor Custom da Empresa X',
      description: 'custom',
      isSystem: false,
      isActive: true,
      companyId: 'company-x',
      parentId: 'custom-parent-id',
      requireMfa: true,
    };
    prisma._state.roles.push(customDiretor);
    const customLinks = [
      { id: prisma._state.nextId(), roleId: customDiretor.id, permissionId: permA.id, granted: true },
      { id: prisma._state.nextId(), roleId: customDiretor.id, permissionId: permB.id, granted: false },
    ];
    prisma._state.rolePermissions.push(...customLinks);
    const customSnapshot = JSON.stringify(customDiretor);
    const customLinksSnapshot = JSON.stringify(customLinks);

    // Remove a atribuição do 1º run para provar que o 2º run (com o custom presente) escolhe o SYSTEM
    prisma._state.userRoleAssignments.length = 0;

    // Derruba o parentId do system para provar que a reconciliação acerta o alvo certo
    systemDiretor.parentId = null;

    const result = await seedIam(prisma as any);

    // system reconciliado: herança conforme catálogo e vínculos completos
    const diretorCatalog = SYSTEM_ROLES.find((r) => r.code === 'DIRETOR')!;
    const expectedParent = diretorCatalog.parentCode
      ? prisma._state.roles.find((r) => r.code === diretorCatalog.parentCode && r.companyId == null && r.isSystem).id
      : null;
    expect(prisma._state.roles.find((r) => r.id === systemDiretor.id).parentId).toBe(expectedParent);
    expect(prisma._state.rolePermissions.filter((rp) => rp.roleId === systemDiretor.id).length).toBe(diretorCatalog.permissions.length);
    expect(systemAdmin).toBeDefined();

    // custom intacto: parentId, permissões, isSystem, companyId, nome, MFA
    expect(JSON.stringify(prisma._state.roles.find((r) => r.id === customDiretor.id))).toBe(customSnapshot);
    expect(JSON.stringify(prisma._state.rolePermissions.filter((rp) => rp.roleId === customDiretor.id))).toBe(customLinksSnapshot);
    expect(prisma.role.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: customDiretor.id } }));

    // usuário vinculado ao SYSTEM, nunca ao custom
    const assignments = prisma._state.userRoleAssignments.filter((a) => a.userId === 'user-x');
    expect(assignments).toHaveLength(1);
    expect(assignments[0].roleId).toBe(systemDiretor.id);
    expect(assignments.some((a) => a.roleId === customDiretor.id)).toBe(false);
    expect(result.usersSkipped).toBe(0);
  });

  it('dois perfis system GLOBAIS com o mesmo code (ambiguidade) → falha antes de reconciliar', async () => {
    const prisma = createFakePrisma();
    await seedIam(prisma as any);
    prisma._state.roles.push({ id: prisma._state.nextId(), code: 'DIRETOR', name: 'dup', isSystem: true, companyId: null, parentId: null });
    await expect(seedIam(prisma as any)).rejects.toThrow(/perfil system ambíguo.*DIRETOR/);
  });
});
