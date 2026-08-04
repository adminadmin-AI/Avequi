import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { AlertController } from '../alert/alert.controller';
import { CarrierController } from '../carrier/carrier.controller';
import { DeliveryController } from '../delivery/delivery.controller';
import { SchedulingController } from '../scheduling/scheduling.controller';
import { UserController } from '../user/user.controller';
import { VehicleTrackingController } from '../vehicle-tracking/vehicle-tracking.controller';
import { VehicleDocumentController } from '../vehicle-document/vehicle-document.controller';
import { WmsController } from './wms.controller';
import { resolveEffectivePermissions } from '../iam/roles.catalog';

/**
 * Matriz do Bloco G (satélites) — #341 parte 2, issue #625.
 *
 * ÚLTIMO bloco fora do CRM: com ele, o rbac-matrix.spec.ts legado foi
 * REMOVIDO (User/WMS eram os últimos controllers testados por @Roles).
 * Trava, exercitando o PermissionGuard REAL, as decisões do Rafael (10/07):
 *  - 6 permissões novas (260→266): sales.carriers.{view,manage},
 *    sales.deliveries.{view,update}, vehicle-tracking.documents.{view,manage};
 *  - inventário WMS reusa stock.inventory.{create,reconcile,cancel} (SoD:
 *    ALMOXARIFE abre/conta, NÃO reconcilia — supervisão/gerência fecham);
 *  - FINANCEIRO acompanha entrega (view) mas NÃO atualiza status; e NÃO
 *    recebe os documentos regulatórios do veículo (o legado dava);
 *  - SOMENTE_LEITURA fora de vehicle-docs e deliveries (expõem cliente);
 *  - corte do legado em usuários: DIRETOR/GERENTE_GERAL não criam/editam
 *    usuário no v2 (settings.users.* fica com RH e admins);
 *  - GETs antes abertos a qualquer autenticado (carriers, alerts, scheduling,
 *    WMS, deliveries, vehicle-docs) agora exigem view.
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

/** Matriz rota → permissão aprovada pelo Rafael (issue #625, decisões 10/07). */
// valor null = rota self-service do PRÓPRIO usuário, SEM gate de catálogo de
// propósito (a classificação consciente vive no route-gate-coverage.spec)
const MATRIZ: Array<[Ctor, string, Record<string, string | null>]> = [
  [AlertController, 'alert', {
    listActive: 'dashboard.alerts.view',
    listAll: 'dashboard.alerts.view',
    runCheck: 'dashboard.alerts.check',
    resolve: 'dashboard.alerts.resolve',
  }],
  [CarrierController, 'carrier', {
    create: 'sales.carriers.manage',
    findAll: 'sales.carriers.view',
    findOne: 'sales.carriers.view',
    update: 'sales.carriers.manage',
  }],
  [DeliveryController, 'delivery', {
    list: 'sales.deliveries.view',
    updateStatus: 'sales.deliveries.update',
  }],
  [SchedulingController, 'scheduling', {
    generate: 'production.scheduling.generate',
    getSchedule: 'production.scheduling.view',
    getGantt: 'production.scheduling.view',
  }],
  [UserController, 'user', {
    create: 'settings.users.create',
    findAll: 'settings.users.view',
    findOne: 'settings.users.view',
    update: 'settings.users.update',
    // #975: preferências de UI do PRÓPRIO usuário — self-service consciente
    // (null = sem gate de catálogo; classificação no route-gate-coverage)
    getUiPreferences: null,
    saveUiPreferences: null,
  }],
  [VehicleTrackingController, 'vehicle-tracking', {
    createBin: 'vehicle-tracking.bin.create',
    findAllBin: 'vehicle-tracking.bin.view',
    findPendingChassis: 'vehicle-tracking.bin.view',
    findBinBySerial: 'vehicle-tracking.bin.view',
    updateBin: 'vehicle-tracking.bin.update',
    createAtpve: 'vehicle-tracking.atpve.create',
    findAllAtpve: 'vehicle-tracking.atpve.view',
    findSalesWithoutAtpve: 'vehicle-tracking.atpve.view',
    findOneAtpve: 'vehicle-tracking.atpve.view',
    updateAtpve: 'vehicle-tracking.atpve.update',
    // #529-#533: integração RENAVE/SERPRO (3 codes novos 266→269 + reuso atpve.*)
    getRenaveStatus: 'vehicle-tracking.renave.view',
    retryOperation: 'vehicle-tracking.renave.retry',
    returnToManufacturer: 'vehicle-tracking.renave.manage',
    downloadAtpvePdf: 'vehicle-tracking.atpve.view',
    resendAtpveEmail: 'vehicle-tracking.atpve.update',
  }],
  [VehicleDocumentController, 'vehicle-document', {
    create: 'vehicle-tracking.documents.manage',
    list: 'vehicle-tracking.documents.view',
    pending: 'vehicle-tracking.documents.view',
    bySale: 'vehicle-tracking.documents.view',
    get: 'vehicle-tracking.documents.view',
    update: 'vehicle-tracking.documents.manage',
    remove: 'vehicle-tracking.documents.manage',
    registerDelivery: 'vehicle-tracking.documents.manage',
  }],
  [WmsController, 'wms', {
    createLocation: 'stock.wms.configure',
    findLocations: 'stock.wms.view',
    findReceivingOrders: 'stock.wms.view',
    findReceivingOrder: 'stock.wms.view',
    getReceivingReport: 'stock.wms.view',
    confirmPutaway: 'stock.wms.execute',
    findPickingOrders: 'stock.wms.view',
    findPickingOrder: 'stock.wms.view',
    getPickingReport: 'stock.wms.view',
    confirmPickTask: 'stock.wms.execute',
    createInventoryCount: 'stock.inventory.create',
    findInventoryCounts: 'stock.wms.view',
    findInventoryCount: 'stock.wms.view',
    getInventoryReport: 'stock.wms.view',
    recordCount: 'stock.wms.execute',
    reconcile: 'stock.inventory.reconcile',
    getDashboard: 'stock.wms.view',
    toggleLocation: 'stock.wms.configure',
    toggleWarehouseWms: 'stock.wms.configure',
    cancelInventoryCount: 'stock.inventory.cancel',
  }],
];

describe('#341 parte 2 (bloco G) — matriz satélites (issue #625)', () => {
  describe('metadata: rota → permissão exata, sem @Roles residual', () => {
    for (const [Ctrl, nome, esperado] of MATRIZ) {
      it(`${nome}: todas as rotas gated conforme a matriz aprovada`, () => {
        const eps = methodsOf(Ctrl);
        expect(eps.map((e) => e.name).sort()).toEqual(Object.keys(esperado).sort());
        for (const ep of eps) {
          if (esperado[ep.name] === null) {
            expect(ep.required).toBeUndefined();
          } else {
            expect(ep.required).toEqual([esperado[ep.name]]);
          }
          expect(ep.roles).toBeUndefined();
        }
      });
    }
  });

  describe('SoD de inventário WMS (decisão Rafael)', () => {
    it('ALMOXARIFE abre inventário e conta, mas NÃO reconcilia nem cancela', async () => {
      expect(await canAccess(WmsController, 'createInventoryCount', 'ALMOXARIFE')).toBe(true);
      expect(await canAccess(WmsController, 'recordCount', 'ALMOXARIFE')).toBe(true);
      expect(await canAccess(WmsController, 'confirmPutaway', 'ALMOXARIFE')).toBe(true);
      expect(await canAccess(WmsController, 'reconcile', 'ALMOXARIFE')).toBe(false);
      expect(await canAccess(WmsController, 'cancelInventoryCount', 'ALMOXARIFE')).toBe(false);
      expect(await canAccess(WmsController, 'createLocation', 'ALMOXARIFE')).toBe(false);
    });

    it('SUPERVISOR_ESTOQUE, gerências e admins reconciliam (ajusta saldo)', async () => {
      for (const r of ['SUPERVISOR_ESTOQUE', 'GERENTE_GERAL', 'GERENTE_INDUSTRIAL', 'ADMIN_GLOBAL', 'ADMIN_EMPRESA']) {
        expect(await canAccess(WmsController, 'reconcile', r)).toBe(true);
        expect(await canAccess(WmsController, 'cancelInventoryCount', r)).toBe(true);
      }
    });
  });

  describe('entregas: expedição/loja atualizam; FINANCEIRO e comercial só acompanham', () => {
    it('LOJA_OPERACIONAL, GERENTE_LOJA (herança), ALMOXARIFE, SUPERVISOR_ESTOQUE e G.GERAL atualizam', async () => {
      for (const r of ['LOJA_OPERACIONAL', 'GERENTE_LOJA', 'ALMOXARIFE', 'SUPERVISOR_ESTOQUE', 'GERENTE_GERAL']) {
        expect(await canAccess(DeliveryController, 'updateStatus', r)).toBe(true);
      }
    });

    it('FINANCEIRO vê mas NÃO atualiza; GERENTE_COMERCIAL e VENDEDOR idem', async () => {
      expect(await canAccess(DeliveryController, 'list', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(DeliveryController, 'updateStatus', 'FINANCEIRO')).toBe(false);
      expect(await canAccess(DeliveryController, 'list', 'GERENTE_COMERCIAL')).toBe(true);
      expect(await canAccess(DeliveryController, 'updateStatus', 'GERENTE_COMERCIAL')).toBe(false);
      expect(await canAccess(DeliveryController, 'list', 'VENDEDOR')).toBe(true);
      expect(await canAccess(DeliveryController, 'updateStatus', 'VENDEDOR')).toBe(false);
    });
  });

  describe('documentos do veículo (CAT/CCT) — view restrita, manage sem Financeiro', () => {
    it('DIRETOR/G.GERAL/FISCAL/AUDITOR/ASSISTENCIA veem', async () => {
      for (const r of ['DIRETOR', 'GERENTE_GERAL', 'FISCAL', 'AUDITOR', 'ASSISTENCIA_TECNICA']) {
        expect(await canAccess(VehicleDocumentController, 'list', r)).toBe(true);
      }
    });

    it('manage: G.GERAL, FISCAL e admins; FINANCEIRO e G.FINANCEIRO NÃO (nem view)', async () => {
      for (const r of ['GERENTE_GERAL', 'FISCAL', 'ADMIN_GLOBAL', 'ADMIN_EMPRESA']) {
        expect(await canAccess(VehicleDocumentController, 'update', r)).toBe(true);
      }
      expect(await canAccess(VehicleDocumentController, 'update', 'FINANCEIRO')).toBe(false);
      expect(await canAccess(VehicleDocumentController, 'list', 'FINANCEIRO')).toBe(false);
      expect(await canAccess(VehicleDocumentController, 'update', 'GERENTE_FINANCEIRO')).toBe(false);
      expect(await canAccess(VehicleDocumentController, 'list', 'GERENTE_FINANCEIRO')).toBe(false);
      expect(await canAccess(VehicleDocumentController, 'update', 'DIRETOR')).toBe(false);
    });

    it('FINANCEIRO segue com BIN/ATPV-e (só documents saiu)', async () => {
      expect(await canAccess(VehicleTrackingController, 'createBin', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(VehicleTrackingController, 'findAllAtpve', 'FINANCEIRO')).toBe(true);
    });
  });

  describe('usuários: corte do legado (decisão Rafael)', () => {
    it('DIRETOR e GERENTE_GERAL NÃO criam/editam usuário no v2 (o legado dava)', async () => {
      for (const r of ['DIRETOR', 'GERENTE_GERAL']) {
        expect(await canAccess(UserController, 'create', r)).toBe(false);
        expect(await canAccess(UserController, 'update', r)).toBe(false);
      }
      expect(await canAccess(UserController, 'findAll', 'DIRETOR')).toBe(true);
    });

    it('RH e admins criam/editam', async () => {
      for (const r of ['RH', 'ADMIN_GLOBAL', 'ADMIN_EMPRESA']) {
        expect(await canAccess(UserController, 'create', r)).toBe(true);
        expect(await canAccess(UserController, 'update', r)).toBe(true);
      }
    });
  });

  describe('perfis restritos', () => {
    it('SOMENTE_LEITURA: fora de vehicle-docs, deliveries e usuários; vê alertas/WMS/scheduling', async () => {
      expect(await canAccess(VehicleDocumentController, 'list', 'SOMENTE_LEITURA')).toBe(false);
      expect(await canAccess(DeliveryController, 'list', 'SOMENTE_LEITURA')).toBe(false);
      expect(await canAccess(UserController, 'findAll', 'SOMENTE_LEITURA')).toBe(false);
      expect(await canAccess(AlertController, 'listActive', 'SOMENTE_LEITURA')).toBe(true);
      expect(await canAccess(WmsController, 'findLocations', 'SOMENTE_LEITURA')).toBe(true);
      expect(await canAccess(SchedulingController, 'getSchedule', 'SOMENTE_LEITURA')).toBe(true);
      expect(await canAccess(CarrierController, 'findAll', 'SOMENTE_LEITURA')).toBe(true);
    });

    it('transportadoras: comercial/loja/expedição veem; manage é G.COMERCIAL/G.GERAL/admins', async () => {
      for (const r of ['VENDEDOR', 'GERENTE_LOJA', 'ALMOXARIFE', 'GERENTE_COMERCIAL', 'GERENTE_GERAL']) {
        expect(await canAccess(CarrierController, 'findAll', r)).toBe(true);
      }
      expect(await canAccess(CarrierController, 'create', 'GERENTE_COMERCIAL')).toBe(true);
      expect(await canAccess(CarrierController, 'create', 'GERENTE_GERAL')).toBe(true);
      expect(await canAccess(CarrierController, 'create', 'VENDEDOR')).toBe(false);
      expect(await canAccess(CarrierController, 'create', 'ALMOXARIFE')).toBe(false);
      expect(await canAccess(CarrierController, 'create', 'LOJA_OPERACIONAL')).toBe(false);
    });

    it('scheduling: PCP/supervisão geram; operador de produção não', async () => {
      expect(await canAccess(SchedulingController, 'generate', 'OPERADOR_PCP')).toBe(true);
      expect(await canAccess(SchedulingController, 'generate', 'SUPERVISOR_PRODUCAO')).toBe(true);
      expect(await canAccess(SchedulingController, 'generate', 'OPERADOR_PRODUCAO')).toBe(false);
      expect(await canAccess(SchedulingController, 'getSchedule', 'OPERADOR_PRODUCAO')).toBe(true);
    });

    it('alertas: gerências rodam checagem e resolvem (matriz #463 — operacionais perdem o resolve do legado); VISITANTE nada', async () => {
      expect(await canAccess(AlertController, 'runCheck', 'GERENTE_GERAL')).toBe(true);
      expect(await canAccess(AlertController, 'resolve', 'GERENTE_GERAL')).toBe(true);
      expect(await canAccess(AlertController, 'resolve', 'GERENTE_LOJA')).toBe(true);
      expect(await canAccess(AlertController, 'runCheck', 'ALMOXARIFE')).toBe(false);
      expect(await canAccess(AlertController, 'resolve', 'ALMOXARIFE')).toBe(false);
      expect(await canAccess(AlertController, 'listActive', 'SOMENTE_LEITURA')).toBe(true);
      expect(await canAccess(AlertController, 'listActive', 'VISITANTE')).toBe(false);
    });
  });
});
