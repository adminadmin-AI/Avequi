import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequireEntitlement } from '../decorators/require-entitlement.decorator';
import { EntitlementGuard } from './entitlement.guard';

/**
 * OPS WP4 (#911) — guard de entitlement por conta.
 * Contratos: sem metadata → libera; @Public → libera; módulo não contratado
 * → 403 com mensagem de UPGRADE (≠ mensagem de permissão); erro de infra →
 * 403 (fail-closed). Decorator fail-fast em key fora do catálogo.
 */

const mockEntitlementService = { can: jest.fn() };
const reflector = new Reflector();

@RequireEntitlement('crm')
class GatedController {
  gated() {}
}
class OpenController {
  open() {}
}

function ctx(cls: any, handler: any, user: any = { id: 'u1', companyId: 'c1' }): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('EntitlementGuard (OPS WP4 #911)', () => {
  let guard: EntitlementGuard;

  beforeEach(() => {
    guard = new EntitlementGuard(reflector, mockEntitlementService as any);
    jest.clearAllMocks();
  });

  it('sem @RequireEntitlement → libera sem consultar nada', async () => {
    await expect(
      guard.canActivate(ctx(OpenController, OpenController.prototype.open)),
    ).resolves.toBe(true);
    expect(mockEntitlementService.can).not.toHaveBeenCalled();
  });

  it('conta COM o módulo → libera', async () => {
    mockEntitlementService.can.mockResolvedValue(true);
    await expect(
      guard.canActivate(ctx(GatedController, GatedController.prototype.gated)),
    ).resolves.toBe(true);
    expect(mockEntitlementService.can).toHaveBeenCalledWith('c1', 'crm');
  });

  it('conta SEM o módulo → 403 com mensagem de plano/upgrade (não de permissão)', async () => {
    mockEntitlementService.can.mockResolvedValue(false);
    await expect(
      guard.canActivate(ctx(GatedController, GatedController.prototype.gated)),
    ).rejects.toThrow(/plano contratado/);
  });

  it('erro de infra → 403 (fail-closed, mesmo racional do PermissionGuard)', async () => {
    mockEntitlementService.can.mockRejectedValue(new Error('db down'));
    await expect(
      guard.canActivate(ctx(GatedController, GatedController.prototype.gated)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('decorator: key fora do catálogo derruba na DECORAÇÃO (fail-fast)', () => {
    expect(() => RequireEntitlement('moduloQueNaoExiste')).toThrow(/não existe no catálogo/);
    expect(() => RequireEntitlement()).toThrow(/pelo menos uma key/);
  });
});
