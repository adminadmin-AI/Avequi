import 'reflect-metadata';
import { readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { PermissionGuard } from './permission.guard';
import {
  PERMISSIONS_CATALOG,
  OPERATOR_ONLY_MODULES,
} from '../../modules/iam/permissions.catalog';
import {
  SYSTEM_ROLES,
  resolveEffectivePermissions,
} from '../../modules/iam/roles.catalog';
import { OpsMfaGuard } from '../../modules/ops/ops-mfa.guard';
import { OpsSessionGuard } from '../../modules/ops/ops-session.guard';
import { OPS_THROTTLE } from '../../modules/ops/ops-hardening.constants';

/**
 * Suíte de isolamento cross-tenant — OPS WP7 (#914), absorve a #353.
 *
 * Com 5 tenants no mesmo banco, isolamento é CONTRATO, não feature. Esta
 * suíte transforma os incidentes históricos de IDOR (#36, #63, #216/#218) em
 * regressão permanente, provada contra a metadata REAL dos controllers e o
 * PermissionGuard REAL + catálogo REAL de perfis — nada de mock de decisão.
 *
 * A matriz de rotas é DESCOBERTA em runtime (glob de *.controller.ts +
 * metadata do Nest): endpoint novo nasce coberto sem editar este arquivo.
 * As três fronteiras de escalação exercitadas:
 *
 *   1. usuário comum → admin do tenant  (SOMENTE_LEITURA negado em mutação)
 *   2. admin do tenant → operadora      (TODO perfil de tenant negado em ops.*)
 *   3. operadora → dentro do tenant     (AVECCHI_OPERATOR negado no negócio)
 *
 * A fronteira de DADOS (query sem companyId) é o tenant-query-lint
 * (tenant-query-lint.spec.ts) — as duas suítes se completam: esta prova o
 * gate de ROTA; o lint prova o filtro de QUERY.
 */

const reflector = new Reflector();

// ─── Descoberta (matriz automática de rotas) ────────────────────────────────

interface RouteInfo {
  id: string; // Controller.handler
  controller: string;
  file: string; // relativo a src/modules
  cls: new (...args: any[]) => any;
  handler: (...args: unknown[]) => unknown;
  isPublic: boolean;
  required: string[]; // @RequirePermission (vazio = sem exigência RBAC v2)
  /** nomes de @Query('x')/@Param('x') declarados pelo handler */
  clientParamNames: string[];
}

// RouteParamtypes do Nest: BODY=3, QUERY=4, PARAM=5 (chaves "<tipo>:<índice>")
const QUERY_TYPE = '4';
const PARAM_TYPE = '5';

function findControllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...findControllerFiles(p));
    else if (entry.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

const MODULES_DIR = join(__dirname, '../../modules');

function discoverRoutes(): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const file of findControllerFiles(MODULES_DIR)) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(file);
    for (const cls of Object.values(mod) as any[]) {
      if (typeof cls !== 'function') continue;
      if (Reflect.getMetadata('path', cls) === undefined) continue; // não é @Controller
      const clsPublic = Reflect.getMetadata(IS_PUBLIC_KEY, cls);
      for (const name of Object.getOwnPropertyNames(cls.prototype)) {
        if (name === 'constructor') continue;
        const handler = cls.prototype[name];
        if (typeof handler !== 'function') continue;
        if (Reflect.getMetadata('path', handler) === undefined) continue; // não é rota
        const args =
          Reflect.getMetadata(ROUTE_ARGS_METADATA, cls, name) ?? ({} as any);
        const clientParamNames = Object.entries(args)
          .filter(([key]) => {
            const tipo = key.split(':')[0];
            return tipo === QUERY_TYPE || tipo === PARAM_TYPE;
          })
          .map(([, v]: [string, any]) => v?.data)
          .filter((data): data is string => typeof data === 'string');
        routes.push({
          id: `${cls.name}.${name}`,
          controller: cls.name,
          file: relative(MODULES_DIR, file).split(sep).join('/'),
          cls,
          handler,
          isPublic: !!(Reflect.getMetadata(IS_PUBLIC_KEY, handler) ?? clsPublic),
          required:
            reflector.get<string[]>(REQUIRE_PERMISSION_KEY, handler) ?? [],
          clientParamNames,
        });
      }
    }
  }
  return routes;
}

// ─── PermissionGuard REAL com o catálogo REAL de perfis ─────────────────────

function ctxFor(route: RouteInfo): ExecutionContext {
  return {
    getHandler: () => route.handler,
    getClass: () => route.cls,
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'u1', companyId: 'c1' } }),
    }),
  } as unknown as ExecutionContext;
}

async function guardAllows(route: RouteInfo, roleCode: string): Promise<boolean> {
  const permissionService = {
    getUserPermissions: jest.fn().mockResolvedValue({
      roles: [roleCode],
      permissions: resolveEffectivePermissions(roleCode),
    }),
  } as any;
  const guard = new PermissionGuard(reflector, permissionService);
  try {
    return await guard.canActivate(ctxFor(route));
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}

const defByCode = new Map(PERMISSIONS_CATALOG.map((d) => [d.code, d]));
const isOpsCode = (code: string) =>
  OPERATOR_ONLY_MODULES.includes(code.split('.')[0]);
const TENANT_ROLES = SYSTEM_ROLES.filter(
  (r) => r.code !== 'AVECCHI_OPERATOR',
).map((r) => r.code);

const routes = discoverRoutes();
const opsRoutes = routes.filter((r) => r.required.some(isOpsCode));
const tenantBusinessRoutes = routes.filter(
  (r) => r.required.length > 0 && !r.required.some(isOpsCode),
);
const mutationRoutes = tenantBusinessRoutes.filter((r) =>
  // rota é mutação se exige QUALQUER ação != view; código fora do catálogo
  // conta como mutação (conservador — nunca afrouxa por engano)
  r.required.some((code) => (defByCode.get(code)?.action ?? 'manage') !== 'view'),
);

describe('Isolamento cross-tenant — matriz automática (#914, absorve #353)', () => {
  it('sanidade do discovery: volume plausível de rotas em cada recorte', () => {
    // Se qualquer contagem despencar, o glob/metadata quebrou e a suíte
    // estaria passando VAZIA (falso verde) — melhor falhar aqui.
    expect(routes.length).toBeGreaterThan(300);
    expect(opsRoutes.length).toBeGreaterThan(15);
    expect(mutationRoutes.length).toBeGreaterThan(80);
  });

  // ── Incidentes #36/#63/#218: identificador de tenant vindo do cliente ─────
  it('nenhuma rota aceita companyId/tenantId via @Query ou @Param', () => {
    const PROIBIDOS = /^(companyid|company_id|company|tenantid|tenant_id|tenant)$/i;
    const offenders = routes
      .filter((r) => r.clientParamNames.some((n) => PROIBIDOS.test(n)))
      .map((r) => r.id);
    expect(offenders).toEqual([]);
  });

  // ── Invariantes do catálogo (a raiz das três fronteiras) ──────────────────
  it('nenhum perfil de tenant resolve QUALQUER permissão ops.*', () => {
    for (const role of TENANT_ROLES) {
      const vazamentos = resolveEffectivePermissions(role).filter(isOpsCode);
      expect({ role, vazamentos }).toEqual({ role, vazamentos: [] });
    }
  });

  it('AVECCHI_OPERATOR resolve SOMENTE ops.* (zero permissão intra-tenant)', () => {
    const efetivas = resolveEffectivePermissions('AVECCHI_OPERATOR');
    expect(efetivas.length).toBeGreaterThan(0);
    expect(efetivas.filter((c) => !isOpsCode(c))).toEqual([]);
  });

  it('SOMENTE_LEITURA resolve apenas ações view (nenhuma mutação no catálogo)', () => {
    const naoView = resolveEffectivePermissions('SOMENTE_LEITURA').filter(
      (code) => defByCode.get(code)?.action !== 'view',
    );
    expect(naoView).toEqual([]);
  });

  // ── Fronteira 1: usuário comum NÃO escala para admin do tenant ────────────
  it('🔒 SOMENTE_LEITURA é negado pelo PermissionGuard em TODA rota de mutação', async () => {
    const liberadas: string[] = [];
    for (const route of mutationRoutes) {
      if (await guardAllows(route, 'SOMENTE_LEITURA')) liberadas.push(route.id);
    }
    expect(liberadas).toEqual([]);
  });

  // ── Fronteira 2: admin do tenant NÃO enxerga o control plane ──────────────
  it('🔒 TODO perfil de tenant é negado em TODA rota ops.* (inclusive ADMIN_GLOBAL)', async () => {
    const liberadas: string[] = [];
    for (const route of opsRoutes) {
      for (const role of TENANT_ROLES) {
        if (await guardAllows(route, role)) liberadas.push(`${route.id}←${role}`);
      }
    }
    expect(liberadas).toEqual([]);
  });

  // ── Fronteira 3: operadora NÃO opera dentro do tenant sem perfil próprio ──
  it('🔒 AVECCHI_OPERATOR é negado em TODA rota de negócio do tenant', async () => {
    const liberadas: string[] = [];
    for (const route of tenantBusinessRoutes) {
      if (await guardAllows(route, 'AVECCHI_OPERATOR')) liberadas.push(route.id);
    }
    expect(liberadas).toEqual([]);
  });
});

// ─── Fronteira física do módulo ops (hardening WP7) ─────────────────────────

/** Controllers de modules/ops SEM a blindagem completa — allowlist EXATA.
 *  Cada um valida a si próprio e NÃO enxerga cross-tenant:
 *  - InviteController: aceite público de convite (token sha256 uso único);
 *  - BillingStatusController: self-service — status de cobrança da PRÓPRIA conta;
 *  - SupportAccessController: self-service — transparência de acessos do suporte. */
const OPS_SELF_SERVICE_ALLOWLIST = [
  'BillingStatusController',
  'InviteController',
  'SupportAccessController',
].sort();

describe('Fronteira do módulo ops — hardening obrigatório por default (#914)', () => {
  // Chave = a CLASSE (não o nome): existe BillingController no módulo finance
  // E no ops — filtrar por nome vazaria rotas de um para o teste do outro.
  const opsModuleControllers = [
    ...new Map(
      routes
        .filter((r) => r.file.startsWith('ops/'))
        .map((r) => [r.cls, r.controller] as const),
    ).entries(),
  ].map(([cls, name]) => [name, cls] as const);
  const protegidos = opsModuleControllers.filter(
    ([name]) => !OPS_SELF_SERVICE_ALLOWLIST.includes(name),
  );

  it('sanidade: módulo ops tem controllers protegidos descobertos', () => {
    expect(protegidos.length).toBeGreaterThanOrEqual(5);
  });

  it('allowlist self-service não estagna (controller removido/renomeado sai daqui)', () => {
    const nomes = new Set(opsModuleControllers.map(([name]) => name));
    expect(OPS_SELF_SERVICE_ALLOWLIST.filter((n) => !nomes.has(n))).toEqual([]);
  });

  for (const [name, cls] of protegidos) {
    describe(`${name}`, () => {
      it('tem OpsMfaGuard + OpsSessionGuard registrados (MFA duro + sessão curta)', () => {
        const guards = Reflect.getMetadata(GUARDS_METADATA, cls) ?? [];
        expect(guards).toContain(OpsMfaGuard);
        expect(guards).toContain(OpsSessionGuard);
      });

      it(`tem throttle dedicado mais restrito que o global (${OPS_THROTTLE.default.limit}/min < 60/min)`, () => {
        const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', cls);
        const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', cls);
        expect(limit).toBe(OPS_THROTTLE.default.limit);
        expect(ttl).toBe(OPS_THROTTLE.default.ttl);
        expect(limit).toBeLessThan(60);
      });

      it('toda rota exige exatamente uma permissão ops.* (nunca @Public)', () => {
        const doController = routes.filter((r) => r.cls === cls);
        expect(doController.length).toBeGreaterThan(0);
        for (const r of doController) {
          expect({ rota: r.id, isPublic: r.isPublic, required: r.required }).toEqual({
            rota: r.id,
            isPublic: false,
            required: [expect.stringMatching(/^ops\./)],
          });
        }
      });
    });
  }
});
