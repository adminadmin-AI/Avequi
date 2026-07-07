import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

function makeContext(): ExecutionContext {
  const handler = jest.fn();
  const cls = jest.fn();
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({
      getRequest: () => ({ headers: {} }),
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    jest.restoreAllMocks();
    reflector = { getAllAndOverride: jest.fn() };
    guard = new JwtAuthGuard(reflector as unknown as Reflector);
  });

  it('libera rota @Public sem consultar o passport (sem token)', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const superSpy = jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockReturnValue(true);

    const result = guard.canActivate(makeContext());

    expect(result).toBe(true);
    expect(superSpy).not.toHaveBeenCalled();
  });

  it('consulta IS_PUBLIC_KEY no handler e na classe (getAllAndOverride)', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const ctx = makeContext();

    guard.canActivate(ctx);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
  });

  it('delega ao AuthGuard("jwt") quando a rota NAO e @Public', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const superSpy = jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockReturnValue(true);

    const result = guard.canActivate(makeContext());

    expect(superSpy).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it('propaga a recusa do passport quando o token e invalido', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockReturnValue(false);

    expect(guard.canActivate(makeContext())).toBe(false);
  });
});
