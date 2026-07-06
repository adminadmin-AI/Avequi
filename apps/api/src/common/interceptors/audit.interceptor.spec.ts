import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';

function makeContext(
  method: string,
  options: { user?: any; url?: string } = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        url: options.url ?? '/api/users',
        ip: '10.0.0.1',
        headers: { 'user-agent': 'jest' },
        user: options.user,
      }),
    }),
  } as unknown as ExecutionContext;
}

function makeNext(): CallHandler {
  return { handle: jest.fn(() => of({ ok: true })) };
}

describe('AuditInterceptor', () => {
  let interceptor: AuditInterceptor;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    interceptor = new AuditInterceptor();
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'grava audit log em mutation %s com userId e companyId',
    async (method) => {
      const user = { id: 'user-1', companyId: 'co-1' };
      const result = await lastValueFrom(
        interceptor.intercept(makeContext(method, { user }), makeNext()),
      );

      expect(result).toEqual({ ok: true });
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: `${method} /api/users`,
          userId: 'user-1',
          companyId: 'co-1',
          ip: '10.0.0.1',
          userAgent: 'jest',
        }),
      );
    },
  );

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'ignora %s (leitura nao gera audit log)',
    async (method) => {
      const next = makeNext();
      const result = await lastValueFrom(
        interceptor.intercept(makeContext(method), next),
      );

      expect(result).toEqual({ ok: true });
      expect(next.handle).toHaveBeenCalledTimes(1); // request segue normal
      expect(logSpy).not.toHaveBeenCalled();
    },
  );

  it('registra "anonymous"/"none" quando nao ha user no request', async () => {
    await lastValueFrom(
      interceptor.intercept(makeContext('POST'), makeNext()),
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'anonymous',
        companyId: 'none',
      }),
    );
  });

  it('nao engole o valor retornado pelo handler', async () => {
    const next: CallHandler = { handle: () => of({ id: 'novo-registro' }) };
    const result = await lastValueFrom(
      interceptor.intercept(makeContext('POST'), next),
    );
    expect(result).toEqual({ id: 'novo-registro' });
  });
});
