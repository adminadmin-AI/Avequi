import { CallHandler, ExecutionContext } from '@nestjs/common';
import { defer, lastValueFrom, of } from 'rxjs';
import { TenantContextInterceptor } from './tenant-context.interceptor';
import { getTenantCompanyId } from '../context/tenant-context';

describe('TenantContextInterceptor', () => {
  let interceptor: TenantContextInterceptor;

  beforeEach(() => {
    interceptor = new TenantContextInterceptor();
  });

  function mockContext(user: any, type: string = 'http'): ExecutionContext {
    return {
      getType: () => type,
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  /**
   * CallHandler cujo "handler de rota" lê o tenant do AsyncLocalStorage no
   * momento da execução — simula um service chamando getTenantCompanyId().
   */
  function tenantReadingHandler(): CallHandler {
    return {
      handle: () => defer(() => of(getTenantCompanyId())),
    };
  }

  it('disponibiliza o companyId do req.user no AsyncLocalStorage durante o handler', async () => {
    const ctx = mockContext({ id: 'user-1', companyId: 'company-1' });
    const result = await lastValueFrom(
      interceptor.intercept(ctx, tenantReadingHandler()),
    );
    expect(result).toBe('company-1');
  });

  it('nao cria contexto quando nao ha usuario (rota @Public)', async () => {
    const ctx = mockContext(undefined);
    const result = await lastValueFrom(
      interceptor.intercept(ctx, tenantReadingHandler()),
    );
    expect(result).toBeUndefined();
  });

  it('nao cria contexto quando usuario nao tem companyId', async () => {
    const ctx = mockContext({ id: 'user-1' });
    const result = await lastValueFrom(
      interceptor.intercept(ctx, tenantReadingHandler()),
    );
    expect(result).toBeUndefined();
  });

  it('ignora contextos nao-HTTP (ws/rpc)', async () => {
    const ctx = mockContext({ companyId: 'company-1' }, 'rpc');
    const result = await lastValueFrom(
      interceptor.intercept(ctx, tenantReadingHandler()),
    );
    expect(result).toBeUndefined();
  });

  it('propaga o contexto por continuacoes assincronas do handler', async () => {
    const ctx = mockContext({ companyId: 'company-async' });
    const handler: CallHandler = {
      handle: () =>
        defer(async () => {
          await new Promise((r) => setTimeout(r, 5));
          return getTenantCompanyId();
        }),
    };
    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toBe('company-async');
  });

  it('nao vaza contexto para fora do request', async () => {
    const ctx = mockContext({ companyId: 'company-1' });
    await lastValueFrom(interceptor.intercept(ctx, tenantReadingHandler()));
    expect(getTenantCompanyId()).toBeUndefined();
  });
});
