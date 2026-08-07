import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { ProductController } from './product.controller';
import { PriceController } from '../price/price.controller';
import { CustomerController } from '../customer/customer.controller';
import { SupplierController } from '../supplier/supplier.controller';
import { DashboardController } from '../dashboard/dashboard.controller';
import { WarehouseController } from '../warehouse/warehouse.controller';
import { CompanyController } from '../company/company.controller';
import { resolveEffectivePermissions } from '../iam/roles.catalog';

/**
 * Matriz do Bloco B (cadastros simples) — #341 parte 2, issue #620.
 *
 * Trava, exercitando o PermissionGuard REAL contra a metadata REAL dos 7
 * controllers, a matriz aprovada pelo Rafael:
 *  - gate ÚNICO RBAC v2 (@RequirePermission) — nenhum @Roles sobrou;
 *  - endereços de entrega = família própria customers.addresses.* (balcão
 *    adiciona; comercial edita; só gerência/admin remove);
 *  - FINANCEIRO vê produto mas NÃO vê preço comercial;
 *  - LOJA_OPERACIONAL vê depósitos (tela de transferência entre filiais);
 *  - DIRETOR não opera cadastro de rotina (sem create/update neste bloco,
 *    exceto products.catalog.update, mantido do legado);
 *  - empresa: criar é global (ADMIN_GLOBAL), editar é de admin.
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

/** Matriz rota → permissão aprovada pelo Rafael (issue #620). */
const MATRIZ: Array<[Ctor, string, Record<string, string>]> = [
  [ProductController, 'products', {
    create: 'products.catalog.create',
    findAll: 'products.catalog.view',
    findOptions: 'products.catalog.view',
    // #1032: export CSV usa a MESMA permissão da listagem — quem vê a lista
    // pode baixar o que está vendo, nada além disso.
    exportCsv: 'products.catalog.view',
    findOne: 'products.catalog.view',
    update: 'products.catalog.update',
  }],
  [PriceController, 'prices', {
    create: 'products.pricing.create',
    lookup: 'products.pricing.view',
    findAll: 'products.pricing.view',
    findOne: 'products.pricing.view',
  }],
  [CustomerController, 'customers', {
    create: 'customers.registry.create',
    findAll: 'customers.registry.view',
    findOptions: 'customers.registry.view',
    // #1032: export CSV usa a MESMA permissão da listagem — quem vê a lista
    // pode baixar o que está vendo, nada além disso.
    exportCsv: 'customers.registry.view',
    creditStatus: 'customers.registry.view',
    findOne: 'customers.registry.view',
    update: 'customers.registry.update',
    addAddress: 'customers.addresses.create',
    updateAddress: 'customers.addresses.update',
    removeAddress: 'customers.addresses.delete',
    // #476 — tags e anexos reusam a família registry (view lê, update mantém)
    listTags: 'customers.registry.view',
    createTag: 'customers.registry.update',
    deleteTag: 'customers.registry.update',
    setTags: 'customers.registry.update',
    listAttachments: 'customers.registry.view',
    downloadAttachment: 'customers.registry.view',
    uploadAttachment: 'customers.registry.update',
    deleteAttachment: 'customers.registry.update',
  }],
  [SupplierController, 'suppliers', {
    create: 'suppliers.registry.create',
    findAll: 'suppliers.registry.view',
    findOne: 'suppliers.registry.view',
    update: 'suppliers.registry.update',
  }],
  [DashboardController, 'dashboard', {
    getExecutive: 'dashboard.executive.view',
    getSales: 'dashboard.sales.view',
    getFinance: 'dashboard.finance.view',
    getProduction: 'dashboard.production.view',
    getStock: 'dashboard.stock.view',
    getPurchases: 'dashboard.purchases.view',
  }],
  [WarehouseController, 'warehouses', {
    create: 'stock.warehouses.create',
    findAll: 'stock.warehouses.view',
    findOne: 'stock.warehouses.view',
    update: 'stock.warehouses.update',
  }],
  [CompanyController, 'companies', {
    create: 'settings.companies.create',
    findAll: 'settings.companies.view',
    findOne: 'settings.companies.view',
    update: 'settings.companies.update',
  }],
];

describe('#341 parte 2 (PR B) — matriz dos cadastros simples (issue #620)', () => {
  describe('metadata: rota → permissão exata, sem @Roles residual', () => {
    for (const [Ctrl, nome, esperado] of MATRIZ) {
      it(`${nome}: todas as rotas gated conforme a matriz aprovada`, () => {
        const eps = methodsOf(Ctrl);
        // nenhum handler fora da matriz e nenhum sem gate
        expect(eps.map((e) => e.name).sort()).toEqual(Object.keys(esperado).sort());
        for (const ep of eps) {
          expect(ep.required).toEqual([esperado[ep.name]]);
          expect(ep.roles).toBeUndefined();
        }
      });
    }
  });

  describe('endereços de entrega — regra própria (decisão Rafael)', () => {
    it('LOJA_OPERACIONAL adiciona endereço no balcão, mas não edita nem remove', async () => {
      expect(await canAccess(CustomerController, 'addAddress', 'LOJA_OPERACIONAL')).toBe(true);
      expect(await canAccess(CustomerController, 'updateAddress', 'LOJA_OPERACIONAL')).toBe(false);
      expect(await canAccess(CustomerController, 'removeAddress', 'LOJA_OPERACIONAL')).toBe(false);
    });

    it('VENDEDOR adiciona e edita endereço, mas remover é de gerência', async () => {
      expect(await canAccess(CustomerController, 'addAddress', 'VENDEDOR')).toBe(true);
      expect(await canAccess(CustomerController, 'updateAddress', 'VENDEDOR')).toBe(true);
      expect(await canAccess(CustomerController, 'removeAddress', 'VENDEDOR')).toBe(false);
    });

    it('gerência geral/comercial e admins removem endereço; DIRETOR não', async () => {
      expect(await canAccess(CustomerController, 'removeAddress', 'GERENTE_GERAL')).toBe(true);
      expect(await canAccess(CustomerController, 'removeAddress', 'GERENTE_COMERCIAL')).toBe(true);
      expect(await canAccess(CustomerController, 'removeAddress', 'ADMIN_GLOBAL')).toBe(true);
      expect(await canAccess(CustomerController, 'removeAddress', 'ADMIN_EMPRESA')).toBe(true);
      expect(await canAccess(CustomerController, 'removeAddress', 'DIRETOR')).toBe(false);
    });

    it('regra de balcão preservada (ex-rbac-matrix.spec): LOJA cria cliente mas não edita', async () => {
      expect(await canAccess(CustomerController, 'create', 'LOJA_OPERACIONAL')).toBe(true);
      expect(await canAccess(CustomerController, 'create', 'VENDEDOR')).toBe(true);
      expect(await canAccess(CustomerController, 'create', 'SOMENTE_LEITURA')).toBe(false);
      expect(await canAccess(CustomerController, 'update', 'LOJA_OPERACIONAL')).toBe(false);
    });
  });

  describe('FINANCEIRO — produto sim, preço comercial não (decisão Rafael)', () => {
    it('vê o cadastro de produto (conferência de NF/faturamento)', async () => {
      expect(await canAccess(ProductController, 'findAll', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(ProductController, 'findOne', 'FINANCEIRO')).toBe(true);
    });

    it('NÃO vê tabelas de preço nem lookup (mais sensível)', async () => {
      expect(await canAccess(PriceController, 'findAll', 'FINANCEIRO')).toBe(false);
      expect(await canAccess(PriceController, 'lookup', 'FINANCEIRO')).toBe(false);
    });

    it('não cria nem edita produto', async () => {
      expect(await canAccess(ProductController, 'create', 'FINANCEIRO')).toBe(false);
      expect(await canAccess(ProductController, 'update', 'FINANCEIRO')).toBe(false);
    });
  });

  describe('LOJA_OPERACIONAL — vê depósitos p/ transferência entre filiais', () => {
    it('lista e consulta depósitos, mas não cria/edita', async () => {
      expect(await canAccess(WarehouseController, 'findAll', 'LOJA_OPERACIONAL')).toBe(true);
      expect(await canAccess(WarehouseController, 'findOne', 'LOJA_OPERACIONAL')).toBe(true);
      expect(await canAccess(WarehouseController, 'create', 'LOJA_OPERACIONAL')).toBe(false);
      expect(await canAccess(WarehouseController, 'update', 'LOJA_OPERACIONAL')).toBe(false);
    });

    it('herdeiros da loja (faturamento/gerente) mantêm a visão de depósitos', async () => {
      expect(await canAccess(WarehouseController, 'findAll', 'LOJA_FATURAMENTO')).toBe(true);
      expect(await canAccess(WarehouseController, 'findAll', 'GERENTE_LOJA')).toBe(true);
    });
  });

  describe('DIRETOR — acompanha/aprova, não opera cadastro de rotina', () => {
    it('perde os create/update deste bloco (produto-create, preço, fornecedor, depósito, empresa)', async () => {
      expect(await canAccess(ProductController, 'create', 'DIRETOR')).toBe(false);
      expect(await canAccess(PriceController, 'create', 'DIRETOR')).toBe(false);
      expect(await canAccess(SupplierController, 'create', 'DIRETOR')).toBe(false);
      expect(await canAccess(SupplierController, 'update', 'DIRETOR')).toBe(false);
      expect(await canAccess(WarehouseController, 'create', 'DIRETOR')).toBe(false);
      expect(await canAccess(WarehouseController, 'update', 'DIRETOR')).toBe(false);
      expect(await canAccess(CompanyController, 'create', 'DIRETOR')).toBe(false);
      expect(await canAccess(CompanyController, 'update', 'DIRETOR')).toBe(false);
    });

    it('mantém products.catalog.update (grant explícito do catálogo) e leitura geral', async () => {
      expect(await canAccess(ProductController, 'update', 'DIRETOR')).toBe(true);
      expect(await canAccess(ProductController, 'findAll', 'DIRETOR')).toBe(true);
      expect(await canAccess(SupplierController, 'findAll', 'DIRETOR')).toBe(true);
      expect(await canAccess(WarehouseController, 'findAll', 'DIRETOR')).toBe(true);
      expect(await canAccess(CompanyController, 'findAll', 'DIRETOR')).toBe(true);
      expect(await canAccess(DashboardController, 'getFinance', 'DIRETOR')).toBe(true);
    });
  });

  describe('empresa — criar é global; editar é de admin', () => {
    it('só ADMIN_GLOBAL cria empresa (ação global do sistema)', async () => {
      expect(await canAccess(CompanyController, 'create', 'ADMIN_GLOBAL')).toBe(true);
      expect(await canAccess(CompanyController, 'create', 'ADMIN_EMPRESA')).toBe(false);
    });

    it('ADMIN_EMPRESA edita (a própria — escopo no service); perfis comuns não', async () => {
      expect(await canAccess(CompanyController, 'update', 'ADMIN_EMPRESA')).toBe(true);
      expect(await canAccess(CompanyController, 'update', 'GERENTE_GERAL')).toBe(false);
      expect(await canAccess(CompanyController, 'update', 'FINANCEIRO')).toBe(false);
    });

    it('listagem exige settings.companies.view (não é mais aberta a todo autenticado)', async () => {
      expect(await canAccess(CompanyController, 'findAll', 'VENDEDOR')).toBe(false);
      expect(await canAccess(CompanyController, 'findAll', 'LOJA_OPERACIONAL')).toBe(false);
      expect(await canAccess(CompanyController, 'findAll', 'RH')).toBe(true);
      expect(await canAccess(CompanyController, 'findAll', 'AUDITOR')).toBe(true);
    });
  });

  describe('dashboards — cada perfil vê o painel da sua área', () => {
    it('painel financeiro segue restrito (equivalência com o legado preservada)', async () => {
      expect(await canAccess(DashboardController, 'getFinance', 'ADMIN_GLOBAL')).toBe(true);
      expect(await canAccess(DashboardController, 'getFinance', 'GERENTE_GERAL')).toBe(true);
      expect(await canAccess(DashboardController, 'getFinance', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(DashboardController, 'getFinance', 'VENDEDOR')).toBe(false);
      expect(await canAccess(DashboardController, 'getFinance', 'SOMENTE_LEITURA')).toBe(false);
    });

    it('VISITANTE tem os 5 painéis operacionais e nada além', async () => {
      expect(await canAccess(DashboardController, 'getExecutive', 'VISITANTE')).toBe(true);
      expect(await canAccess(DashboardController, 'getPurchases', 'VISITANTE')).toBe(true);
      expect(await canAccess(DashboardController, 'getFinance', 'VISITANTE')).toBe(false);
      expect(await canAccess(ProductController, 'findAll', 'VISITANTE')).toBe(false);
    });
  });

  describe('varredura por catálogo — acesso efetivo espelha resolveEffectivePermissions', () => {
    const PERFIS = [
      'ADMIN_GLOBAL',
      'ADMIN_EMPRESA',
      'DIRETOR',
      'GERENTE_GERAL',
      'VENDEDOR',
      'FINANCEIRO',
      'ALMOXARIFE',
      'LOJA_OPERACIONAL',
      'AUDITOR',
      'SOMENTE_LEITURA',
      'VISITANTE',
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
