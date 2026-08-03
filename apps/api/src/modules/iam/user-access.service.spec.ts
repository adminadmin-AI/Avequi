import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UserAccessService } from './user-access.service';
import { PermissionService } from './permission.service';
import { AuditService } from './audit.service';
import { LastAdminInvariantService } from './last-admin-invariant.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Testes do UserAccessService (#352) — PrismaService, PermissionService e
 * AuditService mockados (convenção do repo: nunca chamada real ao banco).
 */

const ACTOR = { id: 'admin-1', companyId: 'co-1' };
const TARGET = { id: 'user-2', name: 'Fulano', email: 'f@gdr.com', role: 'COMMERCIAL' };

let mockLastAdmin: any;

function buildMockPrisma() {
  const prisma: any = {
    user: { findFirst: jest.fn().mockResolvedValue(TARGET) },
    role: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    branch: { findFirst: jest.fn() },
    permission: { findUnique: jest.fn() },
    userRoleAssignment: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    userPermission: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    permissionChangeLog: { create: jest.fn().mockResolvedValue({}) },
  };

  // #752: mecanismo central mockado — caminho feliz executa a operação com
  // o próprio mock de prisma como tx (mesmo contrato do $transaction abaixo).
  mockLastAdmin = {
    temVinculoAdminPerpetuo: jest.fn().mockResolvedValue(false),
    ehAdminGlobalEfetivo: jest.fn().mockResolvedValue(false),
    executarProtegido: jest.fn(async (_companyId: string, op: any) =>
      op(prisma, { rootId: 'co-1', grupoIds: ['co-1'], adminsPerpetuosAntes: 1 }),
    ),
  };

  prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
  return prisma;
}

const mockPermissionService = {
  invalidateRole: jest.fn(),
  invalidateUser: jest.fn(),
};

const mockAuditService = {
  log: jest.fn(),
  logWithDiff: jest.fn(),
};

describe('UserAccessService', () => {
  let service: UserAccessService;
  let prisma: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserAccessService,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionService, useValue: mockPermissionService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: LastAdminInvariantService, useValue: mockLastAdmin },
      ],
    }).compile();

    service = module.get(UserAccessService);
  });

  describe('assignRole', () => {
    it('404 quando o usuário-alvo não é da empresa do JWT (anti-IDOR)', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(
        service.assignRole(ACTOR, 'user-x', { roleId: 'role-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409 quando o usuário já tem o perfil', async () => {
      prisma.role.findFirst.mockResolvedValue({
        id: 'role-1',
        code: 'VENDEDOR',
        name: 'Vendedor',
      });
      prisma.userRoleAssignment.findUnique.mockResolvedValue({ id: 'a-1' });
      await expect(
        service.assignRole(ACTOR, TARGET.id, { roleId: 'role-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('atribui perfil + changelog ROLE_ASSIGNED + invalida cache do usuário', async () => {
      prisma.role.findFirst.mockResolvedValue({
        id: 'role-1',
        code: 'VENDEDOR',
        name: 'Vendedor',
      });
      prisma.userRoleAssignment.findUnique.mockResolvedValue(null);
      prisma.userRoleAssignment.create.mockResolvedValue({ id: 'a-1', roleId: 'role-1' });

      await service.assignRole(ACTOR, TARGET.id, { roleId: 'role-1' });

      expect(prisma.userRoleAssignment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: TARGET.id,
            roleId: 'role-1',
            companyId: 'co-1',
            grantedBy: ACTOR.id,
          }),
        }),
      );
      expect(prisma.permissionChangeLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            changeType: 'ROLE_ASSIGNED',
            targetUserId: TARGET.id,
            changedByUserId: ACTOR.id,
          }),
        }),
      );
      expect(mockPermissionService.invalidateUser).toHaveBeenCalledWith(TARGET.id, 'co-1');
      expect(mockAuditService.logWithDiff).toHaveBeenCalled();
    });
  });

  describe('removeRole', () => {
    it('remove perfil de outro usuário + changelog ROLE_REMOVED', async () => {
      prisma.userRoleAssignment.findUnique.mockResolvedValue({
        id: 'a-1',
        branchId: null,
        expiresAt: null,
        role: { code: 'VENDEDOR', name: 'Vendedor' },
      });

      await service.removeRole(ACTOR, TARGET.id, 'role-1');

      expect(prisma.userRoleAssignment.delete).toHaveBeenCalledWith({
        where: { id: 'a-1' },
      });
      expect(prisma.permissionChangeLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ changeType: 'ROLE_REMOVED' }),
        }),
      );
      expect(mockPermissionService.invalidateUser).toHaveBeenCalledWith(TARGET.id, 'co-1');
    });

    it('anti-auto-lockout: 400 ao remover de SI MESMO o único perfil com acesso à gestão', async () => {
      // O alvo é o próprio ator
      prisma.user.findFirst.mockResolvedValue({ ...TARGET, id: ACTOR.id, role: 'DIRECTOR' });
      prisma.userRoleAssignment.findUnique.mockResolvedValue({
        id: 'a-1',
        branchId: null,
        expiresAt: null,
        role: { code: 'DIRETOR', name: 'Diretor' },
      });
      // Simulação: sem o perfil removido, sobra nada
      prisma.userRoleAssignment.findMany.mockResolvedValue([{ roleId: 'role-dir' }]);
      prisma.userPermission.findMany.mockResolvedValue([]);

      await expect(
        service.removeRole(ACTOR, ACTOR.id, 'role-dir'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.userRoleAssignment.delete).not.toHaveBeenCalled();
    });
  });

  describe('grantPermission', () => {
    it('400 quando o code não existe no catálogo', async () => {
      prisma.permission.findUnique.mockResolvedValue(null);
      await expect(
        service.grantPermission(ACTOR, TARGET.id, { permissionCode: 'nao.existe.x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('deny de iam.roles.* em SUPER_ADMIN → 400 (não trancar o admin fora da gestão)', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...TARGET, role: 'SUPER_ADMIN' });
      prisma.permission.findUnique.mockResolvedValue({
        id: 'p-1',
        code: 'iam.roles.manage',
        name: 'Perfis e permissões — criar/editar/excluir perfis',
      });

      await expect(
        service.grantPermission(ACTOR, TARGET.id, {
          permissionCode: 'iam.roles.manage',
          granted: false,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.userPermission.upsert).not.toHaveBeenCalled();
    });

    it('deny de iam.roles.* em SI MESMO que causa lockout → 400', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...TARGET, id: ACTOR.id, role: 'DIRECTOR' });
      prisma.permission.findUnique.mockResolvedValue({
        id: 'p-1',
        code: 'iam.roles.manage',
        name: 'x',
      });
      // Simulação: única fonte de acesso é o grant que o deny vai anular
      prisma.userRoleAssignment.findMany.mockResolvedValue([]);
      prisma.userPermission.findMany.mockResolvedValue([
        { id: 'up-1', granted: true, permission: { code: 'iam.roles.manage' } },
      ]);

      await expect(
        service.grantPermission(ACTOR, ACTOR.id, {
          permissionCode: 'iam.roles.manage',
          granted: false,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('grant com justificativa e expiração + changelog PERMISSION_GRANTED', async () => {
      prisma.permission.findUnique.mockResolvedValue({
        id: 'p-1',
        code: 'finance.entries.pay',
        name: 'Lançamentos — baixar/pagar',
      });
      prisma.userPermission.findUnique.mockResolvedValue(null);
      prisma.userPermission.upsert.mockResolvedValue({ id: 'up-1', granted: true });

      await service.grantPermission(ACTOR, TARGET.id, {
        permissionCode: 'finance.entries.pay',
        granted: true,
        expiresAt: '2026-12-31T23:59:59.000Z',
        reason: 'Cobertura de férias do financeiro',
      });

      expect(prisma.userPermission.upsert).toHaveBeenCalled();
      expect(prisma.permissionChangeLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            changeType: 'PERMISSION_GRANTED',
            reason: 'Cobertura de férias do financeiro',
          }),
        }),
      );
      expect(mockPermissionService.invalidateUser).toHaveBeenCalledWith(TARGET.id, 'co-1');
    });

    it('deny em usuário comum grava PERMISSION_REVOKED', async () => {
      prisma.permission.findUnique.mockResolvedValue({
        id: 'p-1',
        code: 'sales.orders.cancel',
        name: 'x',
      });
      prisma.userPermission.findUnique.mockResolvedValue(null);
      prisma.userPermission.upsert.mockResolvedValue({ id: 'up-1', granted: false });

      await service.grantPermission(ACTOR, TARGET.id, {
        permissionCode: 'sales.orders.cancel',
        granted: false,
      });

      expect(prisma.permissionChangeLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ changeType: 'PERMISSION_REVOKED' }),
        }),
      );
    });
  });

  describe('removePermission', () => {
    it('404 quando a exceção não existe (ou é de outra empresa)', async () => {
      prisma.userPermission.findFirst.mockResolvedValue(null);
      await expect(
        service.removePermission(ACTOR, TARGET.id, 'up-x'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('remove exceção + changelog + invalidação', async () => {
      prisma.userPermission.findFirst.mockResolvedValue({
        id: 'up-1',
        granted: true,
        expiresAt: null,
        reason: null,
        permission: { id: 'p-1', code: 'finance.entries.pay' },
      });

      await service.removePermission(ACTOR, TARGET.id, 'up-1');

      expect(prisma.userPermission.delete).toHaveBeenCalledWith({ where: { id: 'up-1' } });
      expect(prisma.permissionChangeLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ changeType: 'PERMISSION_REVOKED' }),
        }),
      );
      expect(mockPermissionService.invalidateUser).toHaveBeenCalledWith(TARGET.id, 'co-1');
    });
  });

  describe('#752 — invariante do último ADMIN_GLOBAL', () => {
    it('removeRole de vínculo ADMIN_GLOBAL passa pelo mecanismo central (lock + invariante)', async () => {
      prisma.userRoleAssignment.findUnique.mockResolvedValue({
        id: 'as-1',
        branchId: null,
        expiresAt: null,
        role: { code: 'ADMIN_GLOBAL', name: 'Admin Global' },
      });

      await service.removeRole(ACTOR, TARGET.id, 'role-adm');

      expect(mockLastAdmin.executarProtegido).toHaveBeenCalledWith(
        ACTOR.companyId,
        expect.any(Function),
      );
      expect(prisma.userRoleAssignment.delete).toHaveBeenCalledWith({ where: { id: 'as-1' } });
    });

    it('removeRole de perfil comum segue na transação normal, sem lock', async () => {
      prisma.userRoleAssignment.findUnique.mockResolvedValue({
        id: 'as-2',
        branchId: null,
        expiresAt: null,
        role: { code: 'VENDEDOR', name: 'Vendedor' },
      });

      await service.removeRole(ACTOR, TARGET.id, 'role-vnd');

      expect(mockLastAdmin.executarProtegido).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.userRoleAssignment.delete).toHaveBeenCalledWith({ where: { id: 'as-2' } });
    });

    it('mecanismo central rejeita (último admin) → remoção NÃO acontece e o 409 propaga', async () => {
      prisma.userRoleAssignment.findUnique.mockResolvedValue({
        id: 'as-1',
        branchId: null,
        expiresAt: null,
        role: { code: 'ADMIN_GLOBAL', name: 'Admin Global' },
      });
      mockLastAdmin.executarProtegido.mockRejectedValue(
        new ConflictException('administrador global'),
      );

      await expect(service.removeRole(ACTOR, TARGET.id, 'role-adm')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.userRoleAssignment.delete).not.toHaveBeenCalled();
    });

    it('deny FORA de iam.roles.* em admin global segue permitido (a proteção não vira bloqueio geral)', async () => {
      // O laço de recuperação é preservado por iam.roles.assign, que não pode
      // ser negado — com ele o admin desfaz qualquer outro deny. Então negar
      // settings.users.update a um admin é decisão administrativa legítima.
      prisma.permission.findUnique.mockResolvedValue({
        id: 'p-2',
        code: 'settings.users.update',
        name: 'Editar usuários',
      });
      mockLastAdmin.ehAdminGlobalEfetivo.mockResolvedValue(true);
      prisma.userPermission.findUnique.mockResolvedValue(null);
      prisma.userPermission.upsert.mockResolvedValue({ id: 'up-1' });

      await expect(
        service.grantPermission(ACTOR, TARGET.id, {
          permissionCode: 'settings.users.update',
          granted: false,
        } as any),
      ).resolves.toBeDefined();
      expect(prisma.userPermission.upsert).toHaveBeenCalled();
    });

    it('deny iam.roles.* em ADMIN_GLOBAL efetivo do v2 (mesmo sem enum SUPER_ADMIN) → 400', async () => {
      prisma.permission.findUnique.mockResolvedValue({
        id: 'p-1',
        code: 'iam.roles.assign',
        name: 'Atribuir perfis',
      });
      mockLastAdmin.ehAdminGlobalEfetivo.mockResolvedValue(true); // alvo é admin v2

      await expect(
        service.grantPermission(ACTOR, TARGET.id, {
          permissionCode: 'iam.roles.assign',
          granted: false,
        } as any),
      ).rejects.toThrow(/administrador global/);
      expect(prisma.userPermission.upsert).not.toHaveBeenCalled();
    });
  });

  describe('#752 — ADMIN_GLOBAL temporário exige lastro perpétuo', () => {
    const ADMIN_ROLE = { id: 'role-adm', code: 'ADMIN_GLOBAL', name: 'Admin Global' };
    const amanha = new Date(Date.now() + 86_400_000).toISOString();

    beforeEach(() => {
      prisma.role.findFirst.mockResolvedValue(ADMIN_ROLE);
      prisma.userRoleAssignment.findUnique.mockResolvedValue(null);
      prisma.userRoleAssignment.create.mockResolvedValue({ id: 'as-novo' });
    });

    it('primeiro/único ADMIN_GLOBAL com expiresAt (grupo sem perpétuo) → bloqueado', async () => {
      mockLastAdmin.executarProtegido.mockImplementation(async (_c: string, op: any) =>
        op(prisma, { rootId: 'co-1', grupoIds: ['co-1'], adminsPerpetuosAntes: 0 }),
      );

      await expect(
        service.assignRole(ACTOR, TARGET.id, { roleId: 'role-adm', expiresAt: amanha } as any),
      ).rejects.toThrow(/administrador global permanente/);
      expect(prisma.userRoleAssignment.create).not.toHaveBeenCalled();
    });

    it('ADMIN_GLOBAL temporário COM perpétuo existente → permitido, dentro do lock', async () => {
      await service.assignRole(ACTOR, TARGET.id, {
        roleId: 'role-adm',
        expiresAt: amanha,
      } as any);

      expect(mockLastAdmin.executarProtegido).toHaveBeenCalledWith(
        ACTOR.companyId,
        expect.any(Function),
      );
      const data = prisma.userRoleAssignment.create.mock.calls[0][0].data;
      expect(data.expiresAt).toEqual(new Date(amanha));
    });

    it('ADMIN_GLOBAL PERPÉTUO (sem expiresAt) não precisa do lock — só adiciona', async () => {
      await service.assignRole(ACTOR, TARGET.id, { roleId: 'role-adm' } as any);

      expect(mockLastAdmin.executarProtegido).not.toHaveBeenCalled();
      expect(prisma.userRoleAssignment.create).toHaveBeenCalled();
    });

    it('perfil NÃO-admin com expiração segue inalterado (sem lock)', async () => {
      prisma.role.findFirst.mockResolvedValue({
        id: 'role-vnd',
        code: 'VENDEDOR',
        name: 'Vendedor',
      });

      await service.assignRole(ACTOR, TARGET.id, {
        roleId: 'role-vnd',
        expiresAt: amanha,
      } as any);

      expect(mockLastAdmin.executarProtegido).not.toHaveBeenCalled();
      expect(prisma.userRoleAssignment.create).toHaveBeenCalled();
    });
  });
});
