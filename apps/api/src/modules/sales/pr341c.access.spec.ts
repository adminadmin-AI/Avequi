import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { SalesController } from './sales.controller';
import { QuotationController } from '../quotation/quotation.controller';
import { DemandController } from '../demand/demand.controller';
import { ForecastController } from '../forecast/forecast.controller';
import { CommissionController } from '../commission/commission.controller';
import { StockController } from '../stock/stock.controller';
import { TransferController } from '../transfer/transfer.controller';
import { SerialController } from '../serial/serial.controller';
import { BatchController } from '../batch/batch.controller';
import { resolveEffectivePermissions } from '../iam/roles.catalog';

/**
 * Matriz do Bloco C (vendas/estoque) — #341 parte 2, issue #621.
 *
 * Trava, exercitando o PermissionGuard REAL contra a metadata REAL dos 9
 * controllers, as decisões do Rafael no PR C:
 *  - gate ÚNICO RBAC v2 — nenhum @Roles sobrou;
 *  - DIRETOR não opera venda (sem create/reserve/confirm/invoice/payments/
 *    TEF/conferência) — filosofia v2 confirmada, supersede a decisão 04/07;
 *  - 5 codes novos (#584/#596/#491/#391): set-payments, authorize-cards,
 *    confer, discount-policies view/configure;
 *  - VENDEDOR sem sales.demand.configure (horizonte MRP é gestão);
 *  - OPERADOR_PCP opera chão de fábrica (move/série/lote); OPERADOR_PRODUCAO
 *    só aponta (consume/link);
 *  - LOJA_OPERACIONAL não fatura (split #463); G.GERAL sem return/cancel;
 *  - VENDEDOR não aprova/rejeita/expira orçamento (Coordenador+).
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

/** Matriz rota → permissão aprovada pelo Rafael (issue #621). */
const MATRIZ: Array<[Ctor, string, Record<string, string>]> = [
  [SalesController, 'sales', {
    create: 'sales.orders.create',
    findAll: 'sales.orders.view',
    findOne: 'sales.orders.view',
    reserve: 'sales.orders.reserve',
    confirm: 'sales.orders.confirm',
    invoice: 'sales.orders.invoice',
    return: 'sales.orders.return',
    cancel: 'sales.orders.cancel',
    setPayments: 'sales.orders.set-payments',
    authorizeCards: 'sales.orders.authorize-cards',
    confer: 'sales.orders.confer',
    listDiscountPolicies: 'sales.discount-policies.view',
    seedDiscountPolicies: 'sales.discount-policies.configure',
    updateDiscountPolicy: 'sales.discount-policies.configure',
  }],
  [QuotationController, 'quotations', {
    list: 'sales.quotations.view',
    getStats: 'sales.quotations.view',
    getById: 'sales.quotations.view',
    create: 'sales.quotations.create',
    update: 'sales.quotations.update',
    delete: 'sales.quotations.delete',
    send: 'sales.quotations.send',
    approve: 'sales.quotations.approve',
    reject: 'sales.quotations.reject',
    convert: 'sales.quotations.convert',
    expire: 'sales.quotations.expire',
  }],
  [DemandController, 'demand', {
    upsert: 'sales.demand.create',
    findAll: 'sales.demand.view',
    getConsolidated: 'sales.demand.view',
    getHistory: 'sales.demand.view',
    getSuggestions: 'sales.demand.view',
    setHorizon: 'sales.demand.configure',
    remove: 'sales.demand.delete',
  }],
  [ForecastController, 'forecast', {
    generate: 'sales.forecast.generate',
    backtest: 'sales.forecast.view',
    history: 'sales.forecast.view',
    list: 'sales.forecast.view',
    adjust: 'sales.forecast.adjust',
  }],
  [CommissionController, 'commissions', {
    findAll: 'sales.commissions.view',
    findRules: 'sales.commissions.view',
    approveBatch: 'sales.commissions.approve',
    createRule: 'sales.commissions.configure',
  }],
  [StockController, 'stock', {
    getBalances: 'stock.balances.view',
    getBalance: 'stock.balances.view',
    getMovements: 'stock.movements.view',
    move: 'stock.movements.create',
    reverse: 'stock.movements.reverse',
  }],
  [TransferController, 'transfers', {
    create: 'stock.transfers.create',
    findAll: 'stock.transfers.view',
    findOne: 'stock.transfers.view',
    dispatch: 'stock.transfers.dispatch',
    receive: 'stock.transfers.receive',
    cancel: 'stock.transfers.cancel',
  }],
  [SerialController, 'serial', {
    getAffectedSerials: 'stock.serials.view',
    list: 'stock.serials.view',
    getStats: 'stock.serials.view',
    getBySerial: 'stock.serials.view',
    getById: 'stock.serials.view',
    getComponents: 'stock.serials.view',
    getComponentTree: 'stock.serials.view',
    create: 'stock.serials.create',
    update: 'stock.serials.update',
    linkToProduction: 'stock.serials.link',
    linkToSale: 'stock.serials.link',
    scrap: 'stock.serials.scrap',
  }],
  [BatchController, 'batch', {
    list: 'stock.batches.view',
    getStats: 'stock.batches.view',
    getById: 'stock.batches.view',
    getTraceability: 'stock.batches.view',
    create: 'stock.batches.create',
    checkExpired: 'stock.batches.check-expired',
    consume: 'stock.batches.consume',
    quarantine: 'stock.batches.quarantine',
    release: 'stock.batches.release',
    scrap: 'stock.batches.scrap',
    adjust: 'stock.batches.adjust',
  }],
];

describe('#341 parte 2 (PR C) — matriz vendas/estoque (issue #621)', () => {
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
  });

  describe('DIRETOR — acompanha/aprova, NÃO opera venda (decisão PR C)', () => {
    it('403 em toda a operação diária de venda', async () => {
      for (const h of ['create', 'reserve', 'confirm', 'invoice', 'setPayments', 'authorizeCards', 'confer']) {
        expect(await canAccess(SalesController, h, 'DIRETOR')).toBe(false);
      }
    });

    it('mantém leitura, aprovação de orçamento/comissão e VÊ alçadas sem configurar', async () => {
      expect(await canAccess(SalesController, 'findAll', 'DIRETOR')).toBe(true);
      expect(await canAccess(QuotationController, 'approve', 'DIRETOR')).toBe(true);
      expect(await canAccess(CommissionController, 'approveBatch', 'DIRETOR')).toBe(true);
      expect(await canAccess(CommissionController, 'createRule', 'DIRETOR')).toBe(true);
      expect(await canAccess(SalesController, 'listDiscountPolicies', 'DIRETOR')).toBe(true);
      expect(await canAccess(SalesController, 'seedDiscountPolicies', 'DIRETOR')).toBe(false);
      expect(await canAccess(SalesController, 'updateDiscountPolicy', 'DIRETOR')).toBe(false);
    });
  });

  describe('codes novos — grants aprovados', () => {
    it('VENDEDOR conduz a venda até o gate do faturamento (payments/TEF/conferência)', async () => {
      expect(await canAccess(SalesController, 'setPayments', 'VENDEDOR')).toBe(true);
      expect(await canAccess(SalesController, 'authorizeCards', 'VENDEDOR')).toBe(true);
      expect(await canAccess(SalesController, 'confer', 'VENDEDOR')).toBe(true);
      expect(await canAccess(SalesController, 'invoice', 'VENDEDOR')).toBe(false);
    });

    it('LOJA_OPERACIONAL idem — e segue SEM faturar (split #463)', async () => {
      expect(await canAccess(SalesController, 'setPayments', 'LOJA_OPERACIONAL')).toBe(true);
      expect(await canAccess(SalesController, 'authorizeCards', 'LOJA_OPERACIONAL')).toBe(true);
      expect(await canAccess(SalesController, 'confer', 'LOJA_OPERACIONAL')).toBe(true);
      expect(await canAccess(SalesController, 'invoice', 'LOJA_OPERACIONAL')).toBe(false);
      expect(await canAccess(SalesController, 'invoice', 'LOJA_FATURAMENTO')).toBe(true);
      expect(await canAccess(SalesController, 'invoice', 'GERENTE_LOJA')).toBe(true);
    });

    it('alçadas de desconto: financeiro/gerência veem; configurar é G.GERAL/G.COMERCIAL/admins; READER não vê', async () => {
      expect(await canAccess(SalesController, 'listDiscountPolicies', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(SalesController, 'listDiscountPolicies', 'GERENTE_FINANCEIRO')).toBe(true);
      expect(await canAccess(SalesController, 'listDiscountPolicies', 'SOMENTE_LEITURA')).toBe(false);
      expect(await canAccess(SalesController, 'updateDiscountPolicy', 'GERENTE_GERAL')).toBe(true);
      expect(await canAccess(SalesController, 'updateDiscountPolicy', 'GERENTE_COMERCIAL')).toBe(true);
      expect(await canAccess(SalesController, 'updateDiscountPolicy', 'ADMIN_EMPRESA')).toBe(true);
      expect(await canAccess(SalesController, 'updateDiscountPolicy', 'VENDEDOR')).toBe(false);
      expect(await canAccess(SalesController, 'updateDiscountPolicy', 'FINANCEIRO')).toBe(false);
    });
  });

  describe('VENDEDOR — horizonte MRP e orçamentos (decisões PR C)', () => {
    it('NÃO configura horizonte de MRP (gestão); segue criando/excluindo demanda', async () => {
      expect(await canAccess(DemandController, 'setHorizon', 'VENDEDOR')).toBe(false);
      expect(await canAccess(DemandController, 'setHorizon', 'GERENTE_GERAL')).toBe(true);
      expect(await canAccess(DemandController, 'upsert', 'VENDEDOR')).toBe(true);
      expect(await canAccess(DemandController, 'remove', 'VENDEDOR')).toBe(true);
    });

    it('NÃO aprova/rejeita/expira orçamento; Coordenador/gerências sim', async () => {
      for (const h of ['approve', 'reject', 'expire']) {
        expect(await canAccess(QuotationController, h, 'VENDEDOR')).toBe(false);
        expect(await canAccess(QuotationController, h, 'COORDENADOR_COMERCIAL')).toBe(true);
        expect(await canAccess(QuotationController, h, 'GERENTE_COMERCIAL')).toBe(true);
        expect(await canAccess(QuotationController, h, 'GERENTE_GERAL')).toBe(true);
      }
      expect(await canAccess(QuotationController, 'create', 'VENDEDOR')).toBe(true);
      expect(await canAccess(QuotationController, 'send', 'VENDEDOR')).toBe(true);
      expect(await canAccess(QuotationController, 'convert', 'VENDEDOR')).toBe(true);
      expect(await canAccess(QuotationController, 'delete', 'VENDEDOR')).toBe(false);
    });
  });

  describe('chão de fábrica — OPERADOR_PCP e OPERADOR_PRODUCAO (decisão PR C)', () => {
    it('OPERADOR_PCP movimenta estoque, cria/edita/vincula série e cria/consome lote', async () => {
      expect(await canAccess(StockController, 'move', 'OPERADOR_PCP')).toBe(true);
      expect(await canAccess(SerialController, 'create', 'OPERADOR_PCP')).toBe(true);
      expect(await canAccess(SerialController, 'update', 'OPERADOR_PCP')).toBe(true);
      expect(await canAccess(SerialController, 'linkToProduction', 'OPERADOR_PCP')).toBe(true);
      expect(await canAccess(BatchController, 'create', 'OPERADOR_PCP')).toBe(true);
      expect(await canAccess(BatchController, 'consume', 'OPERADOR_PCP')).toBe(true);
    });

    it('OPERADOR_PRODUCAO só aponta: consome lote e vincula série — sem criar/editar série nem mover estoque', async () => {
      expect(await canAccess(BatchController, 'consume', 'OPERADOR_PRODUCAO')).toBe(true);
      expect(await canAccess(SerialController, 'linkToProduction', 'OPERADOR_PRODUCAO')).toBe(true);
      expect(await canAccess(SerialController, 'create', 'OPERADOR_PRODUCAO')).toBe(false);
      expect(await canAccess(SerialController, 'update', 'OPERADOR_PRODUCAO')).toBe(false);
      expect(await canAccess(StockController, 'move', 'OPERADOR_PRODUCAO')).toBe(false);
    });

    it('destrutivos seguem restritos: estorno e sucata fora dos operadores', async () => {
      expect(await canAccess(StockController, 'reverse', 'OPERADOR_PCP')).toBe(false);
      expect(await canAccess(StockController, 'reverse', 'ALMOXARIFE')).toBe(false);
      expect(await canAccess(StockController, 'reverse', 'SUPERVISOR_ESTOQUE')).toBe(true);
      expect(await canAccess(SerialController, 'scrap', 'OPERADOR_PCP')).toBe(false);
      expect(await canAccess(SerialController, 'scrap', 'QUALIDADE')).toBe(true);
      expect(await canAccess(BatchController, 'quarantine', 'QUALIDADE')).toBe(true);
      expect(await canAccess(BatchController, 'quarantine', 'ALMOXARIFE')).toBe(false);
    });
  });

  describe('regras do #463 preservadas (ex-rbac-matrix.spec)', () => {
    it('G.GERAL (MANAGER) sem devolução/cancelamento de venda; fatura normalmente', async () => {
      expect(await canAccess(SalesController, 'return', 'GERENTE_GERAL')).toBe(false);
      expect(await canAccess(SalesController, 'cancel', 'GERENTE_GERAL')).toBe(false);
      expect(await canAccess(SalesController, 'invoice', 'GERENTE_GERAL')).toBe(true);
      expect(await canAccess(SalesController, 'return', 'ADMIN_EMPRESA')).toBe(true);
      expect(await canAccess(SalesController, 'return', 'GERENTE_COMERCIAL')).toBe(true);
    });

    it('transferências: LOJA/ALMOXARIFE operam, cancelar é gerência (equivalência legado)', async () => {
      expect(await canAccess(TransferController, 'create', 'LOJA_OPERACIONAL')).toBe(true);
      expect(await canAccess(TransferController, 'receive', 'ALMOXARIFE')).toBe(true);
      expect(await canAccess(TransferController, 'create', 'SOMENTE_LEITURA')).toBe(false);
      expect(await canAccess(TransferController, 'cancel', 'GERENTE_GERAL')).toBe(true);
      expect(await canAccess(TransferController, 'cancel', 'LOJA_OPERACIONAL')).toBe(false);
      expect(await canAccess(TransferController, 'cancel', 'ALMOXARIFE')).toBe(false);
    });
  });

  describe('varredura por catálogo — acesso efetivo espelha resolveEffectivePermissions', () => {
    const PERFIS = [
      'ADMIN_GLOBAL',
      'ADMIN_EMPRESA',
      'DIRETOR',
      'GERENTE_GERAL',
      'GERENTE_COMERCIAL',
      'VENDEDOR',
      'COORDENADOR_COMERCIAL',
      'FINANCEIRO',
      'ALMOXARIFE',
      'OPERADOR_PCP',
      'OPERADOR_PRODUCAO',
      'QUALIDADE',
      'LOJA_OPERACIONAL',
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
