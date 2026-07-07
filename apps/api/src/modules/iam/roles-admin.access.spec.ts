import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { RolesAdminController } from './roles-admin.controller';
import { UserAccessController } from './user-access.controller';
import { resolveEffectivePermissions } from './roles.catalog';

/**
 * Acesso EFETIVO à administração de perfis/permissões (#352) — decisão Rafael.
 *
 * Prova, exercitando o PermissionGuard real contra a metadata real dos
 * controllers, que a matriz de produto funciona na prática:
 *   - iam.roles.view   → ADMIN_GLOBAL, ADMIN_EMPRESA, DIRETOR, AUDITOR
 *   - iam.roles.manage → ADMIN_GLOBAL, ADMIN_EMPRESA (não DIRETOR/AUDITOR)
 *   - iam.roles.assign → ADMIN_GLOBAL, ADMIN_EMPRESA (não DIRETOR/AUDITOR)
 *   - SOMENTE_LEITURA  → nenhum acesso
 *
 * E garante que o gate de enum legado (@Roles) foi REMOVIDO destes endpoints —
 * ele só reconhece SUPER_ADMIN/DIRECTOR e bloquearia ADMIN_EMPRESA/AUDITOR
 * (perfis só-RBAC-v2) antes de a permissão v2 resolver.
 */
const reflector = new Reflector();

interface Endpoint {
  name: string;
  handler: (...args: unknown[]) => unknown;
  required: string[];
  roles?: string[];
}

function endpointsOf(ControllerClass: new (...args: any[]) => any): Endpoint[] {
  const proto = ControllerClass.prototype;
  return Object.getOwnPropertyNames(proto)
    .filter((m) => m !== 'constructor' && typeof proto[m] === 'function')
    .map((m) => ({
      name: m,
      handler: proto[m],
      required: reflector.get<string[]>(REQUIRE_PERMISSION_KEY, proto[m]),
      roles: reflector.get<string[]>(ROLES_KEY, proto[m]),
    }))
    .filter((e) => Array.isArray(e.required) && e.required.length > 0);
}

function ctxFor(
  ControllerClass: new (...args: any[]) => any,
  handler: Endpoint['handler'],
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => ControllerClass,
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'u1', companyId: 'c1' } }),
    }),
  } as unknown as ExecutionContext;
}

/** Roda o guard como se o usuário tivesse o efetivo do perfil `roleCode`. */
async function canAccess(
  ControllerClass: new (...args: any[]) => any,
  handler: Endpoint['handler'],
  roleCode: string,
): Promise<boolean> {
  const permissionService = {
    getUserPermissions: jest.fn().mockResolvedValue({
      roles: [roleCode],
      permissions: resolveEffectivePermissions(roleCode),
    }),
  } as any;
  const guard = new PermissionGuard(reflector, permissionService);
  try {
    return await guard.canActivate(ctxFor(ControllerClass, handler));
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}

const CONTROLLERS = [
  { name: 'RolesAdminController', cls: RolesAdminController },
  { name: 'UserAccessController', cls: UserAccessController },
];

describe('IAM #352 — acesso efetivo a perfis/permissões (PermissionGuard + metadata real)', () => {
  it('nenhum endpoint de #352 usa @Roles (gate de enum legado removido)', () => {
    for (const { cls } of CONTROLLERS) {
      for (const ep of endpointsOf(cls)) {
        expect(ep.roles).toBeUndefined();
      }
    }
  });

  it('todo endpoint exige exatamente uma permissão iam.roles.* (view/manage/assign)', () => {
    for (const { cls } of CONTROLLERS) {
      for (const ep of endpointsOf(cls)) {
        expect(ep.required).toHaveLength(1);
        expect(['iam.roles.view', 'iam.roles.manage', 'iam.roles.assign']).toContain(
          ep.required[0],
        );
      }
    }
  });

  // Matriz completa: para cada endpoint e cada perfil, o acesso deve bater com
  // "o perfil tem a permissão exigida?".
  for (const { name, cls } of CONTROLLERS) {
    describe(`${name} — matriz por perfil`, () => {
      for (const ep of endpointsOf(cls)) {
        const perm = ep.required[0];
        for (const role of [
          'ADMIN_GLOBAL',
          'ADMIN_EMPRESA',
          'DIRETOR',
          'AUDITOR',
          'SOMENTE_LEITURA',
        ]) {
          const esperado = resolveEffectivePermissions(role).includes(perm);
          it(`${ep.name} (${perm}) — ${role} => ${esperado ? 'permite' : '403'}`, async () => {
            expect(await canAccess(cls, ep.handler, role)).toBe(esperado);
          });
        }
      }
    });
  }

  // Asserções de alto nível pedidas pela decisão de produto.
  describe('cenários da decisão de produto', () => {
    const rolesEp = endpointsOf(RolesAdminController);
    const userEp = endpointsOf(UserAccessController);
    const viewEp = [...rolesEp, ...userEp].filter((e) => e.required[0] === 'iam.roles.view');
    const manageEp = rolesEp.filter((e) => e.required[0] === 'iam.roles.manage');
    const assignEp = userEp.filter((e) => e.required[0] === 'iam.roles.assign');

    it('ADMIN_EMPRESA acessa/gerencia/atribui (todos os endpoints)', async () => {
      for (const ep of [...viewEp, ...manageEp, ...assignEp]) {
        expect(await canAccess(RolesAdminController, ep.handler, 'ADMIN_EMPRESA')).toBe(true);
      }
    });

    it('DIRETOR visualiza, mas recebe 403 em manage e assign', async () => {
      for (const ep of viewEp) {
        expect(await canAccess(RolesAdminController, ep.handler, 'DIRETOR')).toBe(true);
      }
      for (const ep of manageEp) {
        expect(await canAccess(RolesAdminController, ep.handler, 'DIRETOR')).toBe(false);
      }
      for (const ep of assignEp) {
        expect(await canAccess(UserAccessController, ep.handler, 'DIRETOR')).toBe(false);
      }
    });

    it('AUDITOR visualiza, mas recebe 403 em manage e assign', async () => {
      for (const ep of viewEp) {
        expect(await canAccess(RolesAdminController, ep.handler, 'AUDITOR')).toBe(true);
      }
      for (const ep of [...manageEp, ...assignEp]) {
        expect(await canAccess(RolesAdminController, ep.handler, 'AUDITOR')).toBe(false);
      }
    });

    it('SOMENTE_LEITURA não acessa nada (nem visualização)', async () => {
      for (const ep of [...viewEp, ...manageEp, ...assignEp]) {
        expect(await canAccess(RolesAdminController, ep.handler, 'SOMENTE_LEITURA')).toBe(false);
      }
    });
  });
});
