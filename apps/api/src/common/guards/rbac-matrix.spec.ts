import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { FinanceController } from '../../modules/finance/finance.controller';
import { BankingController } from '../../modules/finance/banking.controller';
import { FiscalController } from '../../modules/fiscal/fiscal.controller';
import { StockController } from '../../modules/stock/stock.controller';
import { PurchaseController } from '../../modules/purchase/purchase.controller';
import { SalesController } from '../../modules/sales/sales.controller';
import { UserController } from '../../modules/user/user.controller';
import { QualityController } from '../../modules/quality/quality.controller';
import { TransferController } from '../../modules/transfer/transfer.controller';
import { WmsController } from '../../modules/wms/wms.controller';
import { ProductionController } from '../../modules/production/production.controller';
import { BomController } from '../../modules/bom/bom.controller';

/**
 * Testes da matriz RBAC (docs/RBAC.md).
 *
 * Usa o RolesGuard REAL + Reflector REAL contra os metadados @Roles()
 * dos controllers de verdade — sem mock de metadados. Se alguém remover
 * ou afrouxar um @Roles(), esses testes quebram.
 */
describe('Matriz RBAC — RolesGuard real contra os controllers', () => {
  const guard = new RolesGuard(new Reflector());

  /** Monta um ExecutionContext mínimo apontando para classe+handler reais */
  function contextFor(
    controllerClass: any,
    handlerName: string,
    role: string,
  ): ExecutionContext {
    const handler = controllerClass.prototype[handlerName];
    if (!handler) {
      throw new Error(
        `Handler "${handlerName}" não existe em ${controllerClass.name}`,
      );
    }
    return {
      getHandler: () => handler,
      getClass: () => controllerClass,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role } }),
      }),
    } as unknown as ExecutionContext;
  }

  function expectAllowed(controller: any, handler: string, role: string) {
    expect(guard.canActivate(contextFor(controller, handler, role))).toBe(true);
  }

  function expectDenied(controller: any, handler: string, role: string) {
    expect(guard.canActivate(contextFor(controller, handler, role))).toBe(
      false,
    );
  }

  // ─── Finance ────────────────────────────────────────────────────────────────

  describe('Finance (/finance)', () => {
    it('READER não lê lançamentos financeiros (leitura restrita)', () => {
      expectDenied(FinanceController, 'findAll', 'READER');
      expectDenied(FinanceController, 'findAll', 'WAREHOUSE');
      expectDenied(FinanceController, 'findAll', 'COMMERCIAL');
    });

    it('FINANCIAL, MANAGER, DIRECTOR e SUPER_ADMIN leem lançamentos', () => {
      for (const role of ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'FINANCIAL']) {
        expectAllowed(FinanceController, 'findAll', role);
      }
    });

    it('SUPER_ADMIN, DIRECTOR e FINANCIAL registram pagamento (DIRECTOR operacional — decisão Rafael 04/07)', () => {
      expectAllowed(FinanceController, 'pay', 'FINANCIAL');
      expectAllowed(FinanceController, 'pay', 'SUPER_ADMIN');
      expectAllowed(FinanceController, 'pay', 'DIRECTOR');
      expectDenied(FinanceController, 'pay', 'MANAGER');
      expectDenied(FinanceController, 'pay', 'READER');
    });

    it('lançamento manual: SA/DIR/FIN; conta bancária (config) segue só SA/FIN', () => {
      expectAllowed(FinanceController, 'createManualEntry', 'FINANCIAL');
      expectAllowed(FinanceController, 'createManualEntry', 'DIRECTOR');
      expectDenied(FinanceController, 'createManualEntry', 'MANAGER');
      expectAllowed(FinanceController, 'createBankAccount', 'FINANCIAL');
      expectDenied(FinanceController, 'createBankAccount', 'DIRECTOR');
      expectDenied(FinanceController, 'createBankAccount', 'COMMERCIAL');
    });
  });

  describe('Banking (/banking)', () => {
    it('READER não vê contas bancárias', () => {
      expectDenied(BankingController, 'findAllAccounts', 'READER');
    });

    it('só SUPER_ADMIN e FINANCIAL agendam pagamento', () => {
      expectAllowed(BankingController, 'createSchedule', 'FINANCIAL');
      expectDenied(BankingController, 'createSchedule', 'MANAGER');
      expectDenied(BankingController, 'createSchedule', 'DIRECTOR');
    });
  });

  // ─── Fiscal ────────────────────────────────────────────────────────────────

  describe('Fiscal (/fiscal)', () => {
    it('qualquer autenticado lista documentos fiscais', () => {
      expectAllowed(FiscalController, 'findAll', 'READER');
      expectAllowed(FiscalController, 'findAll', 'COMMERCIAL');
    });

    it('só SUPER_ADMIN e FINANCIAL cancelam NF-e', () => {
      expectAllowed(FiscalController, 'cancel', 'FINANCIAL');
      expectAllowed(FiscalController, 'cancel', 'SUPER_ADMIN');
      expectDenied(FiscalController, 'cancel', 'MANAGER');
      expectDenied(FiscalController, 'cancel', 'READER');
    });

    it('inutilização de faixa e CC-e restritas a SUPER_ADMIN/FINANCIAL', () => {
      expectDenied(FiscalController, 'voidRange', 'COMMERCIAL');
      expectDenied(FiscalController, 'correction', 'WAREHOUSE');
      expectAllowed(FiscalController, 'voidRange', 'FINANCIAL');
    });

    it('webhook é @Public — RolesGuard libera sem usuário', () => {
      expect(
        guard.canActivate(contextFor(FiscalController, 'webhook', undefined as any)),
      ).toBe(true);
    });
  });

  // ─── Stock ─────────────────────────────────────────────────────────────────

  describe('Stock (/stock)', () => {
    it('qualquer autenticado consulta saldos', () => {
      expectAllowed(StockController, 'getBalances', 'READER');
    });

    it('READER e COMMERCIAL não movimentam estoque', () => {
      expectDenied(StockController, 'move', 'READER');
      expectDenied(StockController, 'move', 'COMMERCIAL');
    });

    it('WAREHOUSE, PRODUCTION, MANAGER, DIRECTOR e SUPER_ADMIN movimentam estoque', () => {
      for (const role of ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'WAREHOUSE', 'PRODUCTION']) {
        expectAllowed(StockController, 'move', role);
      }
    });

    it('estorno só SUPER_ADMIN e MANAGER', () => {
      expectAllowed(StockController, 'reverse', 'MANAGER');
      expectDenied(StockController, 'reverse', 'WAREHOUSE');
    });
  });

  // ─── Purchase ──────────────────────────────────────────────────────────────

  describe('Purchase (/purchase)', () => {
    it('READER não cria pedido de compra', () => {
      expectDenied(PurchaseController, 'createPO', 'READER');
      expectDenied(PurchaseController, 'createPO', 'COMMERCIAL');
    });

    it('WAREHOUSE cria PO, mas não aprova', () => {
      expectAllowed(PurchaseController, 'createPO', 'WAREHOUSE');
      expectDenied(PurchaseController, 'approvePO', 'WAREHOUSE');
    });

    it('DIRECTOR e MANAGER aprovam PO', () => {
      expectAllowed(PurchaseController, 'approvePO', 'DIRECTOR');
      expectAllowed(PurchaseController, 'approvePO', 'MANAGER');
    });

    it('cancelar solicitação de compra: WAREHOUSE/STORE sim, READER não', () => {
      expectAllowed(PurchaseController, 'cancelRequest', 'WAREHOUSE');
      expectAllowed(PurchaseController, 'cancelRequest', 'STORE');
      expectDenied(PurchaseController, 'cancelRequest', 'READER');
    });
  });

  // ─── Sales ─────────────────────────────────────────────────────────────────

  describe('Sales (/sales)', () => {
    it('qualquer autenticado lista vendas', () => {
      expectAllowed(SalesController, 'findAll', 'READER');
    });

    it('COMMERCIAL cria e confirma venda; READER e WAREHOUSE não', () => {
      expectAllowed(SalesController, 'create', 'COMMERCIAL');
      expectAllowed(SalesController, 'confirm', 'COMMERCIAL');
      expectDenied(SalesController, 'create', 'READER');
      expectDenied(SalesController, 'create', 'WAREHOUSE');
    });

    it('DIRECTOR opera venda: cria, confirma e fatura (decisão Rafael 04/07)', () => {
      expectAllowed(SalesController, 'create', 'DIRECTOR');
      expectAllowed(SalesController, 'reserve', 'DIRECTOR');
      expectAllowed(SalesController, 'confirm', 'DIRECTOR');
      expectAllowed(SalesController, 'invoice', 'DIRECTOR');
    });

    it('faturamento (NF-e): COMMERCIAL não fatura (decisão Rafael mantida)', () => {
      expectAllowed(SalesController, 'invoice', 'FINANCIAL');
      expectAllowed(SalesController, 'invoice', 'MANAGER');
      expectDenied(SalesController, 'invoice', 'COMMERCIAL');
      expectDenied(SalesController, 'invoice', 'READER');
    });

    it('STORE vende e fatura no balcão (decisão Rafael 04/07); sem devolução/cancelamento', () => {
      expectAllowed(SalesController, 'create', 'STORE');
      expectAllowed(SalesController, 'reserve', 'STORE');
      expectAllowed(SalesController, 'confirm', 'STORE');
      expectAllowed(SalesController, 'invoice', 'STORE');
      expectDenied(SalesController, 'return', 'STORE');
      expectDenied(SalesController, 'cancel', 'STORE');
    });

    it('devolução e cancelamento só SUPER_ADMIN/MANAGER', () => {
      expectAllowed(SalesController, 'return', 'MANAGER');
      expectDenied(SalesController, 'return', 'COMMERCIAL');
      expectDenied(SalesController, 'cancel', 'COMMERCIAL');
    });
  });

  // ─── User ──────────────────────────────────────────────────────────────────

  describe('User (/users)', () => {
    it('leitura de usuários restrita a SUPER_ADMIN/DIRECTOR/MANAGER', () => {
      expectAllowed(UserController, 'findAll', 'MANAGER');
      expectAllowed(UserController, 'findAll', 'DIRECTOR');
      expectDenied(UserController, 'findAll', 'READER');
      expectDenied(UserController, 'findAll', 'FINANCIAL');
      expectDenied(UserController, 'findOne', 'COMMERCIAL');
    });

    it('criação/edição de usuários restrita a SUPER_ADMIN/DIRECTOR/MANAGER', () => {
      expectAllowed(UserController, 'create', 'SUPER_ADMIN');
      expectDenied(UserController, 'create', 'FINANCIAL');
      expectDenied(UserController, 'update', 'READER');
    });
  });

  // ─── Outros módulos críticos ───────────────────────────────────────────────

  describe('Quality (/quality)', () => {
    it('QUALITY aprova/reprova inspeção; PRODUCTION não', () => {
      expectAllowed(QualityController, 'passInspection', 'QUALITY');
      expectDenied(QualityController, 'passInspection', 'PRODUCTION');
      expectDenied(QualityController, 'failInspection', 'READER');
    });
  });

  describe('Transfer (/transfers)', () => {
    it('STORE e WAREHOUSE criam/recebem transferência; READER não', () => {
      expectAllowed(TransferController, 'create', 'STORE');
      expectAllowed(TransferController, 'receive', 'WAREHOUSE');
      expectDenied(TransferController, 'create', 'READER');
    });

    it('cancelamento de transferência só SUPER_ADMIN/MANAGER', () => {
      expectAllowed(TransferController, 'cancel', 'MANAGER');
      expectDenied(TransferController, 'cancel', 'STORE');
    });
  });

  describe('WMS (/wms)', () => {
    it('WAREHOUSE faz putaway; reconciliação só SUPER_ADMIN/MANAGER', () => {
      expectAllowed(WmsController, 'confirmPutaway', 'WAREHOUSE');
      expectDenied(WmsController, 'confirmPutaway', 'READER');
      expectAllowed(WmsController, 'reconcile', 'MANAGER');
      expectDenied(WmsController, 'reconcile', 'WAREHOUSE');
    });
  });

  describe('BOM (/bom)', () => {
    it('DIRECTOR cria BOM (operacional — decisão Rafael 04/07); READER não', () => {
      expectAllowed(BomController, 'create', 'DIRECTOR');
      expectAllowed(BomController, 'create', 'PRODUCTION');
      expectDenied(BomController, 'create', 'READER');
      expectDenied(BomController, 'create', 'COMMERCIAL');
    });

    it('ativar versão de BOM (aprovação): SA/DIR/MGR', () => {
      expectAllowed(BomController, 'activate', 'DIRECTOR');
      expectDenied(BomController, 'activate', 'PRODUCTION');
    });
  });

  // Customer (/customers) migrou para o RBAC v2 no #341 parte 2 (PR B) —
  // a matriz agora é travada em pr341b.access.spec.ts (PermissionGuard real),
  // preservando a regra de balcão: LOJA cria cliente mas não edita.

  describe('Production (/production)', () => {
    it('PRODUCTION opera OPs; cancelamento só SUPER_ADMIN/MANAGER', () => {
      expectAllowed(ProductionController, 'create', 'PRODUCTION');
      expectDenied(ProductionController, 'create', 'READER');
      expectDenied(ProductionController, 'cancel', 'PRODUCTION');
      expectAllowed(ProductionController, 'cancel', 'MANAGER');
    });
  });
});
