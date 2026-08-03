import { ForbiddenException } from '@nestjs/common';
import { ImpersonationReadonlyGuard } from './impersonation-readonly.guard';

/** OPS WP6 (#913) — mutação sob impersonation morre na API, não no botão. */
function ctx(user: unknown, method: string) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, method }) }),
  } as never;
}

describe('ImpersonationReadonlyGuard (OPS WP6 #913)', () => {
  const guard = new ImpersonationReadonlyGuard();
  const imp = { id: 'u1', impersonation: { iid: 'x', impersonatorId: 'op', readOnly: true } };

  it('request normal (sem impersonation) passa — qualquer método', () => {
    expect(guard.canActivate(ctx({ id: 'u1' }, 'POST'))).toBe(true);
    expect(guard.canActivate(ctx(undefined, 'DELETE'))).toBe(true);
  });

  it('impersonation: GET/HEAD/OPTIONS passam', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS']) {
      expect(guard.canActivate(ctx(imp, m))).toBe(true);
    }
  });

  it('impersonation: POST/PUT/PATCH/DELETE → 403 com orientação', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(() => guard.canActivate(ctx(imp, m))).toThrow(ForbiddenException);
      expect(() => guard.canActivate(ctx(imp, m))).toThrow(/somente-leitura/);
    }
  });
});
