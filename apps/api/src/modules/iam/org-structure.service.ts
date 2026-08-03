import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from './audit.service';
import { PermissionService } from './permission.service';
import {
  AddUserDepartmentDto,
  AddUserTeamDto,
  CreateBranchDto,
  CreateDepartmentDto,
  CreateTeamDto,
  UpdateBranchDto,
  UpdateDepartmentDto,
  UpdateTeamDto,
} from './dto/org-structure.dto';

/**
 * OrgStructureService — CRUD da estrutura organizacional (Filiais,
 * Departamentos, Equipes) + vínculos usuário ↔ departamento/equipe.
 * Issue #347 (IAM F5.2 — multi-tenant avançado, FASE 1).
 *
 * ESCOPO DELIBERADO DA FASE 1 (Decisão 3 do schema #462):
 * - Departamentos e equipes são APENAS estrutura organizacional — NÃO
 *   participam do cálculo de permissões ainda.
 * - O escopo por filial nas permissões já existe via
 *   UserRoleAssignment.branchId (#352/#471) — este service NÃO duplica isso.
 * - O ENFORCEMENT (filtro automático de dados por filial/departamento em todo
 *   o sistema) é a FASE 2 da #347.
 *
 * Regras centrais (mesmo padrão do RolesAdminService/UserAccessService):
 * - Tudo escopado pelo companyId do JWT — entidade de outra empresa → 404
 *   (anti-IDOR). Team não tem companyId próprio: o escopo vem do Department.
 * - DELETE somente sem vínculos (senão 409 com mensagem explicativa).
 * - Toda mutação grava AuditService.logWithDiff (assíncrono, best-effort).
 * - Vínculos usuário ↔ departamento/equipe invalidam o cache de permissões do
 *   usuário: hoje não mudam o resultado do PermissionService, mas a fase 2
 *   fará; invalidar já (custo baixo) evita cache velho na virada.
 */

interface Actor {
  id: string;
  companyId: string;
}

@Injectable()
export class OrgStructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly auditService: AuditService,
  ) {}

  // ─── Filiais ───────────────────────────────────────────────────────────────

  async listBranches(companyId: string) {
    return this.prisma.branch.findMany({
      where: { companyId },
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        cnpj: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { userRoleAssignments: true } },
      },
    });
  }

  async createBranch(actor: Actor, dto: CreateBranchDto) {
    const existing = await this.prisma.branch.findUnique({
      where: { companyId_code: { companyId: actor.companyId, code: dto.code } },
    });
    if (existing) {
      throw new ConflictException(
        `Já existe uma filial com o código '${dto.code}' nesta empresa.`,
      );
    }

    const branch = await this.prisma.branch.create({
      data: {
        companyId: actor.companyId,
        code: dto.code,
        name: dto.name,
        cnpj: dto.cnpj ?? null,
      },
    });

    await this.auditService.logWithDiff(null, branch, {
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'Branch',
      entityId: branch.id,
      action: AuditAction.CREATE,
      module: 'iam',
    });

    return branch;
  }

  async updateBranch(actor: Actor, branchId: string, dto: UpdateBranchDto) {
    const branch = await this.findBranch(actor.companyId, branchId);

    const updated = await this.prisma.branch.update({
      where: { id: branch.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.cnpj !== undefined ? { cnpj: dto.cnpj || null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    await this.auditService.logWithDiff(branch, updated, {
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'Branch',
      entityId: branch.id,
      action: AuditAction.UPDATE,
      module: 'iam',
    });

    return updated;
  }

  async deleteBranch(actor: Actor, branchId: string) {
    const branch = await this.findBranch(actor.companyId, branchId);

    const assignments = await this.prisma.userRoleAssignment.count({
      where: { branchId: branch.id },
    });
    if (assignments > 0) {
      throw new ConflictException(
        `A filial '${branch.name}' está referenciada em ${assignments} atribuição(ões) ` +
          'de perfil com escopo de filial. Remova o escopo das atribuições antes de excluir ' +
          '(ou apenas desative a filial).',
      );
    }

    await this.prisma.branch.delete({ where: { id: branch.id } });

    await this.auditService.logWithDiff(branch, null, {
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'Branch',
      entityId: branch.id,
      action: AuditAction.DELETE,
      module: 'iam',
    });

    return { deleted: true };
  }

  // ─── Departamentos ─────────────────────────────────────────────────────────

  async listDepartments(companyId: string) {
    return this.prisma.department.findMany({
      where: { companyId },
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
        parentId: true,
        parent: { select: { id: true, code: true, name: true } },
        managerId: true,
        manager: { select: { id: true, name: true, email: true } },
        createdAt: true,
        updatedAt: true,
        _count: { select: { teams: true, users: true, children: true } },
      },
    });
  }

  async createDepartment(actor: Actor, dto: CreateDepartmentDto) {
    const existing = await this.prisma.department.findUnique({
      where: { companyId_code: { companyId: actor.companyId, code: dto.code } },
    });
    if (existing) {
      throw new ConflictException(
        `Já existe um departamento com o código '${dto.code}' nesta empresa.`,
      );
    }

    if (dto.parentId) {
      await this.findDepartment(actor.companyId, dto.parentId, 'Departamento pai');
    }
    if (dto.managerId) {
      await this.findCompanyUser(actor.companyId, dto.managerId, 'Gerente');
    }

    const department = await this.prisma.department.create({
      data: {
        companyId: actor.companyId,
        code: dto.code,
        name: dto.name,
        parentId: dto.parentId ?? null,
        managerId: dto.managerId ?? null,
      },
    });

    await this.auditService.logWithDiff(null, department, {
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'Department',
      entityId: department.id,
      action: AuditAction.CREATE,
      module: 'iam',
    });

    return department;
  }

  async updateDepartment(actor: Actor, departmentId: string, dto: UpdateDepartmentDto) {
    const department = await this.findDepartment(actor.companyId, departmentId);

    // Normaliza '' → null (remover pai/gerente)
    const parentId = dto.parentId === '' ? null : dto.parentId;
    const managerId = dto.managerId === '' ? null : dto.managerId;

    if (parentId) {
      if (parentId === department.id) {
        throw new BadRequestException('Um departamento não pode ser pai de si mesmo.');
      }
      await this.findDepartment(actor.companyId, parentId, 'Departamento pai');
      await this.assertNoHierarchyCycle(department.id, parentId);
    }
    if (managerId) {
      await this.findCompanyUser(actor.companyId, managerId, 'Gerente');
    }

    const updated = await this.prisma.department.update({
      where: { id: department.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.parentId !== undefined ? { parentId } : {}),
        ...(dto.managerId !== undefined ? { managerId } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    await this.auditService.logWithDiff(department, updated, {
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'Department',
      entityId: department.id,
      action: AuditAction.UPDATE,
      module: 'iam',
    });

    return updated;
  }

  async deleteDepartment(actor: Actor, departmentId: string) {
    const department = await this.findDepartment(actor.companyId, departmentId);

    const [children, teams, users] = await Promise.all([
      this.prisma.department.count({ where: { parentId: department.id } }),
      this.prisma.team.count({ where: { departmentId: department.id } }),
      this.prisma.userDepartment.count({ where: { departmentId: department.id } }),
    ]);
    const blockers: string[] = [];
    if (children > 0) blockers.push(`${children} subdepartamento(s)`);
    if (teams > 0) blockers.push(`${teams} equipe(s)`);
    if (users > 0) blockers.push(`${users} usuário(s) vinculado(s)`);
    if (blockers.length > 0) {
      throw new ConflictException(
        `O departamento '${department.name}' possui ${blockers.join(', ')}. ` +
          'Remova os vínculos antes de excluir (ou apenas desative o departamento).',
      );
    }

    await this.prisma.department.delete({ where: { id: department.id } });

    await this.auditService.logWithDiff(department, null, {
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'Department',
      entityId: department.id,
      action: AuditAction.DELETE,
      module: 'iam',
    });

    return { deleted: true };
  }

  // ─── Equipes ───────────────────────────────────────────────────────────────

  async listTeams(companyId: string) {
    return this.prisma.team.findMany({
      where: { department: { companyId } },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        isActive: true,
        departmentId: true,
        department: { select: { id: true, code: true, name: true } },
        leaderId: true,
        leader: { select: { id: true, name: true, email: true } },
        createdAt: true,
        updatedAt: true,
        _count: { select: { members: true } },
      },
    });
  }

  async createTeam(actor: Actor, dto: CreateTeamDto) {
    await this.findDepartment(actor.companyId, dto.departmentId, 'Departamento');
    if (dto.leaderId) {
      await this.findCompanyUser(actor.companyId, dto.leaderId, 'Líder');
    }

    const team = await this.prisma.team.create({
      data: {
        name: dto.name,
        departmentId: dto.departmentId,
        leaderId: dto.leaderId ?? null,
      },
    });

    await this.auditService.logWithDiff(null, team, {
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'Team',
      entityId: team.id,
      action: AuditAction.CREATE,
      module: 'iam',
    });

    return team;
  }

  async updateTeam(actor: Actor, teamId: string, dto: UpdateTeamDto) {
    const team = await this.findTeam(actor.companyId, teamId);

    const leaderId = dto.leaderId === '' ? null : dto.leaderId;

    if (dto.departmentId) {
      await this.findDepartment(actor.companyId, dto.departmentId, 'Departamento');
    }
    if (leaderId) {
      await this.findCompanyUser(actor.companyId, leaderId, 'Líder');
    }

    const updated = await this.prisma.team.update({
      where: { id: team.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.departmentId !== undefined ? { departmentId: dto.departmentId } : {}),
        ...(dto.leaderId !== undefined ? { leaderId } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    await this.auditService.logWithDiff(team, updated, {
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'Team',
      entityId: team.id,
      action: AuditAction.UPDATE,
      module: 'iam',
    });

    return updated;
  }

  async deleteTeam(actor: Actor, teamId: string) {
    const team = await this.findTeam(actor.companyId, teamId);

    const members = await this.prisma.userTeam.count({ where: { teamId: team.id } });
    if (members > 0) {
      throw new ConflictException(
        `A equipe '${team.name}' possui ${members} membro(s). ` +
          'Remova os vínculos antes de excluir (ou apenas desative a equipe).',
      );
    }

    await this.prisma.team.delete({ where: { id: team.id } });

    await this.auditService.logWithDiff(team, null, {
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'Team',
      entityId: team.id,
      action: AuditAction.DELETE,
      module: 'iam',
    });

    return { deleted: true };
  }

  // ─── Vínculos usuário ↔ departamento ──────────────────────────────────────

  async listUserDepartments(companyId: string, userId: string) {
    await this.findCompanyUser(companyId, userId);
    return this.prisma.userDepartment.findMany({
      where: { userId, department: { companyId } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        isPrimary: true,
        createdAt: true,
        department: { select: { id: true, code: true, name: true, isActive: true } },
      },
    });
  }

  async addUserDepartment(actor: Actor, userId: string, dto: AddUserDepartmentDto) {
    const target = await this.findCompanyUser(actor.companyId, userId);
    const department = await this.findDepartment(
      actor.companyId,
      dto.departmentId,
      'Departamento',
    );

    const existing = await this.prisma.userDepartment.findUnique({
      where: {
        userId_departmentId: { userId: target.id, departmentId: department.id },
      },
    });
    if (existing) {
      throw new ConflictException(
        `O usuário já está vinculado ao departamento '${department.name}'.`,
      );
    }

    const link = await this.prisma.$transaction(async (tx) => {
      // Departamento principal é único por usuário: marcar aqui desmarca o anterior
      if (dto.isPrimary) {
        await tx.userDepartment.updateMany({
          where: { userId: target.id, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      return tx.userDepartment.create({
        data: {
          userId: target.id,
          departmentId: department.id,
          isPrimary: dto.isPrimary ?? false,
        },
      });
    });

    // Fase 2-ready: vínculo organizacional ainda não muda permissões, mas
    // invalidar o cache já garante consistência na virada do enforcement.
    await this.permissionService.invalidateUser(target.id, actor.companyId);

    await this.auditService.logWithDiff(null, link, {
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'UserDepartment',
      entityId: link.id,
      action: AuditAction.CREATE,
      module: 'iam',
    });

    return link;
  }

  async removeUserDepartment(actor: Actor, userId: string, departmentId: string) {
    const target = await this.findCompanyUser(actor.companyId, userId);

    const link = await this.prisma.userDepartment.findFirst({
      where: {
        userId: target.id,
        departmentId,
        department: { companyId: actor.companyId },
      },
      include: { department: { select: { code: true, name: true } } },
    });
    if (!link) {
      throw new NotFoundException('O usuário não está vinculado a este departamento.');
    }

    await this.prisma.userDepartment.delete({ where: { id: link.id } });

    await this.permissionService.invalidateUser(target.id, actor.companyId);

    await this.auditService.logWithDiff(link, null, {
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'UserDepartment',
      entityId: link.id,
      action: AuditAction.DELETE,
      module: 'iam',
    });

    return { removed: true };
  }

  // ─── Vínculos usuário ↔ equipe ────────────────────────────────────────────

  async listUserTeams(companyId: string, userId: string) {
    await this.findCompanyUser(companyId, userId);
    return this.prisma.userTeam.findMany({
      where: { userId, team: { department: { companyId } } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        createdAt: true,
        team: {
          select: {
            id: true,
            name: true,
            isActive: true,
            department: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
  }

  async addUserTeam(actor: Actor, userId: string, dto: AddUserTeamDto) {
    const target = await this.findCompanyUser(actor.companyId, userId);
    const team = await this.findTeam(actor.companyId, dto.teamId);

    const existing = await this.prisma.userTeam.findUnique({
      where: { userId_teamId: { userId: target.id, teamId: team.id } },
    });
    if (existing) {
      throw new ConflictException(`O usuário já é membro da equipe '${team.name}'.`);
    }

    const link = await this.prisma.userTeam.create({
      data: { userId: target.id, teamId: team.id },
    });

    await this.permissionService.invalidateUser(target.id, actor.companyId);

    await this.auditService.logWithDiff(null, link, {
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'UserTeam',
      entityId: link.id,
      action: AuditAction.CREATE,
      module: 'iam',
    });

    return link;
  }

  async removeUserTeam(actor: Actor, userId: string, teamId: string) {
    const target = await this.findCompanyUser(actor.companyId, userId);

    const link = await this.prisma.userTeam.findFirst({
      where: {
        userId: target.id,
        teamId,
        team: { department: { companyId: actor.companyId } },
      },
      include: { team: { select: { name: true } } },
    });
    if (!link) {
      throw new NotFoundException('O usuário não é membro desta equipe.');
    }

    await this.prisma.userTeam.delete({ where: { id: link.id } });

    await this.permissionService.invalidateUser(target.id, actor.companyId);

    await this.auditService.logWithDiff(link, null, {
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'UserTeam',
      entityId: link.id,
      action: AuditAction.DELETE,
      module: 'iam',
    });

    return { removed: true };
  }

  // ─── Internos ──────────────────────────────────────────────────────────────

  /** Filial DA MESMA empresa do JWT, ou 404 (anti-IDOR). */
  private async findBranch(companyId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
    });
    if (!branch) throw new NotFoundException('Filial não encontrada.');
    return branch;
  }

  /** Departamento DA MESMA empresa do JWT, ou 404 (anti-IDOR). */
  private async findDepartment(
    companyId: string,
    departmentId: string,
    label = 'Departamento',
  ) {
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, companyId },
    });
    if (!department) throw new NotFoundException(`${label} não encontrado.`);
    return department;
  }

  /** Equipe cujo departamento é DA MESMA empresa do JWT, ou 404 (anti-IDOR). */
  private async findTeam(companyId: string, teamId: string) {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, department: { companyId } },
    });
    if (!team) throw new NotFoundException('Equipe não encontrada.');
    return team;
  }

  /** Usuário DA MESMA empresa do JWT, ou 404 (anti-IDOR). */
  private async findCompanyUser(companyId: string, userId: string, label = 'Usuário') {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
      select: { id: true, name: true, email: true },
    });
    if (!user) throw new NotFoundException(`${label} não encontrado nesta empresa.`);
    return user;
  }

  /**
   * Defende contra ciclo na hierarquia de departamentos: subindo a cadeia a
   * partir do NOVO pai, o próprio departamento não pode aparecer.
   */
  private async assertNoHierarchyCycle(departmentId: string, newParentId: string) {
    const visited = new Set<string>();
    let currentId: string | null = newParentId;
    let depth = 0;
    while (currentId && depth < 50 && !visited.has(currentId)) {
      if (currentId === departmentId) {
        throw new BadRequestException(
          'Hierarquia inválida: o departamento pai escolhido é descendente deste departamento (ciclo).',
        );
      }
      visited.add(currentId);
      depth += 1;
      const parent: { parentId: string | null } | null =
        // tenant-lint: ok (caminhada de árvore a partir de nó já validado no tenant pelo chamador)
        await this.prisma.department.findUnique({
          where: { id: currentId },
          select: { parentId: true },
        });
      currentId = parent?.parentId ?? null;
    }
  }
}
