import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
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

  // ─── Finance/Banking ───────────────────────────────────────────────────────
  // #341 parte 2 (PR E1): os blocos Finance e Banking migraram para o gate
  // único RBAC v2 (@RequirePermission) — a matriz agora é exercitada pelo
  // PermissionGuard real em modules/finance/pr341e1.access.spec.ts.
  // Sobram aqui: Fiscal (bloco E2) e User/WMS (bloco G).

  // ─── Fiscal ────────────────────────────────────────────────────────────────
  // #341 parte 2 (PR E2): o bloco Fiscal migrou para o gate único RBAC v2 —
  // a matriz agora é exercitada pelo PermissionGuard real em
  // modules/fiscal/pr341e2.access.spec.ts (inclui o webhook @Public).
  // Sobram aqui: User e WMS (bloco G).

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
