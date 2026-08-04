import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { resolveEffectivePermissions } from '../iam/roles.catalog';
import { InviteController } from './invite.controller';
import { OpsMfaGuard } from './ops-mfa.guard';
import { BillingController } from './billing.controller';
import { ImpersonationController } from './impersonation.controller';
import { OpsPanelController } from './ops-panel.controller';
import { OpsController } from './ops.controller';
import { PlansController } from './plans.controller';
import { ProposalsController } from './proposals.controller';

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

/** Controllers PROTEGIDOS do control plane — todo novo controller /ops entra aqui.
 *  WP7 (#914): a lista não estagna — o teste "lista manual = descoberta
 *  automática" abaixo compara com o glob de modules/ops e quebra se um
 *  controller novo nascer fora daqui (a blindagem por default é provada no
 *  tenant-isolation.sweep.spec, que descobre sozinho). */
const OPS_CONTROLLERS: Array<{ name: string; cls: new (...args: any[]) => any }> = [
  { name: 'OpsController', cls: OpsController },
  { name: 'OpsPanelController', cls: OpsPanelController },
  { name: 'PlansController', cls: PlansController },
  { name: 'BillingController', cls: BillingController },
  { name: 'ImpersonationController', cls: ImpersonationController },
  { name: 'ProposalsController', cls: ProposalsController },
];

/** Self-service/público por design (cada um valida a si próprio; sem visão
 *  cross-tenant) — mesma allowlist do tenant-isolation.sweep.spec. */
const OPS_SELF_SERVICE = ['BillingStatusController', 'InviteController', 'SupportAccessController'];

function endpointsOf(cls: new (...args: any[]) => any): Endpoint[] {
  const proto = cls.prototype as any;
  return Object.getOwnPropertyNames(proto)
    .filter((m) => m !== 'constructor' && typeof proto[m] === 'function')
    // Só ROTAS de verdade (têm metadata 'path' do @Get/@Post/@Patch) — helpers
    // privados do controller ficam fora, e uma rota SEM @RequirePermission
    // continua sendo pega pelo primeiro teste (required undefined ≠ ops.*).
    .filter((m) => Reflect.getMetadata('path', proto[m]) !== undefined)
    .map((m) => ({
      name: m,
      handler: proto[m],
      required: reflector.get<string[]>(REQUIRE_PERMISSION_KEY, proto[m]),
      roles: reflector.get<string[]>(ROLES_KEY, proto[m]),
    }));
}

function ctxFor(
  cls: new (...args: any[]) => any,
  handler: Endpoint['handler'],
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'u1', companyId: 'c1' } }),
    }),
  } as unknown as ExecutionContext;
}

async function canAccess(
  cls: new (...args: any[]) => any,
  handler: Endpoint['handler'],
  roleCode: string,
): Promise<boolean> {
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
    return await guard.canActivate(ctxFor(cls, handler));
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

describe('OPS WP1/WP3 (#908/#910) — fronteira do control plane (PermissionGuard + metadata real)', () => {
  it('WP7 (#914): lista manual = descoberta automática de modules/ops (não estagna)', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const descobertos: string[] = [];
    for (const entry of fs.readdirSync(__dirname)) {
      if (!entry.endsWith('.controller.ts')) continue;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(path.join(__dirname, entry));
      for (const cls of Object.values(mod) as any[]) {
        if (typeof cls !== 'function') continue;
        if (Reflect.getMetadata('path', cls) === undefined) continue;
        descobertos.push(cls.name);
      }
    }
    const esperados = [...OPS_CONTROLLERS.map((c) => c.name), ...OPS_SELF_SERVICE].sort();
    expect(descobertos.sort()).toEqual(esperados);
  });

  for (const { name, cls } of OPS_CONTROLLERS) {
    it(`${name}: tem endpoints e TODOS exigem exatamente uma permissão ops.*`, () => {
      const endpoints = endpointsOf(cls);
      expect(endpoints.length).toBeGreaterThan(0);
      for (const ep of endpoints) {
        expect({ endpoint: ep.name, required: ep.required }).toEqual({
          endpoint: ep.name,
          // WP4 (#911) somou ops.plans.* — o invariante segue: namespace ops.
          required: [expect.stringMatching(/^ops\./)],
        });
      }
    });

    it(`${name}: nenhum endpoint usa @Roles (enum legado não gateia o control plane)`, () => {
      for (const ep of endpointsOf(cls)) {
        expect(ep.roles).toBeUndefined();
      }
    });

    it(`${name}: OpsMfaGuard está registrado na classe (MFA duro)`, () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, cls) ?? [];
      expect(guards).toContain(OpsMfaGuard);
    });

    it(`${name}: AVECCHI_OPERATOR acessa todos os endpoints`, async () => {
      for (const ep of endpointsOf(cls)) {
        expect({
          endpoint: ep.name,
          allowed: await canAccess(cls, ep.handler, 'AVECCHI_OPERATOR'),
        }).toEqual({ endpoint: ep.name, allowed: true });
      }
    });

    for (const role of PERFIS_DE_TENANT_AMOSTRA) {
      it(`🔒 ${name}: ${role} (perfil de TENANT) é barrado em todos os endpoints`, async () => {
        for (const ep of endpointsOf(cls)) {
          expect({
            endpoint: ep.name,
            role,
            allowed: await canAccess(cls, ep.handler, role),
          }).toEqual({ endpoint: ep.name, role, allowed: false });
        }
      });
    }
  }

  // ── OPS WP2 (#909): aceite público de convite ──────────────────────────────

  it('InviteController.accept é @Public (aceite acontece antes de existir credencial)', () => {
    const isPublic = reflector.get<boolean>(
      IS_PUBLIC_KEY,
      InviteController.prototype.accept,
    );
    expect(isPublic).toBe(true);
  });

  it('InviteController NÃO tem o OpsMfaGuard (guard não respeita @Public, by design)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, InviteController) ?? [];
    expect(guards).not.toContain(OpsMfaGuard);
  });
});
