import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { lastValueFrom, of } from 'rxjs';
import { AuditService } from '../../modules/iam/audit.service';
import { AuditInterceptor } from './audit.interceptor';

/**
 * Testes da PERSISTÊNCIA do AuditInterceptor v2 (#343).
 * Arquivo separado de propósito: o PR #456 (sec/guard-tests) tem o spec do
 * comportamento de console (audit.interceptor.spec.ts) — este arquivo cobre
 * só o que a #343 adicionou, sem conflitar quando os PRs se encontrarem.
 */

function makeContext(
  method: string,
  options: { user?: any; url?: string; body?: any } = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        url: options.url ?? '/api/products/prod-1',
        ip: '10.0.0.1',
        body: options.body,
        headers: { 'user-agent': 'jest', 'x-request-id': 'req-123' },
        user: options.user,
      }),
    }),
  } as unknown as ExecutionContext;
}

function makeNext(): CallHandler {
  return { handle: jest.fn(() => of({ ok: true })) } as unknown as CallHandler;
}

describe('AuditInterceptor v2 — persistência via AuditService (#343)', () => {
  let mockAuditService: { log: jest.Mock };
  let interceptor: AuditInterceptor;
  const user = { id: 'user-1', companyId: 'co-1', sessionId: 'sess-1' };

  beforeEach(() => {
    mockAuditService = { log: jest.fn().mockResolvedValue(undefined) };
    interceptor = new AuditInterceptor(mockAuditService as unknown as AuditService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('persiste mutation autenticada com entidade, ação, contexto e body redigido', async () => {
    await lastValueFrom(
      interceptor.intercept(
        makeContext('PATCH', { user, body: { name: 'Novo', password: '123' } }),
        makeNext(),
      ),
    );

    expect(mockAuditService.log).toHaveBeenCalledTimes(1);
    const entry = mockAuditService.log.mock.calls[0][0];
    expect(entry).toEqual(
      expect.objectContaining({
        companyId: 'co-1',
        userId: 'user-1',
        sessionId: 'sess-1',
        entity: 'products',
        entityId: 'prod-1',
        action: AuditAction.UPDATE,
        module: 'products',
        ipAddress: '10.0.0.1',
        userAgent: 'jest',
        requestId: 'req-123',
      }),
    );
    expect(entry.duration).toEqual(expect.any(Number));
    // redação de sensíveis no body
    expect(entry.newValue).toEqual({ name: 'Novo', password: '[REDACTED]' });
  });

  it.each([
    ['POST', AuditAction.CREATE],
    ['PUT', AuditAction.UPDATE],
    ['DELETE', AuditAction.DELETE],
  ])('mapeia %s para AuditAction.%s', async (method, action) => {
    await lastValueFrom(interceptor.intercept(makeContext(method, { user }), makeNext()));
    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action }),
    );
  });

  it('ignora GET (leitura não persiste auditoria)', async () => {
    await lastValueFrom(interceptor.intercept(makeContext('GET', { user }), makeNext()));
    expect(mockAuditService.log).not.toHaveBeenCalled();
  });

  it('não persiste request anônima (sem companyId não há FK possível)', async () => {
    await lastValueFrom(interceptor.intercept(makeContext('POST'), makeNext()));
    expect(mockAuditService.log).not.toHaveBeenCalled();
  });

  it('não persiste rotas de /auth (cobertas por SecurityEvent síncrono)', async () => {
    await lastValueFrom(
      interceptor.intercept(
        makeContext('POST', { user, url: '/api/auth/logout' }),
        makeNext(),
      ),
    );
    expect(mockAuditService.log).not.toHaveBeenCalled();
  });

  it('mantém o log de console original (compatível com os specs do PR #456)', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log');
    await lastValueFrom(interceptor.intercept(makeContext('POST', { user }), makeNext()));
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'POST /api/products/prod-1',
        userId: 'user-1',
        companyId: 'co-1',
      }),
    );
  });

  it('funciona em modo console-only sem AuditService (new AuditInterceptor())', async () => {
    const legacy = new AuditInterceptor();
    const result = await lastValueFrom(
      legacy.intercept(makeContext('POST', { user }), makeNext()),
    );
    expect(result).toEqual({ ok: true });
    expect(mockAuditService.log).not.toHaveBeenCalled();
  });

  it('nunca derruba a request mesmo se a montagem do log explodir', async () => {
    mockAuditService.log.mockImplementation(() => {
      throw new Error('boom');
    });
    const result = await lastValueFrom(
      interceptor.intercept(makeContext('POST', { user }), makeNext()),
    );
    expect(result).toEqual({ ok: true });
  });
});
