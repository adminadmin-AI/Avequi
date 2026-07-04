import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { OrgStructureService } from './org-structure.service';
import { OrgStructureController } from './org-structure.controller';
import { PermissionService } from './permission.service';
import { AuditService } from './audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSIONS_CATALOG } from './permissions.catalog';
import { resolveEffectivePermissions } from './roles.catalog';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';

/**
 * Testes da estrutura organizacional — issue #347 (IAM F5.2, fase 1).
 * PrismaService, PermissionService e AuditService mockados (convenção do
 * repo: nunca chamada real ao banco).
 *
 * Cobertura pedida pela fase:
 * - CRUD escopado por tenant (entidade de outra empresa → 404, anti-IDOR)
 * - DELETE com vínculos → 409
 * - Permissões aplicadas (@RequirePermission iam.org.* em todas as rotas)
 * - Auditoria gravada (logWithDiff em toda mutação)
 * - Invalidação de cache de permissões nos vínculos de usuário
 */

const ACTOR = { id: 'user-1', companyId: 'co-1' };

function buildMockPrisma() {
  const prisma: any = {
    branch: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    department: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    team: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    user: {
      findFirst: jest.fn(),
    },
    userRoleAssignment: {
      count: jest.fn().mockResolvedValue(0),
    },
    userDepartment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    userTeam: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
  return prisma;
}

const mockPermissionService = {
  invalidateUser: jest.fn(),
  invalidateRole: jest.fn(),
};

const mockAuditService = {
  log: jest.fn(),
  logWithDiff: jest.fn(),
};

const BRANCH = {
  id: 'br-1',
  companyId: 'co-1',
  code: 'CWB',
  name: 'Filial Curitiba',
  cnpj: null,
  isActive: true,
};

const DEPARTMENT = {
  id: 'dep-1',
  companyId: 'co-1',
  code: 'PRODUCAO',
  name: 'Produção',
  parentId: null,
  managerId: null,
  isActive: true,
};

const TEAM = {
  id: 'team-1',
  departmentId: 'dep-1',
  name: 'Turno A',
  leaderId: null,
  isActive: true,
};

const TARGET_USER = { id: 'user-2', name: 'Maria', email: 'maria@gdr.com.br' };

describe('OrgStructureService', () => {
  let service: OrgStructureService;
  let prisma: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgStructureService,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionService, useValue: mockPermissionService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get(OrgStructureService);
  });

  // ─── Filiais ───────────────────────────────────────────────────────────────

  describe('filiais', () => {
    it('lista SEMPRE escopado pelo companyId do JWT', async () => {
      await service.listBranches('co-1');
      expect(prisma.branch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: 'co-1' } }),
      );
    });

    it('cria filial e grava auditoria (logWithDiff CREATE)', async () => {
      prisma.branch.findUnique.mockResolvedValue(null);
      prisma.branch.create.mockResolvedValue(BRANCH);

      const result = await service.createBranch(ACTOR, {
        name: 'Filial Curitiba',
        code: 'CWB',
      });

      expect(result).toEqual(BRANCH);
      expect(prisma.branch.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ companyId: 'co-1', code: 'CWB' }),
      });
      expect(mockAuditService.logWithDiff).toHaveBeenCalledWith(
        null,
        BRANCH,
        expect.objectContaining({ entity: 'Branch', action: 'CREATE', module: 'iam' }),
      );
    });

    it('rejeita código duplicado na mesma empresa (409)', async () => {
      prisma.branch.findUnique.mockResolvedValue(BRANCH);
      await expect(
        service.createBranch(ACTOR, { name: 'Outra', code: 'CWB' }),
      ).rejects.toThrow(ConflictException);
    });

    it('update de filial de OUTRA empresa → 404 (anti-IDOR)', async () => {
      prisma.branch.findFirst.mockResolvedValue(null); // where inclui companyId
      await expect(
        service.updateBranch(ACTOR, 'br-de-outra-empresa', { name: 'Hack' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.branch.findFirst).toHaveBeenCalledWith({
        where: { id: 'br-de-outra-empresa', companyId: 'co-1' },
      });
      expect(prisma.branch.update).not.toHaveBeenCalled();
    });

    it('delete com atribuições de perfil escopadas na filial → 409', async () => {
      prisma.branch.findFirst.mockResolvedValue(BRANCH);
      prisma.userRoleAssignment.count.mockResolvedValue(3);

      await expect(service.deleteBranch(ACTOR, 'br-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.branch.delete).not.toHaveBeenCalled();
    });

    it('delete sem vínculos exclui e audita (logWithDiff DELETE)', async () => {
      prisma.branch.findFirst.mockResolvedValue(BRANCH);
      prisma.userRoleAssignment.count.mockResolvedValue(0);

      const result = await service.deleteBranch(ACTOR, 'br-1');

      expect(result).toEqual({ deleted: true });
      expect(prisma.branch.delete).toHaveBeenCalledWith({ where: { id: 'br-1' } });
      expect(mockAuditService.logWithDiff).toHaveBeenCalledWith(
        BRANCH,
        null,
        expect.objectContaining({ entity: 'Branch', action: 'DELETE' }),
      );
    });
  });

  // ─── Departamentos ─────────────────────────────────────────────────────────

  describe('departamentos', () => {
    it('cria departamento validando pai e gerente da MESMA empresa', async () => {
      prisma.department.findUnique.mockResolvedValue(null); // code livre
      prisma.department.findFirst.mockResolvedValue(DEPARTMENT); // pai ok
      prisma.user.findFirst.mockResolvedValue(TARGET_USER); // gerente ok
      prisma.department.create.mockResolvedValue({ ...DEPARTMENT, id: 'dep-2' });

      await service.createDepartment(ACTOR, {
        name: 'Solda',
        code: 'SOLDA',
        parentId: 'dep-1',
        managerId: 'user-2',
      });

      expect(prisma.department.findFirst).toHaveBeenCalledWith({
        where: { id: 'dep-1', companyId: 'co-1' },
      });
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-2', companyId: 'co-1' } }),
      );
      expect(mockAuditService.logWithDiff).toHaveBeenCalled();
    });

    it('pai de OUTRA empresa → 404 (anti-IDOR)', async () => {
      prisma.department.findUnique.mockResolvedValue(null);
      prisma.department.findFirst.mockResolvedValue(null); // pai não visível
      await expect(
        service.createDepartment(ACTOR, {
          name: 'Solda',
          code: 'SOLDA',
          parentId: 'dep-alheio',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejeita ciclo na hierarquia (400)', async () => {
      // dep-1 quer virar filho de dep-2, mas dep-2 já é filho de dep-1
      prisma.department.findFirst.mockResolvedValue(DEPARTMENT);
      prisma.department.findUnique.mockResolvedValue({ parentId: 'dep-1' });

      await expect(
        service.updateDepartment(ACTOR, 'dep-1', { parentId: 'dep-2' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.department.update).not.toHaveBeenCalled();
    });

    it('rejeita departamento pai de si mesmo (400)', async () => {
      prisma.department.findFirst.mockResolvedValue(DEPARTMENT);
      await expect(
        service.updateDepartment(ACTOR, 'dep-1', { parentId: 'dep-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('delete com subdepartamentos/equipes/usuários → 409', async () => {
      prisma.department.findFirst.mockResolvedValue(DEPARTMENT);
      prisma.department.count.mockResolvedValue(1); // subdepartamento
      prisma.team.count.mockResolvedValue(2);
      prisma.userDepartment.count.mockResolvedValue(5);

      await expect(service.deleteDepartment(ACTOR, 'dep-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.department.delete).not.toHaveBeenCalled();
    });

    it('delete limpo exclui e audita', async () => {
      prisma.department.findFirst.mockResolvedValue(DEPARTMENT);
      prisma.department.count.mockResolvedValue(0);
      prisma.team.count.mockResolvedValue(0);
      prisma.userDepartment.count.mockResolvedValue(0);

      const result = await service.deleteDepartment(ACTOR, 'dep-1');
      expect(result).toEqual({ deleted: true });
      expect(mockAuditService.logWithDiff).toHaveBeenCalledWith(
        DEPARTMENT,
        null,
        expect.objectContaining({ entity: 'Department', action: 'DELETE' }),
      );
    });
  });

  // ─── Equipes ───────────────────────────────────────────────────────────────

  describe('equipes', () => {
    it('lista escopado pela empresa VIA departamento (Team não tem companyId)', async () => {
      await service.listTeams('co-1');
      expect(prisma.team.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { department: { companyId: 'co-1' } } }),
      );
    });

    it('cria equipe apenas em departamento da própria empresa', async () => {
      prisma.department.findFirst.mockResolvedValue(null); // dep de outra empresa
      await expect(
        service.createTeam(ACTOR, { name: 'Turno X', departmentId: 'dep-alheio' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.team.create).not.toHaveBeenCalled();
    });

    it('update de equipe de OUTRA empresa → 404 (anti-IDOR via departamento)', async () => {
      prisma.team.findFirst.mockResolvedValue(null);
      await expect(
        service.updateTeam(ACTOR, 'team-alheio', { name: 'Hack' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.team.findFirst).toHaveBeenCalledWith({
        where: { id: 'team-alheio', department: { companyId: 'co-1' } },
      });
    });

    it('delete com membros → 409', async () => {
      prisma.team.findFirst.mockResolvedValue(TEAM);
      prisma.userTeam.count.mockResolvedValue(4);
      await expect(service.deleteTeam(ACTOR, 'team-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.team.delete).not.toHaveBeenCalled();
    });
  });

  // ─── Vínculos usuário ↔ departamento/equipe ───────────────────────────────

  describe('vínculos de usuários', () => {
    it('usuário-alvo de OUTRA empresa → 404 (anti-IDOR)', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(
        service.addUserDepartment(ACTOR, 'user-alheio', { departmentId: 'dep-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('vínculo duplicado com departamento → 409', async () => {
      prisma.user.findFirst.mockResolvedValue(TARGET_USER);
      prisma.department.findFirst.mockResolvedValue(DEPARTMENT);
      prisma.userDepartment.findUnique.mockResolvedValue({ id: 'ud-1' });

      await expect(
        service.addUserDepartment(ACTOR, 'user-2', { departmentId: 'dep-1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('vincular a departamento audita e INVALIDA o cache de permissões do usuário', async () => {
      prisma.user.findFirst.mockResolvedValue(TARGET_USER);
      prisma.department.findFirst.mockResolvedValue(DEPARTMENT);
      prisma.userDepartment.findUnique.mockResolvedValue(null);
      const link = { id: 'ud-1', userId: 'user-2', departmentId: 'dep-1', isPrimary: false };
      prisma.userDepartment.create.mockResolvedValue(link);

      await service.addUserDepartment(ACTOR, 'user-2', { departmentId: 'dep-1' });

      expect(mockPermissionService.invalidateUser).toHaveBeenCalledWith('user-2', 'co-1');
      expect(mockAuditService.logWithDiff).toHaveBeenCalledWith(
        null,
        link,
        expect.objectContaining({ entity: 'UserDepartment', action: 'CREATE' }),
      );
    });

    it('isPrimary desmarca o departamento principal anterior (transacional)', async () => {
      prisma.user.findFirst.mockResolvedValue(TARGET_USER);
      prisma.department.findFirst.mockResolvedValue(DEPARTMENT);
      prisma.userDepartment.findUnique.mockResolvedValue(null);
      prisma.userDepartment.create.mockResolvedValue({ id: 'ud-2', isPrimary: true });

      await service.addUserDepartment(ACTOR, 'user-2', {
        departmentId: 'dep-1',
        isPrimary: true,
      });

      expect(prisma.userDepartment.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-2', isPrimary: true },
        data: { isPrimary: false },
      });
    });

    it('remover vínculo inexistente → 404', async () => {
      prisma.user.findFirst.mockResolvedValue(TARGET_USER);
      prisma.userDepartment.findFirst.mockResolvedValue(null);
      await expect(
        service.removeUserDepartment(ACTOR, 'user-2', 'dep-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('vincular/desvincular equipe invalida cache e audita', async () => {
      prisma.user.findFirst.mockResolvedValue(TARGET_USER);
      prisma.team.findFirst.mockResolvedValue(TEAM);
      prisma.userTeam.findUnique.mockResolvedValue(null);
      const link = { id: 'ut-1', userId: 'user-2', teamId: 'team-1' };
      prisma.userTeam.create.mockResolvedValue(link);

      await service.addUserTeam(ACTOR, 'user-2', { teamId: 'team-1' });
      expect(mockPermissionService.invalidateUser).toHaveBeenCalledWith('user-2', 'co-1');

      prisma.userTeam.findFirst.mockResolvedValue({ ...link, team: { name: 'Turno A' } });
      await service.removeUserTeam(ACTOR, 'user-2', 'team-1');
      expect(mockAuditService.logWithDiff).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'ut-1' }),
        null,
        expect.objectContaining({ entity: 'UserTeam', action: 'DELETE' }),
      );
    });

    it('vínculo duplicado com equipe → 409', async () => {
      prisma.user.findFirst.mockResolvedValue(TARGET_USER);
      prisma.team.findFirst.mockResolvedValue(TEAM);
      prisma.userTeam.findUnique.mockResolvedValue({ id: 'ut-1' });
      await expect(
        service.addUserTeam(ACTOR, 'user-2', { teamId: 'team-1' }),
      ).rejects.toThrow(ConflictException);
    });
  });
});

// ─── Enforcement declarativo do controller (#347) ────────────────────────────

describe('OrgStructureController — permissões aplicadas', () => {
  const ORG_PERMISSION_BY_METHOD: Record<string, string> = {
    listBranches: 'iam.org.view',
    createBranch: 'iam.org.manage',
    updateBranch: 'iam.org.manage',
    deleteBranch: 'iam.org.manage',
    listDepartments: 'iam.org.view',
    createDepartment: 'iam.org.manage',
    updateDepartment: 'iam.org.manage',
    deleteDepartment: 'iam.org.manage',
    listTeams: 'iam.org.view',
    createTeam: 'iam.org.manage',
    updateTeam: 'iam.org.manage',
    deleteTeam: 'iam.org.manage',
    listUserDepartments: 'iam.org.view',
    addUserDepartment: 'iam.org.assign',
    removeUserDepartment: 'iam.org.assign',
    listUserTeams: 'iam.org.view',
    addUserTeam: 'iam.org.assign',
    removeUserTeam: 'iam.org.assign',
  };

  it('TODAS as rotas têm @RequirePermission(iam.org.*) coerente', () => {
    for (const [method, expected] of Object.entries(ORG_PERMISSION_BY_METHOD)) {
      const handler = OrgStructureController.prototype[
        method as keyof OrgStructureController
      ];
      expect(handler).toBeDefined();
      const permission = Reflect.getMetadata(REQUIRE_PERMISSION_KEY, handler as object);
      expect({ method, permission }).toEqual({ method, permission: [expected] });
    }
  });

  it('TODAS as rotas têm @Roles SUPER_ADMIN/DIRECTOR/MANAGER (dupla proteção)', () => {
    for (const method of Object.keys(ORG_PERMISSION_BY_METHOD)) {
      const handler = OrgStructureController.prototype[
        method as keyof OrgStructureController
      ];
      const roles = Reflect.getMetadata('roles', handler as object);
      expect({ method, roles }).toEqual({
        method,
        roles: ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER'],
      });
    }
  });
});

// ─── Catálogo e perfis (#347) ─────────────────────────────────────────────────

describe('catálogo iam.org.* e perfis coerentes', () => {
  const codes = PERMISSIONS_CATALOG.map((p) => p.code);

  it('as 3 permissões iam.org.* existem no catálogo', () => {
    expect(codes).toContain('iam.org.view');
    expect(codes).toContain('iam.org.manage');
    expect(codes).toContain('iam.org.assign');
  });

  it('ADMIN_GLOBAL e ADMIN_EMPRESA recebem tudo de iam.org.*', () => {
    for (const role of ['ADMIN_GLOBAL', 'ADMIN_EMPRESA']) {
      const effective = resolveEffectivePermissions(role);
      expect(effective).toEqual(
        expect.arrayContaining(['iam.org.view', 'iam.org.manage', 'iam.org.assign']),
      );
    }
  });

  it('DIRETOR gerencia estrutura e vínculos (view+manage+assign)', () => {
    const effective = resolveEffectivePermissions('DIRETOR');
    expect(effective).toEqual(
      expect.arrayContaining(['iam.org.view', 'iam.org.manage', 'iam.org.assign']),
    );
  });

  it('RH vê a estrutura e aloca pessoas, mas NÃO gerencia a estrutura', () => {
    const effective = resolveEffectivePermissions('RH');
    expect(effective).toContain('iam.org.view');
    expect(effective).toContain('iam.org.assign');
    expect(effective).not.toContain('iam.org.manage');
  });

  it('ADMIN_FILIAL e AUDITOR só enxergam (view, sem manage/assign)', () => {
    for (const role of ['ADMIN_FILIAL', 'AUDITOR']) {
      const effective = resolveEffectivePermissions(role);
      expect(effective).toContain('iam.org.view');
      expect(effective).not.toContain('iam.org.manage');
      expect(effective).not.toContain('iam.org.assign');
    }
  });

  it('SOMENTE_LEITURA e VISITANTE não recebem nada de iam.org.*', () => {
    for (const role of ['SOMENTE_LEITURA', 'VISITANTE']) {
      const effective = resolveEffectivePermissions(role);
      expect(effective.filter((c) => c.startsWith('iam.org.'))).toEqual([]);
    }
  });
});
