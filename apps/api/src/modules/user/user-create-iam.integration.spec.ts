import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import { PermissionService } from '../iam/permission.service';
import { PermissionCacheService } from '../iam/permission-cache.service';
import {
  ENUM_ROLE_TO_SYSTEM_ROLE,
  resolveEffectivePermissions,
} from '../iam/roles.catalog';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { PasswordPolicyService } from '../iam/password-policy.service';
import { SessionService } from '../iam/session.service';
import { UserService } from './user.service';

/**
 * #738 — validação EFETIVA (não só "criou uma linha"): prova que um usuário
 * recém-criado passa a funcionar no RBAC v2 de ponta a ponta, com menu e
 * backend concordando. O fluxo liga a saída REAL do UserService.create ao
 * PermissionService REAL e ao PermissionGuard REAL, sobre um único Prisma
 * mockado que se comporta como o banco:
 *
 *   create (enum MANAGER) → grava assignment roleId=r-gg (GERENTE_GERAL)
 *     → PermissionService resolve → legacyFallback=false + perms do perfil
 *       → PermissionGuard autoriza uma permissão do perfil / nega uma de fora.
 */
describe('#738 — usuário criado funciona efetivamente no IAM v2 (integração)', () => {
  const ENUM = 'MANAGER';
  const SYSTEM_CODE = ENUM_ROLE_TO_SYSTEM_ROLE[ENUM]; // 'GERENTE_GERAL'
  const ROLE_ID = 'r-gg';
  const COMPANY = 'company-1';
  const ACTOR = 'admin-1';

  // Conjunto EFETIVO real do perfil, direto do catálogo (fonte que semeia o DB).
  const catalogPerms = resolveEffectivePermissions(SYSTEM_CODE);
  const grantedPerm = catalogPerms[0]; // uma permissão que o perfil TEM
  const notGrantedPerm = 'zzz.inexistente.action'; // fora do catálogo do perfil

  // Prisma único, compartilhado por create + resolução (comporta-se como o banco).
  const mockPrisma: any = {
    user: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
    userRoleAssignment: { findMany: jest.fn() },
    userPermission: { findMany: jest.fn() },
    role: { findFirst: jest.fn(), findMany: jest.fn() },
  };
  const mockCache = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  const mockPasswordPolicy = {
    validateComplexity: jest.fn(),
    recordPasswordChange: jest.fn().mockResolvedValue(undefined),
  };

  let userService: UserService;
  let permissionService: PermissionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        PermissionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PermissionCacheService, useValue: mockCache },
        { provide: PasswordPolicyService, useValue: mockPasswordPolicy },
        { provide: SessionService, useValue: { revokeAllSessions: jest.fn() } },
        { provide: EntitlementService, useValue: { limit: jest.fn().mockResolvedValue(null) } }, // WP4: legado ilimitado
      ],
    }).compile();
    userService = module.get(UserService);
    permissionService = module.get(PermissionService);

    // create resolve o perfil-espelho GERENTE_GERAL (companyId null = global).
    mockPrisma.role.findFirst.mockResolvedValue({ id: ROLE_ID });
    mockPrisma.user.create.mockResolvedValue({ id: 'novo-user', companyId: COMPANY });
    // cache sempre miss → resolve do "banco".
    mockCache.get.mockResolvedValue(null);
  });

  /**
   * Guard REAL com Reflector mockado devolvendo o @RequirePermission pedido
   * (a metadata real não existe num contexto sintético — mockar é o padrão do
   * permission.guard.spec). getUserPermissions permanece o REAL.
   */
  function authorize(required: string[], user: any): Promise<boolean> {
    const reflector = {
      getAllAndOverride: (key: any) => (key === REQUIRE_PERMISSION_KEY ? required : undefined),
    } as unknown as Reflector;
    const g = new PermissionGuard(reflector, permissionService);
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
    return g.canActivate(ctx);
  }

  it('create → assignment do perfil-espelho → resolução efetiva → guard concorda', async () => {
    // 1) cria o usuário (enum MANAGER) — grava o vínculo v2 do espelho
    await userService.create(
      { name: 'Novo', email: 'novo@gdr.com.br', password: 'SenhaForte#2026', role: ENUM as any },
      COMPANY,
      ACTOR,
    );
    // o vínculo aponta para o perfil system resolvido (GERENTE_GERAL, roleId r-gg)
    expect(mockPrisma.user.create.mock.calls[0][0].data.roleAssignments.create).toEqual({
      roleId: ROLE_ID,
      companyId: COMPANY,
      grantedBy: ACTOR,
    });

    // 2) o "banco" agora reflete o vínculo que o create escreveu
    mockPrisma.userRoleAssignment.findMany.mockResolvedValue([
      { roleId: ROLE_ID, role: { code: SYSTEM_CODE } },
    ]);
    // a cadeia de perfis devolve o perfil com o conjunto efetivo real do catálogo
    mockPrisma.role.findMany.mockResolvedValue([
      {
        id: ROLE_ID,
        parentId: null,
        rolePermissions: catalogPerms.map((code) => ({ granted: true, permission: { code } })),
      },
    ]);
    mockPrisma.userPermission.findMany.mockResolvedValue([]);

    // 3) /auth/me/permissions → legacyFallback=false (NÃO é fallback de enum)
    const effective = await permissionService.getMyEffectivePermissions('novo-user', COMPANY, ENUM);
    expect(effective.legacyFallback).toBe(false);
    expect(effective.roles).toContain(SYSTEM_CODE);
    expect(effective.permissions).toEqual([...catalogPerms].sort());
    expect(effective.permissions.length).toBeGreaterThan(0);

    // 4) rota protegida por uma permissão DO perfil → AUTORIZADA
    const userCtx = { id: 'novo-user', companyId: COMPANY, role: ENUM };
    await expect(authorize([grantedPerm], userCtx)).resolves.toBe(true);

    // 5) rota com permissão que o perfil NÃO tem → 403 (segue fail-closed)
    await expect(authorize([notGrantedPerm], userCtx)).rejects.toThrow(ForbiddenException);
  });

  it('sanity: o perfil-espelho tem permissões reais no catálogo (perm de teste válida)', () => {
    expect(catalogPerms.length).toBeGreaterThan(0);
    expect(catalogPerms).toContain(grantedPerm);
    expect(catalogPerms).not.toContain(notGrantedPerm);
  });
});
