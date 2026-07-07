import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { AnalyticsController } from './analytics.controller';
import { ReportController } from '../report/report.controller';
import { AuditController } from '../iam/audit.controller';
import { NotificationController } from '../notification/notification.controller';
import { resolveEffectivePermissions } from '../iam/roles.catalog';

/**
 * Acesso EFETIVO das rotas antes SEM gate — #341 parte 2 (PR A).
 *
 * Prova, exercitando o PermissionGuard real contra a metadata real dos
 * controllers, que:
 *  - analytics.controller  → toda rota exige analytics.dashboards.view;
 *  - report.controller     → export.execute / reports.view / reports.create;
 *  - iam/audit.controller  → iam.audit-logs.view SOZINHO (sem @Roles);
 *  - notification          → continua SEM gate (auto-escopo por @CurrentUser).
 * Nenhuma permissão nova: reutiliza os codes já existentes no catálogo.
 */
const reflector = new Reflector();

interface Endpoint {
  name: string;
  handler: (...args: unknown[]) => unknown;
  required?: string[];
  roles?: string[];
}

function methodsOf(ControllerClass: new (...args: any[]) => any): Endpoint[] {
  const proto = ControllerClass.prototype;
  return Object.getOwnPropertyNames(proto)
    .filter((m) => m !== 'constructor' && typeof proto[m] === 'function')
    .map((m) => ({
      name: m,
      handler: proto[m],
      required: reflector.get<string[]>(REQUIRE_PERMISSION_KEY, proto[m]),
      roles: reflector.get<string[]>(ROLES_KEY, proto[m]),
    }));
}

function guarded(ControllerClass: new (...args: any[]) => any): Endpoint[] {
  return methodsOf(ControllerClass).filter(
    (e) => Array.isArray(e.required) && e.required.length > 0,
  );
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

const TODOS_PERFIS = [
  'ADMIN_GLOBAL',
  'ADMIN_EMPRESA',
  'DIRETOR',
  'AUDITOR',
  'SOMENTE_LEITURA',
  'VENDEDOR',
  'ALMOXARIFE',
];

describe('#341 parte 2 (PR A) — acesso efetivo das rotas antes sem gate', () => {
  describe('analytics.controller — toda rota exige analytics.dashboards.view', () => {
    const eps = guarded(AnalyticsController);

    it('todas as rotas têm @RequirePermission(analytics.dashboards.view) e nenhuma @Roles', () => {
      expect(eps.length).toBe(8);
      for (const ep of eps) {
        expect(ep.required).toEqual(['analytics.dashboards.view']);
        expect(ep.roles).toBeUndefined();
      }
    });

    for (const ep of guarded(AnalyticsController)) {
      for (const role of TODOS_PERFIS) {
        const esperado = resolveEffectivePermissions(role).includes(
          'analytics.dashboards.view',
        );
        it(`${ep.name} — ${role} => ${esperado ? 'permite' : '403'}`, async () => {
          expect(await canAccess(AnalyticsController, ep.handler, role)).toBe(esperado);
        });
      }
    }
  });

  describe('report.controller — reutiliza analytics.* (export/view/create)', () => {
    const eps = guarded(ReportController);

    it('nenhuma rota usa @Roles; todas exigem analytics.{export.execute|reports.view|reports.create}', () => {
      expect(eps.length).toBe(13);
      for (const ep of eps) {
        expect(ep.roles).toBeUndefined();
        expect([
          'analytics.export.execute',
          'analytics.reports.view',
          'analytics.reports.create',
        ]).toContain(ep.required![0]);
      }
    });

    for (const ep of guarded(ReportController)) {
      const perm = ep.required![0];
      for (const role of ['ADMIN_EMPRESA', 'DIRETOR', 'AUDITOR', 'VENDEDOR']) {
        const esperado = resolveEffectivePermissions(role).includes(perm);
        it(`${ep.name} (${perm}) — ${role} => ${esperado ? 'permite' : '403'}`, async () => {
          expect(await canAccess(ReportController, ep.handler, role)).toBe(esperado);
        });
      }
    }
  });

  describe('iam/audit.controller — gate único iam.audit-logs.view (sem @Roles)', () => {
    const eps = guarded(AuditController);

    it('a rota exige iam.audit-logs.view e NÃO tem mais @Roles', () => {
      expect(eps.length).toBe(1);
      expect(eps[0].required).toEqual(['iam.audit-logs.view']);
      expect(eps[0].roles).toBeUndefined();
    });

    it('ADMIN_GLOBAL, ADMIN_EMPRESA e AUDITOR acessam; DIRETOR e READER = 403', async () => {
      const h = eps[0].handler;
      expect(await canAccess(AuditController, h, 'ADMIN_GLOBAL')).toBe(true);
      expect(await canAccess(AuditController, h, 'ADMIN_EMPRESA')).toBe(true);
      expect(await canAccess(AuditController, h, 'AUDITOR')).toBe(true);
      // Regra de produto preservada (#341): DIRETOR continua fora da auditoria.
      expect(await canAccess(AuditController, h, 'DIRETOR')).toBe(false);
      expect(await canAccess(AuditController, h, 'SOMENTE_LEITURA')).toBe(false);
    });
  });

  describe('notification.controller — permanece SEM gate (auto-escopo por @CurrentUser)', () => {
    it('nenhuma rota tem @RequirePermission nem @Roles (é "meu contexto")', () => {
      for (const ep of methodsOf(NotificationController)) {
        expect(ep.required).toBeUndefined();
        expect(ep.roles).toBeUndefined();
      }
    });
  });
});
