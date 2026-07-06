import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function makeContext(user?: { role?: string }): ExecutionContext {
  const handler = jest.fn();
  const cls = jest.fn();
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  // reflector.getAllAndOverride e chamado 2x por request:
  // 1a chamada -> IS_PUBLIC_KEY, 2a chamada -> ROLES_KEY
  function mockMetadata(isPublic: boolean | undefined, roles: string[] | undefined) {
    reflector.getAllAndOverride
      .mockReturnValueOnce(isPublic)
      .mockReturnValueOnce(roles);
  }

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('libera rota @Public sem checar roles', () => {
    mockMetadata(true, undefined);
    expect(guard.canActivate(makeContext(undefined))).toBe(true);
    // curto-circuito: nao chega a ler ROLES_KEY
    expect(reflector.getAllAndOverride).toHaveBeenCalledTimes(1);
  });

  it('libera quando a rota nao declara @Roles', () => {
    mockMetadata(undefined, undefined);
    expect(guard.canActivate(makeContext({ role: 'READER' }))).toBe(true);
  });

  it('libera quando o user tem uma das roles exigidas', () => {
    mockMetadata(undefined, ['SUPER_ADMIN', 'MANAGER']);
    expect(guard.canActivate(makeContext({ role: 'MANAGER' }))).toBe(true);
  });

  it('bloqueia quando o user tem role diferente das exigidas', () => {
    mockMetadata(undefined, ['SUPER_ADMIN', 'DIRECTOR']);
    expect(guard.canActivate(makeContext({ role: 'READER' }))).toBe(false);
  });

  it('bloqueia quando o user nao tem role definida', () => {
    mockMetadata(undefined, ['SUPER_ADMIN']);
    expect(guard.canActivate(makeContext({}))).toBe(false);
  });

  it('bloqueia quando nao ha user no request (fail-closed)', () => {
    mockMetadata(undefined, ['SUPER_ADMIN']);
    expect(guard.canActivate(makeContext(undefined))).toBe(false);
  });
});
