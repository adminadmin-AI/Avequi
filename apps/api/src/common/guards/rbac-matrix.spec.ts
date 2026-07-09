import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { FinanceController } from '../../modules/finance/finance.controller';
import { BankingController } from '../../modules/finance/banking.controller';
import { FiscalController } from '../../modules/fiscal/fiscal.controller';
import { UserController } from '../../modules/user/user.controller';
import { WmsController } from '../../modules/wms/wms.controller';

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

  // Stock (/stock) migrou para o RBAC v2 no #341 parte 2 (PR C) — matriz
  // travada em pr341c.access.spec.ts (PermissionGuard real).

  // Purchase (/purchase) migrou para o RBAC v2 no #341 parte 2 (PR D) —
  // matriz travada em pr341d.access.spec.ts. SoD v2: COMPRADOR cria e não
  // aprova; ALMOXARIFE solicita/recebe (não cria PO); gerência/diretoria aprova.

  // Sales (/sales) migrou para o RBAC v2 no #341 parte 2 (PR C) — matriz
  // travada em pr341c.access.spec.ts. Decisões v2 SUPERSEDEM as de 04/07:
  // DIRETOR não opera venda; STORE fatura só via LOJA_FATURAMENTO (#463);
  // G.GERAL segue sem devolução/cancelamento (#463).

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

  // Quality (/quality) migrou para o RBAC v2 no #341 parte 2 (PR D) —
  // matriz travada em pr341d.access.spec.ts (QUALIDADE opera; G.GERAL só lê).

  // Transfer (/transfers) migrou para o RBAC v2 no #341 parte 2 (PR C) —
  // matriz travada em pr341c.access.spec.ts (equivalência plena com o legado).

  describe('WMS (/wms)', () => {
    it('WAREHOUSE faz putaway; reconciliação só SUPER_ADMIN/MANAGER', () => {
      expectAllowed(WmsController, 'confirmPutaway', 'WAREHOUSE');
      expectDenied(WmsController, 'confirmPutaway', 'READER');
      expectAllowed(WmsController, 'reconcile', 'MANAGER');
      expectDenied(WmsController, 'reconcile', 'WAREHOUSE');
    });
  });

  // BOM (/bom) migrou para o RBAC v2 no #341 parte 2 (PR D) — matriz em
  // pr341d.access.spec.ts. Decisão v2 SUPERSEDE 04/07: DIRETOR ativa (aprova)
  // mas não cria BOM.

  // Customer (/customers) migrou para o RBAC v2 no #341 parte 2 (PR B) —
  // a matriz agora é travada em pr341b.access.spec.ts (PermissionGuard real),
  // preservando a regra de balcão: LOJA cria cliente mas não edita.

  // Production (/production) migrou para o RBAC v2 no #341 parte 2 (PR D) —
  // matriz em pr341d.access.spec.ts. Desenho v2: PCP cria, supervisor libera/
  // conclui/cancela, operador inicia/aponta, qualidade aprova inspeção.
});
