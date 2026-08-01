import { ForbiddenException } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard';

function ctx(req: any) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
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
