import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { PurchaseController } from './purchase.controller';
import { RfqController } from '../rfq/rfq.controller';
import { SupplierPortalController } from '../supplier-portal/supplier-portal.controller';
import { ProductionController } from '../production/production.controller';
import { BomController } from '../bom/bom.controller';
import { RoutingController } from '../routing/routing.controller';
import { MrpController } from '../mrp/mrp.controller';
import { CapacityController } from '../capacity/capacity.controller';
import { QualityController } from '../quality/quality.controller';
import { MaintenanceController } from '../maintenance/maintenance.controller';
import { resolveEffectivePermissions } from '../iam/roles.catalog';

/**
 * Matriz do Bloco D (compras/produção/qualidade) — #341 parte 2, issue #622.
 *
 * Trava, exercitando o PermissionGuard REAL contra a metadata REAL dos 10
 * controllers, as decisões do Rafael no PR D:
 *  - gate ÚNICO RBAC v2 — nenhum @Roles sobrou nas rotas JWT;
 *  - SoD de compras: COMPRADOR cria e NÃO aprova; ALMOXARIFE solicita/recebe
 *    sem criar PO; aprovação = gerência/diretoria/admins;
 *  - DIRETOR mantém aprovações (approve/cancel PO, award, convert, activate
 *    BOM e AGORA matching.resolve) mas não opera compra/engenharia;
 *  - GERENTE_GERAL: somente LEITURA em qualidade e manutenção;
 *  - ciclo da OP: PCP cria, supervisor/gerência libera/conclui/cancela,
 *    operador inicia/aponta, qualidade aprova/reprova inspeção;
 *  - portal do fornecedor: rotas /me/* (SupplierTokenGuard) FORA do RBAC v2;
 *  - nenhuma permissão nova (catálogo já cobria o bloco inteiro).
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
    return await guard.canActivate(ctxFor(ControllerClass, handler));
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}

/** Rotas do portal do fornecedor (token próprio) que ficam FORA do RBAC v2 */
const PORTAL_TOKEN_ROUTES = [
  'getProfile',
  'getSummary',
  'listPurchaseOrders',
  'getPurchaseOrder',
  'listReceipts',
  'listPayments',
  'listNcrs',
];

/** Matriz rota → permissão aprovada pelo Rafael (issue #622). */
const MATRIZ: Array<[Ctor, string, Record<string, string>]> = [
  [PurchaseController, 'purchase', {
    createPO: 'purchases.orders.create',
    updatePO: 'purchases.orders.update',
    findAll: 'purchases.orders.view',
    findOne: 'purchases.orders.view',
    getReceivingStatus: 'purchases.orders.view',
    approvePO: 'purchases.orders.approve',
    cancelPO: 'purchases.orders.cancel',
    createReceipt: 'purchases.receiving.create',
    findReceipts: 'purchases.receiving.view',
    matchStatus: 'purchases.matching.view',
    saveMatch: 'purchases.matching.execute',
    resolveMatch: 'purchases.matching.resolve',
    createRequest: 'purchases.requests.create',
    findRequests: 'purchases.requests.view',
    cancelRequest: 'purchases.requests.cancel',
    convertRequest: 'purchases.requests.convert',
    findSupplierPrices: 'purchases.supplier-prices.view',
  }],
  [RfqController, 'rfq', {
    create: 'purchases.rfq.create',
    findAll: 'purchases.rfq.view',
    findOne: 'purchases.rfq.view',
    compare: 'purchases.rfq.view',
    submitQuote: 'purchases.rfq.quote',
    award: 'purchases.rfq.award',
  }],
  [ProductionController, 'production', {
    // #817 — despacho por setor: permissão PRÓPRIA, deliberadamente separada de
    // production.orders.view (ver o que cada setor produz é leitura de chão de
    // fábrica, não administração de Ordem de Produção). Somente leitura.
    dispatch: 'production.dispatch.view',
    create: 'production.orders.create',
    findAll: 'production.orders.view',
    findOne: 'production.orders.view',
    getScrapMetrics: 'production.orders.view',
    getLogs: 'production.orders.view',
    getProgress: 'production.orders.view',
    getCost: 'production.orders.view',
    release: 'production.orders.release',
    start: 'production.orders.start',
    complete: 'production.orders.complete',
    cancel: 'production.orders.cancel',
    addLog: 'production.orders.execute',
    approveInspection: 'production.orders.approve',
    rejectInspection: 'production.orders.reject',
  }],
  [BomController, 'bom', {
    create: 'production.bom.create',
    findByProduct: 'production.bom.view',
    findActive: 'production.bom.view',
    findOne: 'production.bom.view',
    activate: 'production.bom.activate',
  }],
  [RoutingController, 'routing', {
    create: 'production.routing.create',
    findByProduct: 'production.routing.view',
    update: 'production.routing.update',
    remove: 'production.routing.delete',
  }],
  [MrpController, 'mrp', {
    run: 'production.mrp.run',
    findAll: 'production.mrp.view',
    findOne: 'production.mrp.view',
    findGaps: 'production.mrp.view',
    convert: 'production.mrp.convert',
    convertBatch: 'production.mrp.convert',
  }],
  [CapacityController, 'capacity', {
    listWorkCenters: 'production.work-centers.view',
    getWorkCenterStats: 'production.work-centers.view',
    getWorkCenter: 'production.work-centers.view',
    getCapacityPlan: 'production.work-centers.view',
    getLoadByProduct: 'production.work-centers.view',
    createWorkCenter: 'production.work-centers.create',
    updateWorkCenter: 'production.work-centers.update',
    deleteWorkCenter: 'production.work-centers.delete',
  }],
  [QualityController, 'quality', {
    createInspection: 'quality.inspections.create',
    listInspections: 'quality.inspections.view',
    getInspection: 'quality.inspections.view',
    startInspection: 'quality.inspections.start',
    passInspection: 'quality.inspections.approve',
    failInspection: 'quality.inspections.reject',
    holdInspection: 'quality.inspections.hold',
    createNcr: 'quality.ncr.create',
    listNcrs: 'quality.ncr.view',
    getNcr: 'quality.ncr.view',
    updateNcr: 'quality.ncr.update',
    analyzeNcr: 'quality.ncr.analyze',
    correctiveActionNcr: 'quality.ncr.corrective-action',
    closeNcr: 'quality.ncr.close',
    cancelNcr: 'quality.ncr.cancel',
    getStats: 'quality.reports.view',
  }],
  [MaintenanceController, 'maintenance', {
    listEquipment: 'maintenance.equipment.view',
    getMaintenanceStats: 'maintenance.equipment.view',
    getEquipment: 'maintenance.equipment.view',
    createEquipment: 'maintenance.equipment.create',
    updateEquipment: 'maintenance.equipment.update',
    deactivateEquipment: 'maintenance.equipment.deactivate',
    listOrders: 'maintenance.orders.view',
    getOrder: 'maintenance.orders.view',
    createOrder: 'maintenance.orders.create',
    startOrder: 'maintenance.orders.start',
    completeOrder: 'maintenance.orders.complete',
    cancelOrder: 'maintenance.orders.cancel',
  }],
];

describe('#341 parte 2 (PR D) — matriz compras/produção/qualidade (issue #622)', () => {
  describe('metadata: rota → permissão exata, sem @Roles residual', () => {
    for (const [Ctrl, nome, esperado] of MATRIZ) {
      it(`${nome}: todas as rotas gated conforme a matriz aprovada`, () => {
        const eps = methodsOf(Ctrl);
        expect(eps.map((e) => e.name).sort()).toEqual(Object.keys(esperado).sort());
        for (const ep of eps) {
          expect(ep.required).toEqual([esperado[ep.name]]);
          expect(ep.roles).toBeUndefined();
        }
      });
    }

    it('supplier-portal: rotas admin gated; rotas /me/* (token) FORA do RBAC v2', () => {
      const eps = methodsOf(SupplierPortalController);
      const byName = Object.fromEntries(eps.map((e) => [e.name, e]));
      expect(byName['createToken'].required).toEqual(['suppliers.portal-tokens.create']);
      expect(byName['listTokens'].required).toEqual(['suppliers.portal-tokens.view']);
      expect(byName['revokeToken'].required).toEqual(['suppliers.portal-tokens.revoke']);
      for (const nome of PORTAL_TOKEN_ROUTES) {
        expect(byName[nome].required).toBeUndefined();
        expect(byName[nome].roles).toBeUndefined();
      }
      for (const ep of eps) {
        expect(ep.roles).toBeUndefined();
      }
    });
  });

  describe('SoD de compras (decisão Rafael)', () => {
    it('COMPRADOR cria/edita PO e solicita/cota, mas NÃO aprova nem cancela PO', async () => {
      expect(await canAccess(PurchaseController, 'createPO', 'COMPRADOR')).toBe(true);
      expect(await canAccess(PurchaseController, 'updatePO', 'COMPRADOR')).toBe(true);
      expect(await canAccess(RfqController, 'create', 'COMPRADOR')).toBe(true);
      expect(await canAccess(PurchaseController, 'approvePO', 'COMPRADOR')).toBe(false);
      expect(await canAccess(PurchaseController, 'cancelPO', 'COMPRADOR')).toBe(false);
      expect(await canAccess(RfqController, 'award', 'COMPRADOR')).toBe(false);
    });

    it('ALMOXARIFE solicita, recebe e cota — mas NÃO cria/edita PO (SoD v2)', async () => {
      expect(await canAccess(PurchaseController, 'createRequest', 'ALMOXARIFE')).toBe(true);
      expect(await canAccess(PurchaseController, 'createReceipt', 'ALMOXARIFE')).toBe(true);
      expect(await canAccess(RfqController, 'submitQuote', 'ALMOXARIFE')).toBe(true);
      expect(await canAccess(PurchaseController, 'createPO', 'ALMOXARIFE')).toBe(false);
      expect(await canAccess(PurchaseController, 'updatePO', 'ALMOXARIFE')).toBe(false);
    });

    it('aprovação de PO: gerências/diretoria/admins; LOJA segue com solicitações', async () => {
      expect(await canAccess(PurchaseController, 'approvePO', 'GERENTE_COMPRAS')).toBe(true);
      expect(await canAccess(PurchaseController, 'approvePO', 'GERENTE_GERAL')).toBe(true);
      expect(await canAccess(PurchaseController, 'approvePO', 'ADMIN_EMPRESA')).toBe(true);
      expect(await canAccess(PurchaseController, 'createRequest', 'LOJA_OPERACIONAL')).toBe(true);
      expect(await canAccess(PurchaseController, 'cancelRequest', 'LOJA_OPERACIONAL')).toBe(true);
      expect(await canAccess(PurchaseController, 'createRequest', 'SOMENTE_LEITURA')).toBe(false);
    });
  });

  describe('DIRETOR — aprova, não opera (decisão PR D)', () => {
    it('mantém as aprovações: approve/cancel PO, award, convert, activate BOM e matching.resolve', async () => {
      expect(await canAccess(PurchaseController, 'approvePO', 'DIRETOR')).toBe(true);
      expect(await canAccess(PurchaseController, 'cancelPO', 'DIRETOR')).toBe(true);
      expect(await canAccess(RfqController, 'award', 'DIRETOR')).toBe(true);
      expect(await canAccess(PurchaseController, 'convertRequest', 'DIRETOR')).toBe(true);
      expect(await canAccess(BomController, 'activate', 'DIRETOR')).toBe(true);
      // #622: resolver divergência de 3-way match é aprovação de exceção
      expect(await canAccess(PurchaseController, 'resolveMatch', 'DIRETOR')).toBe(true);
    });

    it('perde a operação diária: criar/editar PO, receber, solicitar, criar RFQ/BOM, executar match', async () => {
      expect(await canAccess(PurchaseController, 'createPO', 'DIRETOR')).toBe(false);
      expect(await canAccess(PurchaseController, 'updatePO', 'DIRETOR')).toBe(false);
      expect(await canAccess(PurchaseController, 'createReceipt', 'DIRETOR')).toBe(false);
      expect(await canAccess(PurchaseController, 'createRequest', 'DIRETOR')).toBe(false);
      expect(await canAccess(RfqController, 'create', 'DIRETOR')).toBe(false);
      expect(await canAccess(BomController, 'create', 'DIRETOR')).toBe(false);
      expect(await canAccess(PurchaseController, 'saveMatch', 'DIRETOR')).toBe(false);
    });
  });

  describe('GERENTE_GERAL — qualidade/manutenção SOMENTE leitura (decisão PR D)', () => {
    it('lê inspeções, NCRs, indicadores, equipamentos e ordens de manutenção', async () => {
      expect(await canAccess(QualityController, 'listInspections', 'GERENTE_GERAL')).toBe(true);
      expect(await canAccess(QualityController, 'listNcrs', 'GERENTE_GERAL')).toBe(true);
      expect(await canAccess(QualityController, 'getStats', 'GERENTE_GERAL')).toBe(true);
      expect(await canAccess(MaintenanceController, 'listEquipment', 'GERENTE_GERAL')).toBe(true);
      expect(await canAccess(MaintenanceController, 'listOrders', 'GERENTE_GERAL')).toBe(true);
    });

    it('NÃO opera qualidade nem manutenção', async () => {
      for (const h of ['createInspection', 'passInspection', 'failInspection', 'holdInspection', 'closeNcr', 'cancelNcr']) {
        expect(await canAccess(QualityController, h, 'GERENTE_GERAL')).toBe(false);
      }
      for (const h of ['createEquipment', 'deactivateEquipment', 'createOrder', 'completeOrder', 'cancelOrder']) {
        expect(await canAccess(MaintenanceController, h, 'GERENTE_GERAL')).toBe(false);
      }
    });

    it('donos das mutações seguem operando: QUALIDADE e G.INDUSTRIAL/ASSISTENCIA', async () => {
      expect(await canAccess(QualityController, 'passInspection', 'QUALIDADE')).toBe(true);
      expect(await canAccess(QualityController, 'failInspection', 'QUALIDADE')).toBe(true);
      expect(await canAccess(QualityController, 'closeNcr', 'GERENTE_INDUSTRIAL')).toBe(true);
      expect(await canAccess(MaintenanceController, 'createOrder', 'ASSISTENCIA_TECNICA')).toBe(true);
      expect(await canAccess(MaintenanceController, 'completeOrder', 'GERENTE_INDUSTRIAL')).toBe(true);
    });
  });

  describe('ciclo da OP — PCP planeja, supervisor conclui, operador aponta (decisão PR D)', () => {
    it('OPERADOR_PCP cria OP e roda MRP completo, mas NÃO libera/conclui/aponta', async () => {
      expect(await canAccess(ProductionController, 'create', 'OPERADOR_PCP')).toBe(true);
      expect(await canAccess(MrpController, 'run', 'OPERADOR_PCP')).toBe(true);
      expect(await canAccess(MrpController, 'convert', 'OPERADOR_PCP')).toBe(true);
      expect(await canAccess(ProductionController, 'release', 'OPERADOR_PCP')).toBe(false);
      expect(await canAccess(ProductionController, 'complete', 'OPERADOR_PCP')).toBe(false);
      expect(await canAccess(ProductionController, 'addLog', 'OPERADOR_PCP')).toBe(false);
      expect(await canAccess(BomController, 'create', 'OPERADOR_PCP')).toBe(false);
      expect(await canAccess(RoutingController, 'create', 'OPERADOR_PCP')).toBe(false);
    });

    it('OPERADOR_PRODUCAO inicia e aponta; SUPERVISOR libera/conclui/cancela', async () => {
      expect(await canAccess(ProductionController, 'start', 'OPERADOR_PRODUCAO')).toBe(true);
      expect(await canAccess(ProductionController, 'addLog', 'OPERADOR_PRODUCAO')).toBe(true);
      expect(await canAccess(ProductionController, 'release', 'OPERADOR_PRODUCAO')).toBe(false);
      expect(await canAccess(ProductionController, 'release', 'SUPERVISOR_PRODUCAO')).toBe(true);
      expect(await canAccess(ProductionController, 'complete', 'SUPERVISOR_PRODUCAO')).toBe(true);
      expect(await canAccess(ProductionController, 'cancel', 'SUPERVISOR_PRODUCAO')).toBe(true);
      expect(await canAccess(ProductionController, 'cancel', 'OPERADOR_PRODUCAO')).toBe(false);
    });

    it('inspeção final da OP é da QUALIDADE (e gerências industriais)', async () => {
      expect(await canAccess(ProductionController, 'approveInspection', 'QUALIDADE')).toBe(true);
      expect(await canAccess(ProductionController, 'rejectInspection', 'QUALIDADE')).toBe(true);
      expect(await canAccess(ProductionController, 'approveInspection', 'OPERADOR_PRODUCAO')).toBe(false);
      expect(await canAccess(ProductionController, 'approveInspection', 'VENDEDOR')).toBe(false);
    });
  });

  describe('varredura por catálogo — acesso efetivo espelha resolveEffectivePermissions', () => {
    const PERFIS = [
      'ADMIN_GLOBAL',
      'ADMIN_EMPRESA',
      'DIRETOR',
      'GERENTE_GERAL',
      'GERENTE_INDUSTRIAL',
      'GERENTE_COMPRAS',
      'COMPRADOR',
      'ALMOXARIFE',
      'OPERADOR_PCP',
      'OPERADOR_PRODUCAO',
      'SUPERVISOR_PRODUCAO',
      'QUALIDADE',
      'ASSISTENCIA_TECNICA',
      'VENDEDOR',
      'AUDITOR',
      'SOMENTE_LEITURA',
    ];

    for (const [Ctrl, nome, esperado] of MATRIZ) {
      for (const perfil of PERFIS) {
        it(`${nome} × ${perfil}`, async () => {
          const efetivas = resolveEffectivePermissions(perfil);
          for (const [handler, permissao] of Object.entries(esperado)) {
            expect(await canAccess(Ctrl, handler, perfil)).toBe(
              efetivas.includes(permissao),
            );
          }
        });
      }
    }
  });
});
