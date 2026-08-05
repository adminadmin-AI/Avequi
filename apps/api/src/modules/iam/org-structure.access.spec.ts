import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { OrgStructureController } from './org-structure.controller';
import { resolveEffectivePermissions } from './roles.catalog';

/**
 * Acesso EFETIVO à estrutura organizacional (#347 fase 1) — decisão Rafael.
 *
 * Prova, exercitando o PermissionGuard real contra a metadata real do
 * controller, que a matriz de produto funciona na prática (FASE 1: só cadastro
 * e vínculos, sem enforcement de escopo):
 *   - iam.org.view   → ADMIN_GLOBAL, ADMIN_EMPRESA, DIRETOR, RH, ADMIN_FILIAL, AUDITOR
 *   - iam.org.manage → ADMIN_GLOBAL, ADMIN_EMPRESA, DIRETOR (redesenha a estrutura)
 *   - iam.org.assign → ADMIN_GLOBAL, ADMIN_EMPRESA, DIRETOR, RH (aloca pessoas)
 *
 * E garante que NÃO há @Roles (gate de enum legado) nestes endpoints — ele só
 * reconhece SUPER_ADMIN/DIRECTOR/MANAGER e bloquearia ADMIN_EMPRESA/RH/
 * ADMIN_FILIAL/AUDITOR (perfis só-RBAC-v2) antes de a permissão v2 resolver.
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

function ctxFor(handler: Endpoint['handler']): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => OrgStructureController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'u1', companyId: 'c1' } }),
    }),
  } as unknown as ExecutionContext;
}

async function canAccess(handler: Endpoint['handler'], roleCode: string): Promise<boolean> {
  const permissionService = {
    // #946: o guard resolve pelo MESMO caminho do /auth/me/permissions.
    // Aqui o usuário sempre TEM perfil v2 (roleCode), então o fallback legado
    // não entra — a fronteira exercitada continua sendo a do RBAC v2.
    resolveWithLegacyFallback: jest.fn().mockResolvedValue({
      legacyFallback: false,
      resolved: {
        roles: [roleCode],
        permissions: resolveEffectivePermissions(roleCode),
      },
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

const ENDPOINTS = endpointsOf(OrgStructureController);

describe('IAM #347 fase 1 — acesso efetivo à estrutura organizacional', () => {
  it('nenhum endpoint de org usa @Roles (gate de enum legado removido)', () => {
    for (const ep of ENDPOINTS) {
      expect(ep.roles).toBeUndefined();
    }
  });

  it('todo endpoint exige exatamente uma permissão iam.org.* (view/manage/assign)', () => {
    expect(ENDPOINTS.length).toBeGreaterThan(0);
    for (const ep of ENDPOINTS) {
      expect(ep.required).toHaveLength(1);
      expect(['iam.org.view', 'iam.org.manage', 'iam.org.assign']).toContain(ep.required[0]);
    }
  });

  // Matriz completa: por endpoint × perfil, o acesso deve bater com "o perfil
  // tem a permissão exigida?".
  for (const ep of ENDPOINTS) {
    const perm = ep.required[0];
    for (const role of [
      'ADMIN_GLOBAL',
      'ADMIN_EMPRESA',
      'DIRETOR',
      'RH',
      'ADMIN_FILIAL',
      'AUDITOR',
      'SOMENTE_LEITURA',
      'VISITANTE',
    ]) {
      const esperado = resolveEffectivePermissions(role).includes(perm);
      it(`${ep.name} (${perm}) — ${role} => ${esperado ? 'permite' : '403'}`, async () => {
        expect(await canAccess(ep.handler, role)).toBe(esperado);
      });
    }
  }

  // Cenários de alto nível da decisão de produto.
  describe('cenários da decisão de produto', () => {
    const byPerm = (p: string) => ENDPOINTS.filter((e) => e.required[0] === p);
    const viewEp = byPerm('iam.org.view');
    const manageEp = byPerm('iam.org.manage');
    const assignEp = byPerm('iam.org.assign');

    const acessaTodos = async (role: string, eps: Endpoint[], esperado: boolean) => {
      for (const ep of eps) expect(await canAccess(ep.handler, role)).toBe(esperado);
    };

    it('ADMIN_GLOBAL/ADMIN_EMPRESA/DIRETOR: view + manage + assign', async () => {
      for (const role of ['ADMIN_GLOBAL', 'ADMIN_EMPRESA', 'DIRETOR']) {
        await acessaTodos(role, viewEp, true);
        await acessaTodos(role, manageEp, true);
        await acessaTodos(role, assignEp, true);
      }
    });

    it('RH: view e assign, mas 403 em manage (aloca pessoas, não redesenha estrutura)', async () => {
      await acessaTodos('RH', viewEp, true);
      await acessaTodos('RH', assignEp, true);
      await acessaTodos('RH', manageEp, false);
    });

    it('ADMIN_FILIAL: só view (403 em manage e assign)', async () => {
      await acessaTodos('ADMIN_FILIAL', viewEp, true);
      await acessaTodos('ADMIN_FILIAL', manageEp, false);
      await acessaTodos('ADMIN_FILIAL', assignEp, false);
    });

    it('AUDITOR: só view (403 em manage e assign)', async () => {
      await acessaTodos('AUDITOR', viewEp, true);
      await acessaTodos('AUDITOR', manageEp, false);
      await acessaTodos('AUDITOR', assignEp, false);
    });

    it('SOMENTE_LEITURA e VISITANTE: sem acesso a nada', async () => {
      for (const role of ['SOMENTE_LEITURA', 'VISITANTE']) {
        await acessaTodos(role, [...viewEp, ...manageEp, ...assignEp], false);
      }
    });
  });
});
