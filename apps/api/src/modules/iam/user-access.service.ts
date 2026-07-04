import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, PermissionChangeType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from './audit.service';
import { PermissionService } from './permission.service';
import { wouldLockOutOfRolesAdmin } from './access-lockout.util';
import { AssignRoleDto, GrantUserPermissionDto } from './dto/roles-admin.dto';

/**
 * UserAccessService — atribuições de perfil e exceções individuais por usuário.
 * Issue #352 (IAM F7.2 — tela de gestão de perfis e permissões).
 *
 * Regras centrais:
 * - Alvo SEMPRE da mesma empresa do JWT (multi-tenant, anti-IDOR) — senão 404.
 * - Toda mutação grava PermissionChangeLog NA MESMA TRANSAÇÃO (Decisão 5)
 *   + AuditService.logWithDiff + PermissionService.invalidateUser.
 * - Anti-auto-lockout (sanidade): ninguém remove o PRÓPRIO acesso à gestão
 *   de perfis; denies individuais de iam.roles.* não podem ser aplicados a
 *   usuários SUPER_ADMIN (trancar o admin para fora da gestão).
 */

interface Actor {
  id: string;
  companyId: string;
}

/** Prefixo das permissões que dão acesso à gestão de perfis (tela #352). */
const ROLES_ADMIN_PREFIX = 'iam.roles.';

@Injectable()
export class UserAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly auditService: AuditService,
  ) {}

  // ─── Perfis do usuário ─────────────────────────────────────────────────────

  async listUserRoles(companyId: string, userId: string) {
    await this.findTargetUser(companyId, userId);
    return this.prisma.userRoleAssignment.findMany({
      where: { userId, companyId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        roleId: true,
        role: { select: { id: true, code: true, name: true, isSystem: true, isActive: true } },
        branchId: true,
        branch: { select: { id: true, code: true, name: true } },
        expiresAt: true,
        grantedBy: true,
        createdAt: true,
      },
    });
  }

  async assignRole(actor: Actor, userId: string, dto: AssignRoleDto) {
    const target = await this.findTargetUser(actor.companyId, userId);

    const role = await this.prisma.role.findFirst({
      where: {
        id: dto.roleId,
        isActive: true,
        OR: [{ isSystem: true }, { companyId: actor.companyId }],
      },
      select: { id: true, code: true, name: true },
    });
    if (!role) {
      throw new NotFoundException('Perfil não encontrado ou inativo.');
    }

    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, companyId: actor.companyId },
        select: { id: true },
      });
      if (!branch) throw new NotFoundException('Filial não encontrada.');
    }

    const existing = await this.prisma.userRoleAssignment.findUnique({
      where: {
        userId_roleId_companyId: {
          userId: target.id,
          roleId: role.id,
          companyId: actor.companyId,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        `O usuário já possui o perfil '${role.name}' nesta empresa.`,
      );
    }

    const assignment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.userRoleAssignment.create({
        data: {
          userId: target.id,
          roleId: role.id,
          companyId: actor.companyId,
          branchId: dto.branchId ?? null,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          grantedBy: actor.id,
        },
      });
      await tx.permissionChangeLog.create({
        data: {
          companyId: actor.companyId,
          targetUserId: target.id,
          changedByUserId: actor.id,
          changeType: PermissionChangeType.ROLE_ASSIGNED,
          roleId: role.id,
          newState: {
            roleCode: role.code,
            branchId: dto.branchId ?? null,
            expiresAt: dto.expiresAt ?? null,
          },
        },
      });
      return created;
    });

    await this.permissionService.invalidateUser(target.id, actor.companyId);

    await this.auditService.logWithDiff(null, assignment, {
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'UserRoleAssignment',
      entityId: assignment.id,
      action: AuditAction.CREATE,
      module: 'iam',
    });

    return assignment;
  }

  async removeRole(actor: Actor, userId: string, roleId: string) {
    const target = await this.findTargetUser(actor.companyId, userId);

    const assignment = await this.prisma.userRoleAssignment.findUnique({
      where: {
        userId_roleId_companyId: {
          userId: target.id,
          roleId,
          companyId: actor.companyId,
        },
      },
      include: { role: { select: { code: true, name: true } } },
    });
    if (!assignment) {
      throw new NotFoundException('O usuário não possui este perfil.');
    }

    // Anti-auto-lockout: remover o próprio perfil não pode tirar o acesso à gestão
    if (target.id === actor.id) {
      const lockout = await wouldLockOutOfRolesAdmin(
        this.prisma,
        actor.id,
        actor.companyId,
        { excludeAssignmentRoleId: roleId },
      );
      if (lockout) {
        throw new BadRequestException(
          `Remover o perfil '${assignment.role.name}' de você mesmo removeria o seu ` +
            'acesso à gestão de perfis e permissões — auto-lockout. ' +
            'Peça para outro administrador fazer esta remoção.',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userRoleAssignment.delete({ where: { id: assignment.id } });
      await tx.permissionChangeLog.create({
        data: {
          companyId: actor.companyId,
          targetUserId: target.id,
          changedByUserId: actor.id,
          changeType: PermissionChangeType.ROLE_REMOVED,
          roleId,
          previousState: {
            roleCode: assignment.role.code,
            branchId: assignment.branchId,
            expiresAt: assignment.expiresAt?.toISOString() ?? null,
          },
        },
      });
    });

    await this.permissionService.invalidateUser(target.id, actor.companyId);

    await this.auditService.logWithDiff(assignment, null, {
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'UserRoleAssignment',
      entityId: assignment.id,
      action: AuditAction.DELETE,
      module: 'iam',
    });

    return { removed: true };
  }

  // ─── Exceções individuais (grants/denies) ──────────────────────────────────

  async listUserPermissions(companyId: string, userId: string) {
    await this.findTargetUser(companyId, userId);
    return this.prisma.userPermission.findMany({
      where: { userId, companyId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        granted: true,
        expiresAt: true,
        reason: true,
        grantedBy: true,
        createdAt: true,
        permission: {
          select: { id: true, code: true, name: true, module: true, resource: true, action: true },
        },
      },
    });
  }

  async grantPermission(actor: Actor, userId: string, dto: GrantUserPermissionDto) {
    const target = await this.findTargetUser(actor.companyId, userId);
    const granted = dto.granted ?? true;

    const permission = await this.prisma.permission.findUnique({
      where: { code: dto.permissionCode },
      select: { id: true, code: true, name: true },
    });
    if (!permission) {
      throw new BadRequestException(
        `Permissão '${dto.permissionCode}' não existe no catálogo.`,
      );
    }

    if (!granted && permission.code.startsWith(ROLES_ADMIN_PREFIX)) {
      // Sanidade 1: deny individual não pode trancar um SUPER_ADMIN fora da gestão
      if (target.role === 'SUPER_ADMIN') {
        throw new BadRequestException(
          'Não é permitido negar permissões de gestão de perfis (iam.roles.*) a um ' +
            'usuário SUPER_ADMIN — isso trancaria o administrador para fora da própria gestão.',
        );
      }
      // Sanidade 2: deny em si mesmo não pode causar auto-lockout
      if (target.id === actor.id) {
        const lockout = await wouldLockOutOfRolesAdmin(
          this.prisma,
          actor.id,
          actor.companyId,
          { addUserDenyCodes: [permission.code] },
        );
        if (lockout) {
          throw new BadRequestException(
            'Este deny removeria o SEU acesso à gestão de perfis e permissões — ' +
              'auto-lockout. Peça para outro administrador aplicar a restrição.',
          );
        }
      }
    }

    const before = await this.prisma.userPermission.findUnique({
      where: {
        userId_permissionId_companyId: {
          userId: target.id,
          permissionId: permission.id,
          companyId: actor.companyId,
        },
      },
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const upserted = await tx.userPermission.upsert({
        where: {
          userId_permissionId_companyId: {
            userId: target.id,
            permissionId: permission.id,
            companyId: actor.companyId,
          },
        },
        update: {
          granted,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          reason: dto.reason ?? null,
          grantedBy: actor.id,
        },
        create: {
          userId: target.id,
          permissionId: permission.id,
          companyId: actor.companyId,
          granted,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          reason: dto.reason ?? null,
          grantedBy: actor.id,
        },
      });
      await tx.permissionChangeLog.create({
        data: {
          companyId: actor.companyId,
          targetUserId: target.id,
          changedByUserId: actor.id,
          changeType: granted
            ? PermissionChangeType.PERMISSION_GRANTED
            : PermissionChangeType.PERMISSION_REVOKED,
          permissionId: permission.id,
          reason: dto.reason ?? null,
          previousState: before
            ? {
                granted: before.granted,
                expiresAt: before.expiresAt?.toISOString() ?? null,
                reason: before.reason,
              }
            : undefined,
          newState: {
            code: permission.code,
            granted,
            expiresAt: dto.expiresAt ?? null,
          },
        },
      });
      return upserted;
    });

    await this.permissionService.invalidateUser(target.id, actor.companyId);

    await this.auditService.logWithDiff(before, result, {
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'UserPermission',
      entityId: result.id,
      action: before ? AuditAction.UPDATE : AuditAction.CREATE,
      module: 'iam',
    });

    return result;
  }

  async removePermission(actor: Actor, userId: string, userPermissionId: string) {
    const target = await this.findTargetUser(actor.companyId, userId);

    const exception = await this.prisma.userPermission.findFirst({
      where: { id: userPermissionId, userId: target.id, companyId: actor.companyId },
      include: { permission: { select: { id: true, code: true } } },
    });
    if (!exception) {
      throw new NotFoundException('Exceção de permissão não encontrada.');
    }

    // Anti-auto-lockout: remover um GRANT próprio de iam.roles.* não pode
    // tirar o acesso à gestão
    if (
      target.id === actor.id &&
      exception.granted &&
      exception.permission.code.startsWith(ROLES_ADMIN_PREFIX)
    ) {
      const lockout = await wouldLockOutOfRolesAdmin(
        this.prisma,
        actor.id,
        actor.companyId,
        { excludeUserPermissionId: exception.id },
      );
      if (lockout) {
        throw new BadRequestException(
          'Remover esta exceção removeria o SEU acesso à gestão de perfis e ' +
            'permissões — auto-lockout. Peça para outro administrador fazer a remoção.',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userPermission.delete({ where: { id: exception.id } });
      await tx.permissionChangeLog.create({
        data: {
          companyId: actor.companyId,
          targetUserId: target.id,
          changedByUserId: actor.id,
          // Remoção de grant = acesso revogado; remoção de deny = acesso volta
          changeType: exception.granted
            ? PermissionChangeType.PERMISSION_REVOKED
            : PermissionChangeType.PERMISSION_GRANTED,
          permissionId: exception.permission.id,
          previousState: {
            code: exception.permission.code,
            granted: exception.granted,
            expiresAt: exception.expiresAt?.toISOString() ?? null,
            reason: exception.reason,
          },
        },
      });
    });

    await this.permissionService.invalidateUser(target.id, actor.companyId);

    await this.auditService.logWithDiff(exception, null, {
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'UserPermission',
      entityId: exception.id,
      action: AuditAction.DELETE,
      module: 'iam',
    });

    return { removed: true };
  }

  // ─── Internos ──────────────────────────────────────────────────────────────

  /** Usuário-alvo DA MESMA empresa do JWT, ou 404 (anti-IDOR). */
  private async findTargetUser(companyId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado nesta empresa.');
    }
    return user;
  }
}
