import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { PermissionService } from '../../modules/iam/permission.service';

describe('PermissionGuard (#341)', () => {
  let reflector: jest.Mocked<Reflector>;
  let permissionService: jest.Mocked<
    Pick<PermissionService, 'getUserPermissions'>
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
    permissionService = { getUserPermissions: jest.fn() } as any;
    guard = new PermissionGuard(reflector, permissionService as any);
  });

  it('libera rota @Public sem consultar o PermissionService', async () => {
    setMetadata({ isPublic: true, required: ['iam.audit-logs.view'] });
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    expect(permissionService.getUserPermissions).not.toHaveBeenCalled();
  });

  it('libera rota SEM metadata @RequirePermission (nada muda para endpoints só com @Roles)', async () => {
    setMetadata({ required: undefined });
    await expect(guard.canActivate(makeContext(userOk))).resolves.toBe(true);
    expect(permissionService.getUserPermissions).not.toHaveBeenCalled();
  });

  it('libera com metadata vazia (lista [] não é exigência)', async () => {
    setMetadata({ required: [] });
    await expect(guard.canActivate(makeContext(userOk))).resolves.toBe(true);
    expect(permissionService.getUserPermissions).not.toHaveBeenCalled();
  });

  it('fail-closed: 403 se não há usuário no request (defesa contra reordenação de guards)', async () => {
    setMetadata({ required: ['iam.audit-logs.view'] });
    await expect(guard.canActivate(makeContext(undefined))).rejects.toThrow(
      ForbiddenException,
    );
    expect(permissionService.getUserPermissions).not.toHaveBeenCalled();
  });

  it('fail-closed: 403 se o usuário não tem companyId', async () => {
    setMetadata({ required: ['iam.audit-logs.view'] });
    await expect(
      guard.canActivate(makeContext({ id: 'user-1' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('libera quando o usuário tem a permissão exigida', async () => {
    setMetadata({ required: ['iam.audit-logs.view'] });
    permissionService.getUserPermissions.mockResolvedValue({
      roles: ['ADMIN_GLOBAL'],
      permissions: ['iam.audit-logs.view', 'sales.orders.view'],
    });
    await expect(guard.canActivate(makeContext(userOk))).resolves.toBe(true);
    expect(permissionService.getUserPermissions).toHaveBeenCalledWith(
      'user-1',
      'company-1',
    );
  });

  it('bloqueia com 403 e mensagem pt-BR informando QUAL permissão faltou', async () => {
    setMetadata({ required: ['iam.audit-logs.view'] });
    permissionService.getUserPermissions.mockResolvedValue({
      roles: ['VENDEDOR'],
      permissions: ['sales.orders.view'],
    });
    await expect(guard.canActivate(makeContext(userOk))).rejects.toThrow(
      /Você não tem permissão.*iam\.audit-logs\.view/,
    );
  });

  it('semântica AND: exige TODAS — ter só uma das duas bloqueia e aponta a que falta', async () => {
    setMetadata({ required: ['finance.entries.view', 'finance.entries.pay'] });
    permissionService.getUserPermissions.mockResolvedValue({
      roles: ['FINANCEIRO'],
      permissions: ['finance.entries.view'],
    });
    let erro: any;
    await guard.canActivate(makeContext(userOk)).catch((e) => (erro = e));
    expect(erro).toBeInstanceOf(ForbiddenException);
    expect(erro.message).toContain('finance.entries.pay');
    expect(erro.message).not.toContain('finance.entries.view,');
  });

  it('semântica AND: libera quando tem todas', async () => {
    setMetadata({ required: ['finance.entries.view', 'finance.entries.pay'] });
    permissionService.getUserPermissions.mockResolvedValue({
      roles: ['GERENTE_FINANCEIRO'],
      permissions: ['finance.entries.view', 'finance.entries.pay'],
    });
    await expect(guard.canActivate(makeContext(userOk))).resolves.toBe(true);
  });

  it('resolve permissões UMA vez por request, mesmo com múltiplos codes', async () => {
    setMetadata({ required: ['finance.entries.view', 'finance.entries.pay'] });
    permissionService.getUserPermissions.mockResolvedValue({
      roles: [],
      permissions: ['finance.entries.view', 'finance.entries.pay'],
    });
    await guard.canActivate(makeContext(userOk));
    expect(permissionService.getUserPermissions).toHaveBeenCalledTimes(1);
  });

  it('fail-closed: erro na resolução (ex.: banco fora) → 403 genérico, nunca liberação', async () => {
    setMetadata({ required: ['iam.audit-logs.view'] });
    permissionService.getUserPermissions.mockRejectedValue(
      new Error('ECONNREFUSED: banco fora do ar'),
    );
    await expect(guard.canActivate(makeContext(userOk))).rejects.toThrow(
      /Não foi possível verificar suas permissões/,
    );
  });

  it('fail-closed: o 403 de erro de infraestrutura NÃO vaza detalhes internos', async () => {
    setMetadata({ required: ['iam.audit-logs.view'] });
    permissionService.getUserPermissions.mockRejectedValue(
      new Error('ECONNREFUSED 10.0.0.5:5432'),
    );
    let erro: any;
    await guard.canActivate(makeContext(userOk)).catch((e) => (erro = e));
    expect(erro).toBeInstanceOf(ForbiddenException);
    expect(erro.message).not.toContain('ECONNREFUSED');
  });
});
