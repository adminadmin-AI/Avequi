import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { CompanyGuard } from './company.guard';

function makeContext(user?: { companyId?: string }): ExecutionContext {
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

describe('CompanyGuard', () => {
  let guard: CompanyGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new CompanyGuard(reflector as unknown as Reflector);
  });

  it('libera user com companyId', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(makeContext({ companyId: 'co-1' }))).toBe(true);
  });

  it('bloqueia com 403 quando o user nao tem companyId', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(() => guard.canActivate(makeContext({}))).toThrow(
      ForbiddenException,
    );
  });

  it('bloqueia com 403 quando nao ha user no request (fail-closed)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(
      ForbiddenException,
    );
  });

  // Comportamento verificado: o CompanyGuard TEM bypass para @Public.
  // E por isso que rotas publicas como POST /auth/login (que nao possuem
  // req.user) funcionam em producao mesmo com o guard aplicado.
  it('libera rota @Public mesmo sem user (ex.: /auth/login)', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    expect(guard.canActivate(makeContext(undefined))).toBe(true);
  });

  it('consulta IS_PUBLIC_KEY no handler e na classe', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const ctx = makeContext(undefined);

    guard.canActivate(ctx);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
  });
});
