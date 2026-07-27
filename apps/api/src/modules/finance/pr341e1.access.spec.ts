import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { FinanceController } from './finance.controller';
import { BankingController } from './banking.controller';
import { BillingController } from './billing.controller';
import { BudgetController } from '../budget/budget.controller';
import { AcquirerController } from '../acquirer/acquirer.controller';
import { BudgetPlanController } from '../budget-plan/budget-plan.controller';
import { InvestmentController } from '../investment/investment.controller';
import { FinancialForecastController } from '../financial-forecast/financial-forecast.controller';
import { resolveEffectivePermissions } from '../iam/roles.catalog';

/**
 * Matriz do Bloco E1 (financeiro/banking/billing/FP&A) — #341 parte 2, issue #623.
 *
 * Trava, exercitando o PermissionGuard REAL contra a metadata REAL dos 8
 * controllers, as decisões do Rafael (09/07/2026):
 *  - gate ÚNICO RBAC v2 — nenhum @Roles sobrou;
 *  - FINANCEIRO opera o dia a dia (lançar, pagar, parcelar, conciliar,
 *    boletos/PIX, adiantar, dívidas, disparar cobrança) mas NÃO configura
 *    (provisões, régua, conta bancária corrente via banking.configure,
 *    adquirentes) nem faz write-off nem exporta management book;
 *  - GERENTE_FINANCEIRO é o dono do módulo (tudo, EXCETO aprovar
 *    investimento — alçada é da diretoria);
 *  - DIRETOR vê e aprova (investments.approve), NÃO opera (sem pay,
 *    write-off, conciliação, configs) e NÃO vê taxas de adquirente;
 *  - AUDITOR: todas as leituras + exports (management book, XLSs fiscais),
 *    nenhuma mutação;
 *  - SOMENTE_LEITURA: fora de TODO o módulo finance;
 *  - FIX acquirer: os GETs estavam SEM gate (qualquer autenticado via as
 *    taxas de cartão) — agora view é FINANCEIRO/G.FINANCEIRO/AUDITOR/admins.
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

/** Matriz rota → permissão aprovada pelo Rafael (issue #623, decisões 09/07). */
const MATRIZ: Array<[Ctor, string, Record<string, string>]> = [
  [FinanceController, 'finance', {
    findAll: 'finance.entries.view',
    createManualEntry: 'finance.entries.create',
    updateEntry: 'finance.entries.update',
    getKpis: 'finance.reports.view',
    getMarginBySku: 'finance.reports.view',
    getPdd: 'finance.provisions.view',
    listProvisionRules: 'finance.provisions.view',
    seedProvisionDefaults: 'finance.provisions.configure',
    updateProvisionRule: 'finance.provisions.configure',
    writeOff: 'finance.entries.write-off',
    listAdvances: 'finance.advances.view',
    createAdvance: 'finance.advances.create',
    cancelAdvance: 'finance.advances.cancel',
    debtDashboard: 'finance.debts.view',
    listDebts: 'finance.debts.view',
    createDebt: 'finance.debts.create',
    getDebt: 'finance.debts.view',
    payDebtInstallment: 'finance.debts.pay',
    managementBook: 'finance.reports.export',
    getDre: 'finance.reports.view',
    getCashFlowProjection: 'finance.reports.view',
    getCashFlow: 'finance.entries.view',
    findOne: 'finance.entries.view',
    pay: 'finance.entries.pay',
    createInstallments: 'finance.entries.installment',
    cancel: 'finance.entries.cancel',
    createBankAccount: 'finance.bank-accounts.create',
    findAllBankAccounts: 'finance.bank-accounts.view',
    updateBankAccount: 'finance.bank-accounts.update',
    deactivateBankAccount: 'finance.bank-accounts.delete',
    getConsolidatedBalance: 'finance.bank-accounts.view',
    getBankStatement: 'finance.bank-accounts.view',
    createCategory: 'finance.categories.create',
    findAllCategories: 'finance.categories.view',
    updateCategory: 'finance.categories.update',
    deactivateCategory: 'finance.categories.delete',
    createCostCenter: 'finance.cost-centers.create',
    findAllCostCenters: 'finance.cost-centers.view',
    updateCostCenter: 'finance.cost-centers.update',
    deactivateCostCenter: 'finance.cost-centers.delete',
  }],
  [BankingController, 'banking', {
    findAllAccounts: 'finance.banking.view',
    getOverview: 'finance.banking.view',
    cashFlowWeekly: 'finance.reports.view',
    cashFlowMonthly: 'finance.reports.view',
    cashFlowScenarios: 'finance.reports.view',
    importOfx: 'finance.reconciliation.execute',
    autoMatch: 'finance.reconciliation.execute',
    getUnmatchedReconciliation: 'finance.banking.view',
    matchManual: 'finance.reconciliation.execute',
    unmatch: 'finance.reconciliation.execute',
    createEntryFromStatement: 'finance.entries.create',
    findOneAccount: 'finance.banking.view',
    getAccountBalance: 'finance.banking.view',
    configureAccount: 'finance.banking.configure',
    createSchedule: 'finance.payment-schedules.create',
    findAllSchedules: 'finance.payment-schedules.view',
    cancelSchedule: 'finance.payment-schedules.delete',
    listBoletos: 'finance.boletos.view',
    createBoleto: 'finance.boletos.create',
    deleteBoleto: 'finance.boletos.delete',
    listPixCharges: 'finance.pix.view',
    createPixCharge: 'finance.pix.create',
    cancelPixCharge: 'finance.pix.cancel',
  }],
  [BillingController, 'billing', {
    listRules: 'finance.billing.view',
    seedDefaults: 'finance.billing.configure',
    updateRule: 'finance.billing.configure',
    runNow: 'finance.billing.execute',
    getCollectionStatus: 'finance.billing.view',
    getDailyReport: 'finance.billing.view',
    triggerCollection: 'finance.billing.execute',
  }],
  [BudgetController, 'budget', {
    upsert: 'finance.budget.create',
    findAll: 'finance.budget.view',
    getVariance: 'finance.budget.view',
    delete: 'finance.budget.delete',
  }],
  [AcquirerController, 'acquirer', {
    create: 'finance.acquirers.manage',
    findAll: 'finance.acquirers.view',
    updateFee: 'finance.acquirers.manage',
    resolveFee: 'finance.acquirers.view',
    addFee: 'finance.acquirers.manage',
    findOne: 'finance.acquirers.view',
    update: 'finance.acquirers.manage',
  }],
  [BudgetPlanController, 'budget-plan', {
    create: 'finance.budget-plans.manage',
    list: 'finance.budget-plans.view',
    projection: 'finance.budget-plans.view',
    sensitivity: 'finance.budget-plans.view',
    vsRealized: 'finance.budget-plans.view',
    update: 'finance.budget-plans.manage',
    remove: 'finance.budget-plans.manage',
    upsertDriver: 'finance.budget-plans.manage',
    removeDriver: 'finance.budget-plans.manage',
  }],
  [InvestmentController, 'investment', {
    create: 'finance.investments.manage',
    list: 'finance.investments.view',
    compare: 'finance.investments.view',
    get: 'finance.investments.view',
    update: 'finance.investments.manage',
    remove: 'finance.investments.manage',
    upsertCashflow: 'finance.investments.manage',
    removeCashflow: 'finance.investments.manage',
    approve: 'finance.investments.approve',
    reject: 'finance.investments.approve',
  }],
  [FinancialForecastController, 'financial-forecast', {
    financial: 'finance.reports.view',
  }],
];

describe('#341 parte 2 (PR E1) — matriz financeiro/banking/billing/FP&A (issue #623)', () => {
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

  describe('FINANCEIRO opera o dia a dia, sem configurar nem write-off', () => {
    it('lança, paga, parcela, concilia, emite boleto/PIX, adianta e paga dívida', async () => {
      expect(await canAccess(FinanceController, 'createManualEntry', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(FinanceController, 'updateEntry', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(FinanceController, 'pay', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(FinanceController, 'createInstallments', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(BankingController, 'importOfx', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(BankingController, 'matchManual', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(BankingController, 'createBoleto', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(BankingController, 'createPixCharge', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(FinanceController, 'createAdvance', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(FinanceController, 'createDebt', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(FinanceController, 'payDebtInstallment', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(BillingController, 'triggerCollection', 'FINANCEIRO')).toBe(true);
    });

    it('NÃO faz write-off, NÃO configura (provisões/régua/conta/adquirente) e NÃO exporta book', async () => {
      expect(await canAccess(FinanceController, 'writeOff', 'FINANCEIRO')).toBe(false);
      expect(await canAccess(FinanceController, 'seedProvisionDefaults', 'FINANCEIRO')).toBe(false);
      expect(await canAccess(FinanceController, 'updateProvisionRule', 'FINANCEIRO')).toBe(false);
      expect(await canAccess(BillingController, 'updateRule', 'FINANCEIRO')).toBe(false);
      expect(await canAccess(BankingController, 'configureAccount', 'FINANCEIRO')).toBe(false);
      expect(await canAccess(AcquirerController, 'create', 'FINANCEIRO')).toBe(false);
      expect(await canAccess(AcquirerController, 'updateFee', 'FINANCEIRO')).toBe(false);
      expect(await canAccess(FinanceController, 'managementBook', 'FINANCEIRO')).toBe(false);
    });

    it('cancelar adiantamento é gerência; contas bancárias são somente leitura', async () => {
      expect(await canAccess(FinanceController, 'cancelAdvance', 'FINANCEIRO')).toBe(false);
      expect(await canAccess(FinanceController, 'findAllBankAccounts', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(FinanceController, 'createBankAccount', 'FINANCEIRO')).toBe(false);
      expect(await canAccess(FinanceController, 'deactivateBankAccount', 'FINANCEIRO')).toBe(false);
    });

    it('investimentos e budget-plans: só leitura', async () => {
      expect(await canAccess(InvestmentController, 'list', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(InvestmentController, 'create', 'FINANCEIRO')).toBe(false);
      expect(await canAccess(InvestmentController, 'approve', 'FINANCEIRO')).toBe(false);
      expect(await canAccess(BudgetPlanController, 'list', 'FINANCEIRO')).toBe(true);
      expect(await canAccess(BudgetPlanController, 'create', 'FINANCEIRO')).toBe(false);
    });
  });

  describe('GERENTE_FINANCEIRO é o dono do módulo (exceto alçada de investimento)', () => {
    it('faz o sensível: write-off, provisões, régua, conta, adquirentes, exports', async () => {
      expect(await canAccess(FinanceController, 'writeOff', 'GERENTE_FINANCEIRO')).toBe(true);
      expect(await canAccess(FinanceController, 'updateProvisionRule', 'GERENTE_FINANCEIRO')).toBe(true);
      expect(await canAccess(BillingController, 'updateRule', 'GERENTE_FINANCEIRO')).toBe(true);
      expect(await canAccess(BankingController, 'configureAccount', 'GERENTE_FINANCEIRO')).toBe(true);
      expect(await canAccess(FinanceController, 'createBankAccount', 'GERENTE_FINANCEIRO')).toBe(true);
      expect(await canAccess(AcquirerController, 'create', 'GERENTE_FINANCEIRO')).toBe(true);
      expect(await canAccess(AcquirerController, 'updateFee', 'GERENTE_FINANCEIRO')).toBe(true);
      expect(await canAccess(FinanceController, 'managementBook', 'GERENTE_FINANCEIRO')).toBe(true);
      expect(await canAccess(FinanceController, 'cancelAdvance', 'GERENTE_FINANCEIRO')).toBe(true);
      expect(await canAccess(FinanceController, 'updateEntry', 'GERENTE_FINANCEIRO')).toBe(true);
      expect(await canAccess(InvestmentController, 'create', 'GERENTE_FINANCEIRO')).toBe(true);
      expect(await canAccess(BudgetPlanController, 'create', 'GERENTE_FINANCEIRO')).toBe(true);
    });

    it('NÃO aprova investimento (alçada é DIRETOR/admins — quem gerencia não aprova)', async () => {
      expect(await canAccess(InvestmentController, 'approve', 'GERENTE_FINANCEIRO')).toBe(false);
      expect(await canAccess(InvestmentController, 'reject', 'GERENTE_FINANCEIRO')).toBe(false);
    });
  });

  describe('DIRETOR vê e aprova, não opera (decisão Rafael #623)', () => {
    it('vê lançamentos/relatórios/book e aprova investimento', async () => {
      expect(await canAccess(FinanceController, 'findAll', 'DIRETOR')).toBe(true);
      expect(await canAccess(FinanceController, 'getDre', 'DIRETOR')).toBe(true);
      expect(await canAccess(FinanceController, 'managementBook', 'DIRETOR')).toBe(true);
      expect(await canAccess(InvestmentController, 'approve', 'DIRETOR')).toBe(true);
      expect(await canAccess(InvestmentController, 'reject', 'DIRETOR')).toBe(true);
      expect(await canAccess(InvestmentController, 'list', 'DIRETOR')).toBe(true);
    });

    it('NÃO paga, NÃO faz write-off, NÃO concilia, NÃO configura, NÃO gerencia investimento', async () => {
      expect(await canAccess(FinanceController, 'pay', 'DIRETOR')).toBe(false);
      expect(await canAccess(FinanceController, 'createManualEntry', 'DIRETOR')).toBe(false);
      expect(await canAccess(FinanceController, 'updateEntry', 'DIRETOR')).toBe(false);
      expect(await canAccess(FinanceController, 'writeOff', 'DIRETOR')).toBe(false);
      expect(await canAccess(BankingController, 'importOfx', 'DIRETOR')).toBe(false);
      expect(await canAccess(BankingController, 'configureAccount', 'DIRETOR')).toBe(false);
      expect(await canAccess(BillingController, 'updateRule', 'DIRETOR')).toBe(false);
      expect(await canAccess(InvestmentController, 'create', 'DIRETOR')).toBe(false);
    });

    it('NÃO vê taxas de adquirente (restritas a financeiro/auditor/admins)', async () => {
      expect(await canAccess(AcquirerController, 'findAll', 'DIRETOR')).toBe(false);
      expect(await canAccess(AcquirerController, 'findOne', 'DIRETOR')).toBe(false);
    });
  });

  describe('AUDITOR lê tudo e exporta, sem nenhuma mutação', () => {
    it('leituras + exports liberados', async () => {
      expect(await canAccess(FinanceController, 'findAll', 'AUDITOR')).toBe(true);
      expect(await canAccess(BankingController, 'findAllAccounts', 'AUDITOR')).toBe(true);
      expect(await canAccess(AcquirerController, 'findAll', 'AUDITOR')).toBe(true);
      expect(await canAccess(FinanceController, 'managementBook', 'AUDITOR')).toBe(true);
      expect(await canAccess(InvestmentController, 'list', 'AUDITOR')).toBe(true);
    });

    it('mutações negadas', async () => {
      expect(await canAccess(FinanceController, 'pay', 'AUDITOR')).toBe(false);
      expect(await canAccess(FinanceController, 'writeOff', 'AUDITOR')).toBe(false);
      expect(await canAccess(BankingController, 'importOfx', 'AUDITOR')).toBe(false);
      expect(await canAccess(InvestmentController, 'approve', 'AUDITOR')).toBe(false);
      expect(await canAccess(AcquirerController, 'update', 'AUDITOR')).toBe(false);
    });
  });

  describe('perfis fora do financeiro', () => {
    it('SOMENTE_LEITURA: fora de todo o módulo finance (inclusive taxas de cartão)', async () => {
      expect(await canAccess(FinanceController, 'findAll', 'SOMENTE_LEITURA')).toBe(false);
      expect(await canAccess(BankingController, 'findAllAccounts', 'SOMENTE_LEITURA')).toBe(false);
      expect(await canAccess(AcquirerController, 'findAll', 'SOMENTE_LEITURA')).toBe(false);
      expect(await canAccess(FinanceController, 'managementBook', 'SOMENTE_LEITURA')).toBe(false);
    });

    it('VENDEDOR e LOJA_OPERACIONAL não veem taxas de adquirente (decisão Rafael)', async () => {
      expect(await canAccess(AcquirerController, 'findAll', 'VENDEDOR')).toBe(false);
      expect(await canAccess(AcquirerController, 'findAll', 'LOJA_OPERACIONAL')).toBe(false);
      expect(await canAccess(AcquirerController, 'findAll', 'GERENTE_LOJA')).toBe(false);
      expect(await canAccess(AcquirerController, 'findAll', 'GERENTE_COMERCIAL')).toBe(false);
    });

    it('GERENTE_GERAL: leitura de lançamentos/relatórios/planos, sem book e sem escrita', async () => {
      expect(await canAccess(FinanceController, 'findAll', 'GERENTE_GERAL')).toBe(true);
      expect(await canAccess(InvestmentController, 'list', 'GERENTE_GERAL')).toBe(true);
      expect(await canAccess(BudgetPlanController, 'list', 'GERENTE_GERAL')).toBe(true);
      expect(await canAccess(FinanceController, 'managementBook', 'GERENTE_GERAL')).toBe(false);
      expect(await canAccess(FinanceController, 'pay', 'GERENTE_GERAL')).toBe(false);
      expect(await canAccess(BudgetController, 'upsert', 'GERENTE_GERAL')).toBe(false);
      expect(await canAccess(InvestmentController, 'approve', 'GERENTE_GERAL')).toBe(false);
    });

    it('admins: ADMIN_GLOBAL e ADMIN_EMPRESA fazem tudo do bloco', async () => {
      for (const admin of ['ADMIN_GLOBAL', 'ADMIN_EMPRESA']) {
        expect(await canAccess(FinanceController, 'writeOff', admin)).toBe(true);
        expect(await canAccess(InvestmentController, 'approve', admin)).toBe(true);
        expect(await canAccess(AcquirerController, 'update', admin)).toBe(true);
        expect(await canAccess(BillingController, 'updateRule', admin)).toBe(true);
      }
    });
  });
});
