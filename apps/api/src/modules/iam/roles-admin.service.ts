import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, PermissionChangeType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from './audit.service';
import { PermissionService } from './permission.service';
import { wouldLockOutOfRolesAdmin } from './access-lockout.util';
import { CreateRoleDto, SetRolePermissionsDto, UpdateRoleDto } from './dto/roles-admin.dto';

/**
 * RolesAdminService — CRUD de perfis + conjunto de permissões por perfil.
 * Issue #352 (IAM F7.2 — tela de gestão de perfis e permissões).
 *
 * Regras centrais:
 * - Perfis SYSTEM (isSystem=true) são IMUTÁVEIS por aqui: a fonte da verdade
 *   é o catálogo em código (roles.catalog.ts) + seed. Editar/apagar → 403.
 * - Perfis CUSTOM pertencem à empresa (companyId do JWT) — multi-tenant.
 * - DELETE só quando nenhum usuário está vinculado (senão 409).
 * - Toda mutação grava PermissionChangeLog NA MESMA TRANSAÇÃO (Decisão 5:
 *   auditoria de permissão síncrona) + AuditService.logWithDiff (assíncrono,
 *   best-effort) + invalidação ativa do cache do PermissionService.
 * - Anti-auto-lockout: PUT /roles/:id/permissions não pode remover do PRÓPRIO
 *   autor o acesso à gestão de perfis (simulação antes de aplicar).
 */

interface Actor {
  id: string;
  companyId: string;
}

/** Deriva um code MAIÚSCULO_COM_UNDERSCORE a partir do nome do perfil. */
export function deriveRoleCode(name: string): string {
  const ascii = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  return ascii || 'PERFIL';
}

@Injectable()
export class RolesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly auditService: AuditService,
  ) {}

  // ─── Consulta ──────────────────────────────────────────────────────────────

  /** Perfis visíveis à empresa: todos os system + os custom da empresa. */
  async listRoles(companyId: string) {
    return this.prisma.role.findMany({
      where: { OR: [{ isSystem: true }, { companyId }] },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        isSystem: true,
        isActive: true,
        requireMfa: true,
        companyId: true,
        parentId: true,
        parent: { select: { id: true, code: true, name: true } },
        createdAt: true,
        updatedAt: true,
        _count: { select: { userAssignments: true, rolePermissions: true } },
      },
    });
  }

  /** Catálogo de permissões agrupado por módulo → recurso (para a árvore da UI). */
  async getPermissionsCatalog() {
    const permissions = await this.prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { resource: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        module: true,
        resource: true,
        action: true,
      },
    });

    const byModule = new Map<
      string,
      Map<string, Array<(typeof permissions)[number]>>
    >();
    for (const p of permissions) {
      if (!byModule.has(p.module)) byModule.set(p.module, new Map());
      const resources = byModule.get(p.module)!;
      if (!resources.has(p.resource)) resources.set(p.resource, []);
      resources.get(p.resource)!.push(p);
    }

    return [...byModule.entries()].map(([module, resources]) => ({
      module,
      resources: [...resources.entries()].map(([resource, perms]) => ({
        resource,
        permissions: perms,
      })),
    }));
  }

  /** Permissões de um perfil: diretas (grants e denies) + herdadas via parent. */
  async getRolePermissions(companyId: string, roleId: string) {
    const role = await this.findVisibleRole(companyId, roleId);

    const direct = await this.prisma.rolePermission.findMany({
      where: { roleId: role.id },
      select: { granted: true, permission: { select: { code: true } } },
    });

    // Cadeia de herança (parent → avô → ...), com defesa a ciclo
    const inheritedCodes = new Set<string>();
    const visited = new Set<string>([role.id]);
    let parentId = role.parentId;
    let depth = 0;
    while (parentId && depth < 20 && !visited.has(parentId)) {
      visited.add(parentId);
      depth += 1;
      const parent = await this.prisma.role.findUnique({
        where: { id: parentId },
        select: {
          parentId: true,
          rolePermissions: {
            where: { granted: true },
            select: { permission: { select: { code: true } } },
          },
        },
      });
      if (!parent) break;
      for (const rp of parent.rolePermissions) inheritedCodes.add(rp.permission.code);
      parentId = parent.parentId;
    }

    return {
      roleId: role.id,
      code: role.code,
      name: role.name,
      isSystem: role.isSystem,
      codes: direct.filter((d) => d.granted).map((d) => d.permission.code).sort(),
      deniedCodes: direct.filter((d) => !d.granted).map((d) => d.permission.code).sort(),
      inheritedCodes: [...inheritedCodes].sort(),
    };
  }

  // ─── Mutações ──────────────────────────────────────────────────────────────

  async createRole(actor: Actor, dto: CreateRoleDto) {
    const code = dto.code ?? deriveRoleCode(dto.name);

    const existing = await this.prisma.role.findUnique({ where: { code } });
    if (existing) {
      throw new ConflictException(
        `Já existe um perfil com o código '${code}'. Escolha outro nome ou informe um código diferente.`,
      );
    }

    // Ponto de partida (duplicar perfil): copia os vínculos de permissão
    let copiedPermissions: Array<{ permissionId: string; granted: boolean }> = [];
    if (dto.copyFromRoleId) {
      const source = await this.findVisibleRole(actor.companyId, dto.copyFromRoleId);
      copiedPermissions = await this.prisma.rolePermission.findMany({
        where: { roleId: source.id },
        select: { permissionId: true, granted: true },
      });
    }

    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          code,
          name: dto.name,
          description: dto.description ?? null,
          isSystem: false,
          companyId: actor.companyId,
          isActive: true,
        },
      });
      if (copiedPermissions.length > 0) {
        await tx.rolePermission.createMany({
          data: copiedPermissions.map((p) => ({ roleId: created.id, ...p })),
          skipDuplicates: true,
        });
      }
      // Auditoria de permissão SÍNCRONA (Decisão 5). Evento de nível de perfil:
      // targetUserId = autor (o alvo é o perfil, não um usuário).
      await tx.permissionChangeLog.create({
        data: {
          companyId: actor.companyId,
          targetUserId: actor.id,
          changedByUserId: actor.id,
          changeType: PermissionChangeType.ROLE_CREATED,
          roleId: created.id,
          newState: {
            code: created.code,
            name: created.name,
            copiedFromRoleId: dto.copyFromRoleId ?? null,
            permissionsCopied: copiedPermissions.length,
          },
        },
      });
      return created;
    });

    await this.auditService.logWithDiff(null, role, {
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'Role',
      entityId: role.id,
      action: AuditAction.CREATE,
      module: 'iam',
    });

    return role;
  }

  async updateRole(actor: Actor, roleId: string, dto: UpdateRoleDto) {
    const role = await this.findVisibleRole(actor.companyId, roleId);
    this.assertNotSystem(role, 'editar');

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.role.update({
        where: { id: role.id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      await tx.permissionChangeLog.create({
        data: {
          companyId: actor.companyId,
          targetUserId: actor.id,
          changedByUserId: actor.id,
          changeType: PermissionChangeType.ROLE_UPDATED,
          roleId: role.id,
          previousState: {
            name: role.name,
            description: role.description,
            isActive: role.isActive,
          },
          newState: {
            name: result.name,
            description: result.description,
            isActive: result.isActive,
          },
        },
      });
      return result;
    });

    // Ativar/inativar perfil muda o conjunto efetivo de quem o tem
    if (dto.isActive !== undefined && dto.isActive !== role.isActive) {
      await this.permissionService.invalidateRole(role.id);
    }

    await this.auditService.logWithDiff(role, updated, {
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'Role',
      entityId: role.id,
      action: AuditAction.UPDATE,
      module: 'iam',
    });

    return updated;
  }

  async deleteRole(actor: Actor, roleId: string) {
    const role = await this.findVisibleRole(actor.companyId, roleId);
    this.assertNotSystem(role, 'excluir');

    const [assignments, children] = await Promise.all([
      this.prisma.userRoleAssignment.count({ where: { roleId: role.id } }),
      this.prisma.role.count({ where: { parentId: role.id } }),
    ]);
    if (assignments > 0) {
      throw new ConflictException(
        `O perfil '${role.name}' está vinculado a ${assignments} usuário(s). ` +
          'Remova as atribuições antes de excluir.',
      );
    }
    if (children > 0) {
      throw new ConflictException(
        `O perfil '${role.name}' é pai de ${children} outro(s) perfil(is) (herança). ` +
          'Remova a herança antes de excluir.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.permissionChangeLog.create({
        data: {
          companyId: actor.companyId,
          targetUserId: actor.id,
          changedByUserId: actor.id,
          changeType: PermissionChangeType.ROLE_DELETED,
          previousState: { id: role.id, code: role.code, name: role.name },
        },
      });
      // RolePermission tem onDelete: Cascade; nenhum usuário vinculado (checado acima)
      await tx.role.delete({ where: { id: role.id } });
    });

    await this.auditService.logWithDiff(role, null, {
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'Role',
      entityId: role.id,
      action: AuditAction.DELETE,
      module: 'iam',
    });

    return { deleted: true };
  }

  /** Substitui o conjunto COMPLETO de permissões do perfil (transacional). */
  async setRolePermissions(actor: Actor, roleId: string, dto: SetRolePermissionsDto) {
    const role = await this.findVisibleRole(actor.companyId, roleId);
    this.assertNotSystem(role, 'alterar as permissões de');

    // Valida os codes contra o catálogo materializado no banco
    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: dto.codes } },
      select: { id: true, code: true },
    });
    const foundCodes = new Set(permissions.map((p) => p.code));
    const missing = dto.codes.filter((c) => !foundCodes.has(c));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Permissão(ões) inexistente(s) no catálogo: ${missing.join(', ')}`,
      );
    }

    // Anti-auto-lockout: o autor não pode remover o próprio acesso à gestão
    const lockout = await wouldLockOutOfRolesAdmin(this.prisma, actor.id, actor.companyId, {
      replaceRolePermissions: { roleId: role.id, codes: dto.codes },
    });
    if (lockout) {
      throw new BadRequestException(
        'Esta alteração removeria o SEU acesso à gestão de perfis e permissões ' +
          '(iam.roles.manage/iam.roles.assign) — auto-lockout. ' +
          'Peça para outro administrador aplicar a mudança.',
      );
    }

    const before = await this.prisma.rolePermission.findMany({
      where: { roleId: role.id },
      select: { id: true, permissionId: true, permission: { select: { code: true } } },
    });
    const beforeCodes = before.map((rp) => rp.permission.code).sort();
    const desiredIds = new Set(permissions.map((p) => p.id));
    const existingIds = new Set(before.map((rp) => rp.permissionId));

    const toDelete = before.filter((rp) => !desiredIds.has(rp.permissionId)).map((rp) => rp.id);
    const toCreate = permissions.filter((p) => !existingIds.has(p.id)).map((p) => p.id);

    await this.prisma.$transaction(async (tx) => {
      if (toDelete.length > 0) {
        await tx.rolePermission.deleteMany({ where: { id: { in: toDelete } } });
      }
      if (toCreate.length > 0) {
        await tx.rolePermission.createMany({
          data: toCreate.map((permissionId) => ({
            roleId: role.id,
            permissionId,
            granted: true,
          })),
          skipDuplicates: true,
        });
      }
      await tx.permissionChangeLog.create({
        data: {
          companyId: actor.companyId,
          targetUserId: actor.id,
          changedByUserId: actor.id,
          changeType: PermissionChangeType.ROLE_PERMISSIONS_CHANGED,
          roleId: role.id,
          previousState: { codes: beforeCodes } as Prisma.InputJsonValue,
          newState: { codes: [...dto.codes].sort() } as Prisma.InputJsonValue,
        },
      });
    });

    // Invalidação ativa: todos os usuários do perfil (e descendentes)
    await this.permissionService.invalidateRole(role.id);

    await this.auditService.logWithDiff(
      { permissionCodes: beforeCodes },
      { permissionCodes: [...dto.codes].sort() },
      {
        companyId: actor.companyId,
        userId: actor.id,
        entity: 'Role',
        entityId: role.id,
        action: AuditAction.UPDATE,
        module: 'iam',
      },
    );

    return this.getRolePermissions(actor.companyId, role.id);
  }

  // ─── Internos ──────────────────────────────────────────────────────────────

  /** Perfil visível à empresa (system ou custom da própria empresa) ou 404. */
  private async findVisibleRole(companyId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, OR: [{ isSystem: true }, { companyId }] },
    });
    if (!role) {
      throw new NotFoundException('Perfil não encontrado.');
    }
    return role;
  }

  private assertNotSystem(role: { isSystem: boolean; name: string }, verbo: string) {
    if (role.isSystem) {
      throw new ForbiddenException(
        `O perfil '${role.name}' é um perfil de sistema e não pode ser alterado: ` +
          `a fonte da verdade dele é o catálogo versionado em código (roles.catalog.ts). ` +
          `Para ${verbo} um perfil com base neste, DUPLIQUE-O como perfil personalizado.`,
      );
    }
  }
}
