import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { RolesAdminService, deriveRoleCode } from './roles-admin.service';
import { PermissionService } from './permission.service';
import { AuditService } from './audit.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Testes do RolesAdminService (#352) — PrismaService, PermissionService e
 * AuditService mockados (convenção do repo: nunca chamada real ao banco).
 */

const ACTOR = { id: 'user-1', companyId: 'co-1' };

function buildMockPrisma() {
  const prisma: any = {
    role: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    rolePermission: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    permission: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
    },
    userRoleAssignment: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    userPermission: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    permissionChangeLog: {
      create: jest.fn().mockResolvedValue({}),
    },
  };
  // O callback transacional recebe o próprio mock (mesmas tabelas)
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

const SYSTEM_ROLE = {
  id: 'role-sys',
  code: 'ADMIN_GLOBAL',
  name: 'Administrador Global',
  description: null,
  isSystem: true,
  isActive: true,
  companyId: null,
  parentId: null,
};

const CUSTOM_ROLE = {
  id: 'role-custom',
  code: 'COMPRADOR_JUNIOR',
  name: 'Comprador Júnior',
  description: null,
  isSystem: false,
  isActive: true,
  companyId: 'co-1',
  parentId: null,
};

describe('deriveRoleCode', () => {
  it('deriva MAIÚSCULO_COM_UNDERSCORE removendo acentos', () => {
    expect(deriveRoleCode('Comprador Júnior')).toBe('COMPRADOR_JUNIOR');
    expect(deriveRoleCode('Operação — Logística 2')).toBe('OPERACAO_LOGISTICA_2');
  });
});

describe('RolesAdminService', () => {
  let service: RolesAdminService;
  let prisma: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesAdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionService, useValue: mockPermissionService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get(RolesAdminService);
  });

  describe('listRoles', () => {
    it('escopa por system OU companyId da empresa (multi-tenant)', async () => {
      await service.listRoles('co-1');
      expect(prisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ isSystem: true }, { companyId: 'co-1' }] },
        }),
      );
    });
  });

  describe('createRole', () => {
    it('cria perfil custom com changelog ROLE_CREATED e auditoria', async () => {
      prisma.role.findFirst.mockResolvedValue(null); // check de existência do code
      prisma.role.create.mockResolvedValue({ ...CUSTOM_ROLE });

      const result = await service.createRole(ACTOR, { name: 'Comprador Júnior' });

      expect(prisma.role.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            code: 'COMPRADOR_JUNIOR',
            isSystem: false,
            companyId: 'co-1',
          }),
        }),
      );
      expect(prisma.permissionChangeLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ changeType: 'ROLE_CREATED' }),
        }),
      );
      expect(mockAuditService.logWithDiff).toHaveBeenCalled();
      expect(result.code).toBe('COMPRADOR_JUNIOR');
    });

    it('409 quando o code já existe', async () => {
      prisma.role.findFirst.mockResolvedValue(SYSTEM_ROLE);
      await expect(
        service.createRole(ACTOR, { name: 'Admin Global' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('copia permissões do perfil de origem (duplicar)', async () => {
      prisma.role.findFirst
        .mockResolvedValueOnce(null) // check de existência do novo code
        .mockResolvedValueOnce(SYSTEM_ROLE); // findVisibleRole(origem)
      prisma.rolePermission.findMany.mockResolvedValue([
        { permissionId: 'p1', granted: true },
        { permissionId: 'p2', granted: true },
      ]);
      prisma.role.create.mockResolvedValue({ ...CUSTOM_ROLE });

      await service.createRole(ACTOR, {
        name: 'Comprador Júnior',
        copyFromRoleId: 'role-sys',
      });

      expect(prisma.rolePermission.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            { roleId: 'role-custom', permissionId: 'p1', granted: true },
            { roleId: 'role-custom', permissionId: 'p2', granted: true },
          ],
        }),
      );
    });
  });

  describe('updateRole', () => {
    it('403 explicativo para perfil system', async () => {
      prisma.role.findFirst.mockResolvedValue(SYSTEM_ROLE);
      await expect(
        service.updateRole(ACTOR, 'role-sys', { name: 'Novo Nome' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.role.update).not.toHaveBeenCalled();
    });

    it('404 para perfil de outra empresa (invisível)', async () => {
      prisma.role.findFirst.mockResolvedValue(null);
      await expect(
        service.updateRole(ACTOR, 'role-x', { name: 'Novo Nome' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('atualiza custom com changelog ROLE_UPDATED e invalida cache ao inativar', async () => {
      prisma.role.findFirst.mockResolvedValue({ ...CUSTOM_ROLE });
      prisma.role.update.mockResolvedValue({ ...CUSTOM_ROLE, isActive: false });

      await service.updateRole(ACTOR, 'role-custom', { isActive: false });

      expect(prisma.permissionChangeLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ changeType: 'ROLE_UPDATED' }),
        }),
      );
      expect(mockPermissionService.invalidateRole).toHaveBeenCalledWith('role-custom');
    });
  });

  describe('deleteRole', () => {
    it('403 para perfil system', async () => {
      prisma.role.findFirst.mockResolvedValue(SYSTEM_ROLE);
      await expect(service.deleteRole(ACTOR, 'role-sys')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('409 quando há usuários vinculados', async () => {
      prisma.role.findFirst.mockResolvedValue({ ...CUSTOM_ROLE });
      prisma.userRoleAssignment.count.mockResolvedValue(3);
      await expect(service.deleteRole(ACTOR, 'role-custom')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.role.delete).not.toHaveBeenCalled();
    });

    it('exclui custom sem vínculos, com changelog ROLE_DELETED', async () => {
      prisma.role.findFirst.mockResolvedValue({ ...CUSTOM_ROLE });
      prisma.userRoleAssignment.count.mockResolvedValue(0);
      prisma.role.count.mockResolvedValue(0);
      prisma.role.delete.mockResolvedValue({ ...CUSTOM_ROLE });

      const result = await service.deleteRole(ACTOR, 'role-custom');

      expect(prisma.role.delete).toHaveBeenCalledWith({ where: { id: 'role-custom' } });
      expect(prisma.permissionChangeLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ changeType: 'ROLE_DELETED' }),
        }),
      );
      expect(result).toEqual({ deleted: true });
    });
  });

  describe('setRolePermissions', () => {
    /** Ator que mantém acesso à gestão via exceção individual (sem depender do perfil editado) */
    function actorKeepsAccess() {
      prisma.userRoleAssignment.findMany.mockResolvedValue([]);
      prisma.userPermission.findMany.mockResolvedValue([
        { id: 'up-keep', granted: true, permission: { code: 'iam.roles.manage' } },
      ]);
    }

    it('403 para perfil system', async () => {
      prisma.role.findFirst.mockResolvedValue(SYSTEM_ROLE);
      await expect(
        service.setRolePermissions(ACTOR, 'role-sys', { codes: ['sales.orders.view'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('400 para code inexistente no catálogo', async () => {
      prisma.role.findFirst.mockResolvedValue({ ...CUSTOM_ROLE });
      prisma.permission.findMany.mockResolvedValue([]);
      await expect(
        service.setRolePermissions(ACTOR, 'role-custom', { codes: ['nao.existe.aqui'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('substitui o conjunto transacionalmente + changelog + invalidação de cache', async () => {
      prisma.role.findFirst.mockResolvedValue({ ...CUSTOM_ROLE });
      prisma.permission.findMany.mockResolvedValue([
        { id: 'p-new', code: 'sales.orders.view' },
      ]);
      actorKeepsAccess();
      // Estado atual do perfil: uma permissão que sairá
      prisma.rolePermission.findMany.mockResolvedValue([
        { id: 'rp-old', permissionId: 'p-old', permission: { code: 'stock.balances.view' }, granted: true },
      ]);

      await service.setRolePermissions(ACTOR, 'role-custom', {
        codes: ['sales.orders.view'],
      });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.rolePermission.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['rp-old'] } },
      });
      expect(prisma.rolePermission.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [{ roleId: 'role-custom', permissionId: 'p-new', granted: true }],
        }),
      );
      expect(prisma.permissionChangeLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            changeType: 'ROLE_PERMISSIONS_CHANGED',
            roleId: 'role-custom',
          }),
        }),
      );
      expect(mockPermissionService.invalidateRole).toHaveBeenCalledWith('role-custom');
      expect(mockAuditService.logWithDiff).toHaveBeenCalled();
    });

    it('anti-auto-lockout: 400 se a mudança remover o acesso do PRÓPRIO autor à gestão', async () => {
      prisma.role.findFirst.mockResolvedValue({ ...CUSTOM_ROLE });
      prisma.permission.findMany.mockResolvedValue([
        { id: 'p-new', code: 'sales.orders.view' },
      ]);
      // O autor tem SÓ este perfil, cuja única fonte de iam.roles.manage é ele mesmo
      prisma.userRoleAssignment.findMany.mockResolvedValue([{ roleId: 'role-custom' }]);
      prisma.role.findMany.mockResolvedValue([
        {
          id: 'role-custom',
          parentId: null,
          rolePermissions: [
            { granted: true, permission: { code: 'iam.roles.manage' } },
          ],
        },
      ]);
      prisma.userPermission.findMany.mockResolvedValue([]);

      await expect(
        service.setRolePermissions(ACTOR, 'role-custom', { codes: ['sales.orders.view'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.rolePermission.deleteMany).not.toHaveBeenCalled();
      expect(mockPermissionService.invalidateRole).not.toHaveBeenCalled();
    });
  });
});
