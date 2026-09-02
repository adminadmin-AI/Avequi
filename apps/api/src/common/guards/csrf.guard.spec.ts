import { ForbiddenException } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard';

function ctx(req: any, res: any = { setHeader: jest.fn() }) {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as any;
}

/** Reflector falso: responde a isenção que o teste pedir. */
function reflectorQueIsenta(isento: boolean) {
  return { getAllAndOverride: () => isento } as any;
}

describe('CsrfGuard (#349 — double-submit do canal cookie)', () => {
  const guard = new CsrfGuard();
  const CSRF = 'a'.repeat(64);

  it('libera métodos de leitura mesmo com cookies e sem header', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(
        guard.canActivate(
          ctx({ method, cookies: { gdr_access: 'jwt', gdr_csrf: CSRF }, headers: {} }),
        ),
      ).toBe(true);
    }
  });

  it('libera mutação SEM cookie de access (Bearer puro, webhook, login inicial)', () => {
    expect(
      guard.canActivate(ctx({ method: 'POST', cookies: {}, headers: {} })),
    ).toBe(true);
    expect(
      guard.canActivate(ctx({ method: 'POST', cookies: undefined, headers: {} })),
    ).toBe(true);
  });

  it('libera mutação com cookie MAS com header Authorization (Bearer tem precedência)', () => {
    expect(
      guard.canActivate(
        ctx({
          method: 'POST',
          cookies: { gdr_access: 'jwt', gdr_csrf: CSRF },
          headers: { authorization: 'Bearer x' },
        }),
      ),
    ).toBe(true);
  });

  it('libera mutação por cookie quando o header x-csrf-token bate com o cookie', () => {
    expect(
      guard.canActivate(
        ctx({
          method: 'POST',
          cookies: { gdr_access: 'jwt', gdr_csrf: CSRF },
          headers: { 'x-csrf-token': CSRF },
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ['sem header', undefined],
    ['header errado', 'b'.repeat(64)],
    ['header de tamanho diferente', 'curto'],
  ])('403 em mutação por cookie com %s', (_caso, header) => {
    const headers: any = {};
    if (header !== undefined) headers['x-csrf-token'] = header;
    expect(() =>
      guard.canActivate(
        ctx({ method: 'POST', cookies: { gdr_access: 'jwt', gdr_csrf: CSRF }, headers }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('403 quando o cookie gdr_csrf está ausente (só o access presente)', () => {
    expect(() =>
      guard.canActivate(
        ctx({
          method: 'DELETE',
          cookies: { gdr_access: 'jwt' },
          headers: { 'x-csrf-token': CSRF },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('cobre todos os métodos de mutação', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(() =>
        guard.canActivate(
          ctx({ method, cookies: { gdr_access: 'jwt', gdr_csrf: CSRF }, headers: {} }),
        ),
      ).toThrow(ForbiddenException);
    }
  });
});

describe('CsrfGuard — isenção e sinalização (fallbacks #349)', () => {
  const CSRF = 'a'.repeat(64);
  const mutacaoSemHeader = {
    method: 'POST',
    cookies: { gdr_access: 'jwt', gdr_csrf: CSRF },
    headers: {},
  };

  it('@SkipCsrf() libera a rota mesmo sem o header — é a saída do trancamento', () => {
    const guard = new CsrfGuard(reflectorQueIsenta(true));
    expect(guard.canActivate(ctx(mutacaoSemHeader))).toBe(true);
  });

  it('sem isenção, a mesma requisição continua sendo barrada', () => {
    const guard = new CsrfGuard(reflectorQueIsenta(false));
    expect(() => guard.canActivate(ctx(mutacaoSemHeader))).toThrow(ForbiddenException);
  });

  it('marca a resposta com x-csrf-error para o cliente saber que dá para renovar', () => {
    const guard = new CsrfGuard(reflectorQueIsenta(false));
    const res = { setHeader: jest.fn() };
    expect(() => guard.canActivate(ctx(mutacaoSemHeader, res))).toThrow(ForbiddenException);
    expect(res.setHeader).toHaveBeenCalledWith('x-csrf-error', '1');
  });

  it('403 de permissão (outro guard) não leva o header — só o de CSRF é recuperável', () => {
    const guard = new CsrfGuard(reflectorQueIsenta(false));
    const res = { setHeader: jest.fn() };
    // requisição válida passa direto: nenhum header de erro é marcado
    guard.canActivate(
      ctx(
        { method: 'POST', cookies: { gdr_access: 'jwt', gdr_csrf: CSRF }, headers: { 'x-csrf-token': CSRF } },
        res,
      ),
    );
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('sem reflector (uso direto nos specs antigos) nada é isento', () => {
    const guard = new CsrfGuard();
    expect(() => guard.canActivate(ctx(mutacaoSemHeader))).toThrow(ForbiddenException);
  });
});

describe('CsrfGuard — POST /auth/change-password no canal cookie (rota @Public NÃO é isenta)', () => {
  const base = {
    method: 'POST',
    url: '/api/auth/change-password',
    cookies: { gdr_access: 'tok', gdr_csrf: 'segredo' },
  };

  it('cookie de access sem x-csrf-token → 403 (formulário cross-site não passa)', () => {
    const guard = new CsrfGuard();
    expect(() => guard.canActivate(ctx({ ...base, headers: {} }))).toThrow(ForbiddenException);
  });

  it('cookie de access + x-csrf-token igual ao cookie gdr_csrf → passa (fluxo do front)', () => {
    const guard = new CsrfGuard();
    expect(guard.canActivate(ctx({ ...base, headers: { 'x-csrf-token': 'segredo' } }))).toBe(true);
  });

  it('cliente Bearer (sem cookie de access) → passa sem CSRF, como antes', () => {
    const guard = new CsrfGuard();
    expect(
      guard.canActivate(ctx({ method: 'POST', cookies: {}, headers: { authorization: 'Bearer x' } })),
    ).toBe(true);
  });
});
