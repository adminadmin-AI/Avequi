import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UserAccessService } from './user-access.service';
import { PermissionService } from './permission.service';
import { AuditService } from './audit.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Testes do UserAccessService (#352) — PrismaService, PermissionService e
 * AuditService mockados (convenção do repo: nunca chamada real ao banco).
 */

const ACTOR = { id: 'admin-1', companyId: 'co-1' };
const TARGET = { id: 'user-2', name: 'Fulano', email: 'f@gdr.com', role: 'COMMERCIAL' };

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
});
