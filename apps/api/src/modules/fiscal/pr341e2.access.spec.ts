import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { FiscalController } from './fiscal.controller';
import { ManifestController } from '../manifest/manifest.controller';
import { TaxRuleController } from '../tax/tax-rule.controller';
import { TributaryClassificationController } from '../tax/tributary-classification.controller';
import { InboundNfeController } from '../inbound-nfe/inbound-nfe.controller';
import { LgpdController } from '../lgpd/lgpd.controller';
import { ApprovalController } from '../approval/approval.controller';
import { resolveEffectivePermissions } from '../iam/roles.catalog';

/**
 * Matriz do Bloco E2+E3 (fiscal + compliance) — #341 parte 2, issue #623.
 *
 * Trava, exercitando o PermissionGuard REAL contra a metadata REAL dos 7
 * controllers, as decisões do Rafael (09/07/2026):
 *  - gate ÚNICO RBAC v2 — nenhum @Roles sobrou;
 *  - FISCAL é o dono da operação (eventos NF-e, manifestar, inbound completo,
 *    export) — sem tax-rules CUD e sem tributary sync;
 *  - GERENTE_FINANCEIRO perdeu o fiscal operacional amplo (herança #463):
 *    fica só com documents.view/export + manifestation.view + tax-rules.view;
 *  - DIRETOR mantém tax-rules create/update/delete (regras tributárias são
 *    estratégicas — decisão explícita), sem eventos NF-e;
 *  - fiscal.tributary-classifications.sync: SOMENTE ADMIN_GLOBAL;
 *  - SOMENTE_LEITURA perdeu fiscal.tax-rules.view (leitura restrita 🔒);
 *  - anonimização LGPD (irreversível): DIRETOR+admins; G.GERAL fora da LGPD;
 *  - FIX: os 4 GETs da manifestação estavam SEM gate;
 *  - POST /fiscal/webhook segue @Public por desenho (secret fail-closed).
 */
const reflector = new Reflector();

type Ctor = new (...args: any[]) => any;

interface Endpoint {
  name: string;
  handler: (...args: unknown[]) => unknown;
  required?: string[];
  roles?: string[];
}

function methodsOf(ControllerClass: Ctor): Endpoint[] {
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

function ctxFor(ControllerClass: Ctor, handler: Endpoint['handler']): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => ControllerClass,
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'u1', companyId: 'c1' } }),
    }),
  } as unknown as ExecutionContext;
}

async function canAccess(
  ControllerClass: Ctor,
  handlerName: string,
  roleCode: string,
): Promise<boolean> {
  const handler = ControllerClass.prototype[handlerName];
  if (!handler) throw new Error(`Handler '${handlerName}' não existe em ${ControllerClass.name}`);
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

/** Matriz rota → permissão aprovada pelo Rafael (issue #623, decisões E2/E3). */
const MATRIZ: Array<[Ctor, string, Record<string, string>]> = [
  [FiscalController, 'fiscal', {
    compliance: 'fiscal.documents.view',
    cancel: 'fiscal.nfe.cancel',
    correction: 'fiscal.nfe.correct',
    returnNote: 'fiscal.nfe.return-note', // #747 — NF-e de devolução referenciada
    voidRange: 'fiscal.nfe.void-range',
    retry: 'fiscal.nfe.retry',
    findAll: 'fiscal.documents.view',
    export: 'fiscal.documents.export',
    findOne: 'fiscal.documents.view',
  }],
  [ManifestController, 'manifest', {
    findPending: 'fiscal.manifestation.view',
    getStats: 'fiscal.manifestation.view',
    findOverdue: 'fiscal.manifestation.view',
    findAll: 'fiscal.manifestation.view',
    sync: 'fiscal.manifestation.sync',
    ciencia: 'fiscal.manifestation.execute',
    confirm: 'fiscal.manifestation.execute',
    reject: 'fiscal.manifestation.execute',
    unknown: 'fiscal.manifestation.execute',
  }],
  [TaxRuleController, 'tax-rule', {
    create: 'fiscal.tax-rules.create',
    findAll: 'fiscal.tax-rules.view',
    findOne: 'fiscal.tax-rules.view',
    update: 'fiscal.tax-rules.update',
    remove: 'fiscal.tax-rules.delete',
  }],
  [TributaryClassificationController, 'tributary-classification', {
    findAll: 'fiscal.tributary-classifications.view',
    findByCode: 'fiscal.tributary-classifications.view',
    sync: 'fiscal.tributary-classifications.sync',
  }],
  [InboundNfeController, 'inbound-nfe', {
    upload: 'purchases.inbound-nfe.upload',
    getStats: 'purchases.inbound-nfe.view',
    list: 'purchases.inbound-nfe.view',
    getById: 'purchases.inbound-nfe.view',
    matchToPo: 'purchases.inbound-nfe.match',
    reject: 'purchases.inbound-nfe.reject',
    importAsGr: 'purchases.inbound-nfe.import',
  }],
  [LgpdController, 'lgpd', {
    registerConsent: 'lgpd.consents.create',
    revokeConsent: 'lgpd.consents.revoke',
    listConsents: 'lgpd.consents.view',
    getDataSubject: 'lgpd.data-subjects.view',
    requestAnonymization: 'lgpd.anonymization.request',
    processAnonymization: 'lgpd.anonymization.process',
    listRequests: 'lgpd.anonymization.view',
  }],
  [ApprovalController, 'approval', {
    approve: 'approvals.requests.approve',
    getPending: 'approvals.requests.view',
  }],
];

describe('#341 parte 2 (PR E2/E3) — matriz fiscal + compliance (issue #623)', () => {
  describe('metadata: rota → permissão exata, sem @Roles residual', () => {
    for (const [Ctrl, nome, esperado] of MATRIZ) {
      it(`${nome}: todas as rotas gated conforme a matriz aprovada`, () => {
        const eps = methodsOf(Ctrl).filter((e) => e.name !== 'webhook');
        expect(eps.map((e) => e.name).sort()).toEqual(Object.keys(esperado).sort());
        for (const ep of eps) {
          expect(ep.required).toEqual([esperado[ep.name]]);
          expect(ep.roles).toBeUndefined();
        }
      });
    }

    it('POST /fiscal/webhook segue @Public por desenho (secret fail-closed), sem RBAC', () => {
      const handler = FiscalController.prototype['webhook'];
      expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBe(true);
      expect(reflector.get<string[]>(REQUIRE_PERMISSION_KEY, handler)).toBeUndefined();
      expect(reflector.get<string[]>(ROLES_KEY, handler)).toBeUndefined();
    });
  });

  describe('FISCAL é o dono da operação fiscal', () => {
    it('executa eventos NF-e, manifesta, exporta e opera inbound completo', async () => {
      expect(await canAccess(FiscalController, 'cancel', 'FISCAL')).toBe(true);
      expect(await canAccess(FiscalController, 'correction', 'FISCAL')).toBe(true);
      expect(await canAccess(FiscalController, 'voidRange', 'FISCAL')).toBe(true);
      expect(await canAccess(FiscalController, 'retry', 'FISCAL')).toBe(true);
      expect(await canAccess(FiscalController, 'export', 'FISCAL')).toBe(true);
      expect(await canAccess(ManifestController, 'sync', 'FISCAL')).toBe(true);
      expect(await canAccess(ManifestController, 'confirm', 'FISCAL')).toBe(true);
      expect(await canAccess(InboundNfeController, 'upload', 'FISCAL')).toBe(true);
      expect(await canAccess(InboundNfeController, 'importAsGr', 'FISCAL')).toBe(true);
    });

    it('NÃO edita regras tributárias nem sincroniza a tabela nacional', async () => {
      expect(await canAccess(TaxRuleController, 'create', 'FISCAL')).toBe(false);
      expect(await canAccess(TaxRuleController, 'update', 'FISCAL')).toBe(false);
      expect(await canAccess(TaxRuleController, 'remove', 'FISCAL')).toBe(false);
      expect(await canAccess(TaxRuleController, 'findAll', 'FISCAL')).toBe(true);
      expect(await canAccess(TributaryClassificationController, 'sync', 'FISCAL')).toBe(false);
    });
  });

  describe('GERENTE_FINANCEIRO perdeu o fiscal operacional (decisão Rafael E2)', () => {
    it('mantém as 4 leituras fiscais', async () => {
      expect(await canAccess(FiscalController, 'findAll', 'GERENTE_FINANCEIRO')).toBe(true);
      expect(await canAccess(FiscalController, 'compliance', 'GERENTE_FINANCEIRO')).toBe(true);
      expect(await canAccess(FiscalController, 'export', 'GERENTE_FINANCEIRO')).toBe(true);
      expect(await canAccess(ManifestController, 'findAll', 'GERENTE_FINANCEIRO')).toBe(true);
      expect(await canAccess(TaxRuleController, 'findAll', 'GERENTE_FINANCEIRO')).toBe(true);
    });

    it('NÃO executa eventos NF-e, NÃO manifesta, NÃO edita tax-rules, NÃO sincroniza', async () => {
      expect(await canAccess(FiscalController, 'cancel', 'GERENTE_FINANCEIRO')).toBe(false);
      expect(await canAccess(FiscalController, 'correction', 'GERENTE_FINANCEIRO')).toBe(false);
      expect(await canAccess(FiscalController, 'retry', 'GERENTE_FINANCEIRO')).toBe(false);
      expect(await canAccess(FiscalController, 'voidRange', 'GERENTE_FINANCEIRO')).toBe(false);
      expect(await canAccess(ManifestController, 'sync', 'GERENTE_FINANCEIRO')).toBe(false);
      expect(await canAccess(ManifestController, 'confirm', 'GERENTE_FINANCEIRO')).toBe(false);
      expect(await canAccess(TaxRuleController, 'create', 'GERENTE_FINANCEIRO')).toBe(false);
      expect(await canAccess(TaxRuleController, 'update', 'GERENTE_FINANCEIRO')).toBe(false);
      expect(await canAccess(TaxRuleController, 'remove', 'GERENTE_FINANCEIRO')).toBe(false);
      expect(await canAccess(TributaryClassificationController, 'sync', 'GERENTE_FINANCEIRO')).toBe(false);
    });

    it('inbound-nfe segue completo (família purchases, fora do corte)', async () => {
      expect(await canAccess(InboundNfeController, 'importAsGr', 'GERENTE_FINANCEIRO')).toBe(true);
    });
  });

  describe('DIRETOR: estratégia sim, operação não', () => {
    it('mantém tax-rules create/update/delete (regras tributárias são estratégicas)', async () => {
      expect(await canAccess(TaxRuleController, 'create', 'DIRETOR')).toBe(true);
      expect(await canAccess(TaxRuleController, 'update', 'DIRETOR')).toBe(true);
      expect(await canAccess(TaxRuleController, 'remove', 'DIRETOR')).toBe(true);
    });

    it('NÃO executa eventos NF-e nem manifesta nem exporta massa fiscal', async () => {
      expect(await canAccess(FiscalController, 'cancel', 'DIRETOR')).toBe(false);
      expect(await canAccess(FiscalController, 'voidRange', 'DIRETOR')).toBe(false);
      expect(await canAccess(ManifestController, 'confirm', 'DIRETOR')).toBe(false);
      expect(await canAccess(FiscalController, 'export', 'DIRETOR')).toBe(false);
    });

    it('LGPD: anonimização (irreversível) é DIRETOR+admins; aprova alçadas', async () => {
      expect(await canAccess(LgpdController, 'requestAnonymization', 'DIRETOR')).toBe(true);
      expect(await canAccess(LgpdController, 'processAnonymization', 'DIRETOR')).toBe(true);
      expect(await canAccess(ApprovalController, 'approve', 'DIRETOR')).toBe(true);
    });
  });

  describe('tributary-classifications.sync: SOMENTE ADMIN_GLOBAL', () => {
    it('ADMIN_GLOBAL sim; ADMIN_EMPRESA/G.FINANCEIRO/FISCAL/DIRETOR não', async () => {
      expect(await canAccess(TributaryClassificationController, 'sync', 'ADMIN_GLOBAL')).toBe(true);
      expect(await canAccess(TributaryClassificationController, 'sync', 'ADMIN_EMPRESA')).toBe(false);
      expect(await canAccess(TributaryClassificationController, 'sync', 'DIRETOR')).toBe(false);
    });
  });

  describe('perfis restritos', () => {
    it('AUDITOR: vê e exporta, não executa nenhum evento/mutação', async () => {
      expect(await canAccess(FiscalController, 'findAll', 'AUDITOR')).toBe(true);
      expect(await canAccess(FiscalController, 'export', 'AUDITOR')).toBe(true);
      expect(await canAccess(ManifestController, 'findAll', 'AUDITOR')).toBe(true);
      expect(await canAccess(FiscalController, 'cancel', 'AUDITOR')).toBe(false);
      expect(await canAccess(ManifestController, 'sync', 'AUDITOR')).toBe(false);
      expect(await canAccess(TaxRuleController, 'update', 'AUDITOR')).toBe(false);
      expect(await canAccess(LgpdController, 'processAnonymization', 'AUDITOR')).toBe(false);
      expect(await canAccess(ApprovalController, 'approve', 'AUDITOR')).toBe(false);
    });

    it('SOMENTE_LEITURA: perdeu tax-rules.view; mantém leituras fiscais comuns; fora da LGPD', async () => {
      expect(await canAccess(TaxRuleController, 'findAll', 'SOMENTE_LEITURA')).toBe(false);
      expect(await canAccess(FiscalController, 'findAll', 'SOMENTE_LEITURA')).toBe(true);
      expect(await canAccess(ManifestController, 'findAll', 'SOMENTE_LEITURA')).toBe(true);
      expect(await canAccess(TributaryClassificationController, 'findAll', 'SOMENTE_LEITURA')).toBe(true);
      expect(await canAccess(LgpdController, 'listConsents', 'SOMENTE_LEITURA')).toBe(false);
      expect(await canAccess(ApprovalController, 'getPending', 'SOMENTE_LEITURA')).toBe(false);
    });

    it('G.GERAL: fora da LGPD (legado MANAGER tinha); mantém aprovações e inbound', async () => {
      expect(await canAccess(LgpdController, 'listConsents', 'GERENTE_GERAL')).toBe(false);
      expect(await canAccess(LgpdController, 'registerConsent', 'GERENTE_GERAL')).toBe(false);
      expect(await canAccess(ApprovalController, 'approve', 'GERENTE_GERAL')).toBe(true);
      expect(await canAccess(InboundNfeController, 'importAsGr', 'GERENTE_GERAL')).toBe(true);
    });

    it('FINANCEIRO: leituras fiscais + inbound view/import, sem eventos', async () => {
      expect(await canAccess(FiscalController, 'findAll', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(ManifestController, 'findAll', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(InboundNfeController, 'importAsGr', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(FiscalController, 'cancel', 'FINANCEIRO')).toBe(false);
      expect(await canAccess(FiscalController, 'export', 'FINANCEIRO')).toBe(false);
      expect(await canAccess(ManifestController, 'sync', 'FINANCEIRO')).toBe(false);
    });

    it('admins fazem a operação fiscal (ADMIN_EMPRESA sem o sync global)', async () => {
      for (const admin of ['ADMIN_GLOBAL', 'ADMIN_EMPRESA']) {
        expect(await canAccess(FiscalController, 'cancel', admin)).toBe(true);
        expect(await canAccess(ManifestController, 'sync', admin)).toBe(true);
        expect(await canAccess(TaxRuleController, 'update', admin)).toBe(true);
        expect(await canAccess(LgpdController, 'processAnonymization', admin)).toBe(true);
      }
    });
  });
});
