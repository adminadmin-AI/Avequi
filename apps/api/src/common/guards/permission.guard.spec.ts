import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { PermissionService } from '../../modules/iam/permission.service';

describe('PermissionGuard (#341)', () => {
  let reflector: jest.Mocked<Reflector>;
  let permissionService: jest.Mocked<
    Pick<PermissionService, 'resolveWithLegacyFallback'>
  >;
  let guard: PermissionGuard;

  const makeContext = (user: any = undefined): ExecutionContext =>
    ({
      getHandler: () => ({}) as any,
      getClass: () => ({}) as any,
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  /** Configura o par de leituras de metadata do guard: @Public e @RequirePermission */
  const setMetadata = (opts: { isPublic?: boolean; required?: string[] | undefined }) => {
    reflector.getAllAndOverride.mockImplementation((key: any) => {
      if (key === IS_PUBLIC_KEY) return opts.isPublic;
      if (key === REQUIRE_PERMISSION_KEY) return opts.required;
      return undefined;
    });
  };

  const userOk = { id: 'user-1', companyId: 'company-1', role: 'MANAGER' };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as any;
    permissionService = { resolveWithLegacyFallback: jest.fn() } as any;
    guard = new PermissionGuard(reflector, permissionService as any);
  });

  it('libera rota @Public sem consultar o PermissionService', async () => {
    setMetadata({ isPublic: true, required: ['iam.audit-logs.view'] });
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    expect(permissionService.resolveWithLegacyFallback).not.toHaveBeenCalled();
  });

  it('libera rota SEM metadata @RequirePermission (nada muda para endpoints só com @Roles)', async () => {
    setMetadata({ required: undefined });
    await expect(guard.canActivate(makeContext(userOk))).resolves.toBe(true);
    expect(permissionService.resolveWithLegacyFallback).not.toHaveBeenCalled();
  });

  it('libera com metadata vazia (lista [] não é exigência)', async () => {
    setMetadata({ required: [] });
    await expect(guard.canActivate(makeContext(userOk))).resolves.toBe(true);
    expect(permissionService.resolveWithLegacyFallback).not.toHaveBeenCalled();
  });

  it('fail-closed: 403 se não há usuário no request (defesa contra reordenação de guards)', async () => {
    setMetadata({ required: ['iam.audit-logs.view'] });
    await expect(guard.canActivate(makeContext(undefined))).rejects.toThrow(
      ForbiddenException,
    );
    expect(permissionService.resolveWithLegacyFallback).not.toHaveBeenCalled();
  });

  it('fail-closed: 403 se o usuário não tem companyId', async () => {
    setMetadata({ required: ['iam.audit-logs.view'] });
    await expect(
      guard.canActivate(makeContext({ id: 'user-1' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('libera quando o usuário tem a permissão exigida', async () => {
    setMetadata({ required: ['iam.audit-logs.view'] });
    permissionService.resolveWithLegacyFallback.mockResolvedValue({
      legacyFallback: false,
      resolved: {
      roles: ['ADMIN_GLOBAL'],
      permissions: ['iam.audit-logs.view', 'sales.orders.view'],
    },
    });
    await expect(guard.canActivate(makeContext(userOk))).resolves.toBe(true);
    expect(permissionService.resolveWithLegacyFallback).toHaveBeenCalledWith(
      'user-1',
      'company-1',
      'MANAGER', // #946: o enum entra na resolução (fallback legado)
      'route_guard', // #1006 D1: só telemetria, não participa da decisão
    );
  });

  it('bloqueia com 403 e mensagem pt-BR informando QUAL permissão faltou', async () => {
    setMetadata({ required: ['iam.audit-logs.view'] });
    permissionService.resolveWithLegacyFallback.mockResolvedValue({
      legacyFallback: false,
      resolved: {
      roles: ['VENDEDOR'],
      permissions: ['sales.orders.view'],
    },
    });
    await expect(guard.canActivate(makeContext(userOk))).rejects.toThrow(
      /Você não tem permissão.*iam\.audit-logs\.view/,
    );
  });

  it('semântica AND: exige TODAS — ter só uma das duas bloqueia e aponta a que falta', async () => {
    setMetadata({ required: ['finance.entries.view', 'finance.entries.pay'] });
    permissionService.resolveWithLegacyFallback.mockResolvedValue({
      legacyFallback: false,
      resolved: {
      roles: ['FINANCEIRO'],
      permissions: ['finance.entries.view'],
    },
    });
    let erro: any;
    await guard.canActivate(makeContext(userOk)).catch((e) => (erro = e));
    expect(erro).toBeInstanceOf(ForbiddenException);
    expect(erro.message).toContain('finance.entries.pay');
    expect(erro.message).not.toContain('finance.entries.view,');
  });

  it('semântica AND: libera quando tem todas', async () => {
    setMetadata({ required: ['finance.entries.view', 'finance.entries.pay'] });
    permissionService.resolveWithLegacyFallback.mockResolvedValue({
      legacyFallback: false,
      resolved: {
      roles: ['GERENTE_FINANCEIRO'],
      permissions: ['finance.entries.view', 'finance.entries.pay'],
    },
    });
    await expect(guard.canActivate(makeContext(userOk))).resolves.toBe(true);
  });

  it('resolve permissões UMA vez por request, mesmo com múltiplos codes', async () => {
    setMetadata({ required: ['finance.entries.view', 'finance.entries.pay'] });
    permissionService.resolveWithLegacyFallback.mockResolvedValue({
      legacyFallback: false,
      resolved: {
      roles: [],
      permissions: ['finance.entries.view', 'finance.entries.pay'],
    },
    });
    await guard.canActivate(makeContext(userOk));
    expect(permissionService.resolveWithLegacyFallback).toHaveBeenCalledTimes(1);
  });

  it('fail-closed: erro na resolução (ex.: banco fora) → 403 genérico, nunca liberação', async () => {
    setMetadata({ required: ['iam.audit-logs.view'] });
    permissionService.resolveWithLegacyFallback.mockRejectedValue(
      new Error('ECONNREFUSED: banco fora do ar'),
    );
    await expect(guard.canActivate(makeContext(userOk))).rejects.toThrow(
      /Não foi possível verificar suas permissões/,
    );
  });

  it('fail-closed: o 403 de erro de infraestrutura NÃO vaza detalhes internos', async () => {
    setMetadata({ required: ['iam.audit-logs.view'] });
    permissionService.resolveWithLegacyFallback.mockRejectedValue(
      new Error('ECONNREFUSED 10.0.0.5:5432'),
    );
    let erro: any;
    await guard.canActivate(makeContext(userOk)).catch((e) => (erro = e));
    expect(erro).toBeInstanceOf(ForbiddenException);
    expect(erro.message).not.toContain('ECONNREFUSED');
  });

  // ── #946: guard e menu usam a MESMA resolução (fallback legado incluído) ──

  it('usa resolveWithLegacyFallback com o enum do usuário — mesma regra do /auth/me', async () => {
    setMetadata({ required: ['sales.orders.view'] });
    permissionService.resolveWithLegacyFallback.mockResolvedValue({
      legacyFallback: true,
      resolved: { roles: ['GERENTE_GERAL'], permissions: ['sales.orders.view'] },
    } as any);

    await expect(guard.canActivate(makeContext(userOk))).resolves.toBe(true);
    expect(permissionService.resolveWithLegacyFallback).toHaveBeenCalledWith(
      userOk.id,
      userOk.companyId,
      userOk.role,
      'route_guard', // #1006 D1: só telemetria, não participa da decisão
    );
  });

  it('usuário legado sem v2: o que o menu mostra a API concede (fim do 403 fantasma)', async () => {
    setMetadata({ required: ['sales.orders.view'] });
    permissionService.resolveWithLegacyFallback.mockResolvedValue({
      legacyFallback: true,
      resolved: { roles: ['VENDEDOR'], permissions: ['sales.orders.view'] },
    } as any);

    await expect(guard.canActivate(makeContext(userOk))).resolves.toBe(true);
  });

  it('usuário COM v2: o fallback não entra e o deny do v2 continua valendo', async () => {
    setMetadata({ required: ['iam.roles.manage'] });
    // v2 configurado (sem a permissão exigida) → legacyFallback false
    permissionService.resolveWithLegacyFallback.mockResolvedValue({
      legacyFallback: false,
      resolved: { roles: ['VENDEDOR'], permissions: ['sales.orders.view'] },
    } as any);

    await expect(guard.canActivate(makeContext(userOk))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
