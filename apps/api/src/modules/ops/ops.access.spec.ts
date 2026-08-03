import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { resolveEffectivePermissions } from '../iam/roles.catalog';
import { OpsMfaGuard } from './ops-mfa.guard';
import { OpsController } from './ops.controller';

/**
 * OPS WP1 (#908) — fronteira do control plane provada contra a metadata REAL
 * do OpsController, exercitando o PermissionGuard de verdade:
 *
 *   - TODO endpoint /ops exige exatamente uma permissão ops.tenants.*;
 *   - AVECCHI_OPERATOR acessa; TODOS os perfis de tenant (inclusive
 *     ADMIN_GLOBAL, o "SUPER_ADMIN" do cliente) são barrados;
 *   - nenhum endpoint usa @Roles (gate de enum legado não existe aqui);
 *   - o OpsMfaGuard está registrado na classe (MFA duro além da permissão).
 */
const reflector = new Reflector();

interface Endpoint {
  name: string;
  handler: (...args: unknown[]) => unknown;
  required: string[];
  roles?: string[];
}

function endpointsOf(): Endpoint[] {
  const proto = OpsController.prototype as any;
  return Object.getOwnPropertyNames(proto)
    .filter((m) => m !== 'constructor' && typeof proto[m] === 'function')
    .map((m) => ({
      name: m,
      handler: proto[m],
      required: reflector.get<string[]>(REQUIRE_PERMISSION_KEY, proto[m]),
      roles: reflector.get<string[]>(ROLES_KEY, proto[m]),
    }));
}

function ctxFor(handler: Endpoint['handler']): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => OpsController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'u1', companyId: 'c1' } }),
    }),
  } as unknown as ExecutionContext;
}

async function canAccess(
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
    return await guard.canActivate(ctxFor(handler));
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}

const PERFIS_DE_TENANT_AMOSTRA = [
  'ADMIN_GLOBAL',
  'ADMIN_EMPRESA',
  'DIRETOR',
  'GERENTE_GERAL',
  'AUDITOR',
  'SOMENTE_LEITURA',
];

describe('OPS WP1 (#908) — fronteira do control plane (PermissionGuard + metadata real)', () => {
  it('o controller tem endpoints e TODOS exigem exatamente uma permissão ops.tenants.*', () => {
    const endpoints = endpointsOf();
    expect(endpoints.length).toBeGreaterThan(0);
    for (const ep of endpoints) {
      expect({ endpoint: ep.name, required: ep.required }).toEqual({
        endpoint: ep.name,
        required: [expect.stringMatching(/^ops\.tenants\./)],
      });
    }
  });

  it('nenhum endpoint usa @Roles (enum legado não gateia o control plane)', () => {
    for (const ep of endpointsOf()) {
      expect(ep.roles).toBeUndefined();
    }
  });

  it('OpsMfaGuard está registrado na classe do controller (MFA duro)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, OpsController) ?? [];
    expect(guards).toContain(OpsMfaGuard);
  });

  it('AVECCHI_OPERATOR acessa todos os endpoints /ops', async () => {
    for (const ep of endpointsOf()) {
      expect({
        endpoint: ep.name,
        allowed: await canAccess(ep.handler, 'AVECCHI_OPERATOR'),
      }).toEqual({ endpoint: ep.name, allowed: true });
    }
  });

  for (const role of PERFIS_DE_TENANT_AMOSTRA) {
    it(`🔒 ${role} (perfil de TENANT) é barrado em todos os endpoints /ops`, async () => {
      for (const ep of endpointsOf()) {
        expect({
          endpoint: ep.name,
          role,
          allowed: await canAccess(ep.handler, role),
        }).toEqual({ endpoint: ep.name, role, allowed: false });
      }
    });
  }
});
