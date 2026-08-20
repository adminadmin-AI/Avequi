import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, AuditAction, PermissionChangeType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from './audit.service';
import {
  LastAdminInvariantService,
  TEMP_ADMIN_ERROR_MESSAGE,
} from './last-admin-invariant.service';
import {
  LegacyRoleMirrorService,
  ResultadoEspelho,
} from './legacy-role-mirror.service';
import { PermissionService } from './permission.service';
import { TenantScopeService } from './tenant-scope.service';
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
    private readonly lastAdmin: LastAdminInvariantService,
    private readonly legacyMirror: LegacyRoleMirrorService,
    private readonly tenantScope: TenantScopeService,
  ) {}

  // ─── Perfis do usuário ─────────────────────────────────────────────────────

  async listUserRoles(actor: Actor, userId: string) {
    // #1107: o alvo pode estar numa filial da árvore. Os vínculos a listar
    // são os da empresa DELE, não a de quem consulta.
    const target = await this.findTargetUser(actor, userId);
    const companyId = target.companyId;
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
    const target = await this.findTargetUser(actor, userId);
    // #1107: empresa REAL do usuário administrado — pode ser uma filial.
    const alvoCompanyId = target.companyId;

    const role = await this.prisma.role.findFirst({
      where: {
        id: dto.roleId,
        isActive: true,
        OR: [{ isSystem: true }, { companyId: alvoCompanyId }],
      },
      select: { id: true, code: true, name: true },
    });
    if (!role) {
      throw new NotFoundException('Perfil não encontrado ou inativo.');
    }

    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, companyId: alvoCompanyId },
        select: { id: true },
      });
      if (!branch) throw new NotFoundException('Filial não encontrada.');
    }

    const existing = await this.prisma.userRoleAssignment.findUnique({
      where: {
        userId_roleId_companyId: {
          userId: target.id,
          roleId: role.id,
          companyId: alvoCompanyId,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        `O usuário já possui o perfil '${role.name}' nesta empresa.`,
      );
    }

    // #946: o espelho legado é recalculado DENTRO da mesma transação do
    // assignment — enum e perfis nunca ficam fora de sincronia por falha
    // parcial. O resultado sai daqui para auditoria e para a resposta da UI.
    let espelho: ResultadoEspelho | undefined;

    const criarAssignment = async (tx: Prisma.TransactionClient) => {
      const created = await tx.userRoleAssignment.create({
        data: {
          userId: target.id,
          roleId: role.id,
          companyId: alvoCompanyId,
          branchId: dto.branchId ?? null,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          grantedBy: actor.id,
        },
      });
      espelho = await this.legacyMirror.sincronizarNaTransacao(tx, target.id);
      await tx.permissionChangeLog.create({
        data: {
          companyId: alvoCompanyId,
          targetUserId: target.id,
          changedByUserId: actor.id,
          changeType: PermissionChangeType.ROLE_ASSIGNED,
          roleId: role.id,
          newState: {
            roleCode: role.code,
            branchId: dto.branchId ?? null,
            expiresAt: dto.expiresAt ?? null,
            legacyRole: espelhoParaAuditoria(espelho),
          },
        },
      });
      return created;
    };

    // #752 (decisão Rafael 03/08/2026): ADMIN_GLOBAL TEMPORÁRIO só existe com
    // lastro — o grupo precisa já ter um administrador PERPÉTUO. Sem isso, um
    // grupo poderia ser "resolvido" com um admin que expira, ficando sem
    // administração no vencimento (não há job de expiração). A checagem lê o
    // estado do grupo, então roda DENTRO do mesmo lock: entre contar e criar,
    // nenhuma outra operação do grupo tira o perpétuo do caminho.
    const assignment =
      role.code === 'ADMIN_GLOBAL' && dto.expiresAt
        ? await this.lastAdmin.executarProtegido(alvoCompanyId, async (tx, ctx) => {
            if (ctx.adminsPerpetuosAntes === 0) {
              throw new BadRequestException(TEMP_ADMIN_ERROR_MESSAGE);
            }
            return criarAssignment(tx);
          })
        : await this.prisma.$transaction(criarAssignment);

    await this.permissionService.invalidateUser(target.id, alvoCompanyId);
    const sessoesRevogadas = await this.legacyMirror.revogarSessoesSeMudou(
      espelho!,
      target.id,
    );

    await this.auditService.logWithDiff(null, assignment, {
      // AuditLog fica no contexto de quem EXECUTOU (#1107, decisão do Rafael):
      // é o registro da ação do administrador. A tela de auditoria é escopada
      // pelo companyId do JWT — mover para o alvo sumiria com a própria ação.
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'UserRoleAssignment',
      entityId: assignment.id,
      action: AuditAction.CREATE,
      module: 'iam',
    });

    return { ...assignment, legacyRole: { ...espelho!, sessoesRevogadas } };
  }

  async removeRole(actor: Actor, userId: string, roleId: string) {
    const target = await this.findTargetUser(actor, userId);
    // #1107: empresa REAL do usuário administrado — pode ser uma filial.
    const alvoCompanyId = target.companyId;

    const assignment = await this.prisma.userRoleAssignment.findUnique({
      where: {
        userId_roleId_companyId: {
          userId: target.id,
          roleId,
          companyId: alvoCompanyId,
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

    let espelho: ResultadoEspelho | undefined;

    const removerAssignment = async (tx: Prisma.TransactionClient) => {
      await tx.userRoleAssignment.delete({ where: { id: assignment.id } });
      // #946: espelho recalculado na MESMA transação da remoção.
      espelho = await this.legacyMirror.sincronizarNaTransacao(tx, target.id);
      await tx.permissionChangeLog.create({
        data: {
          companyId: alvoCompanyId,
          targetUserId: target.id,
          changedByUserId: actor.id,
          changeType: PermissionChangeType.ROLE_REMOVED,
          roleId,
          previousState: {
            roleCode: assignment.role.code,
            branchId: assignment.branchId,
            expiresAt: assignment.expiresAt?.toISOString() ?? null,
            legacyRole: espelhoParaAuditoria(espelho),
          },
        },
      });
    };
    // #752: remover um vínculo ADMIN_GLOBAL passa pelo mecanismo central —
    // lock do grupo + invariante validada na MESMA transação (nunca deixa o
    // grupo sem administrador global, nem em remoções concorrentes).
    if (assignment.role.code === 'ADMIN_GLOBAL') {
      await this.lastAdmin.executarProtegido(alvoCompanyId, removerAssignment);
    } else {
      await this.prisma.$transaction(removerAssignment);
    }

    await this.permissionService.invalidateUser(target.id, alvoCompanyId);
    const sessoesRevogadas = await this.legacyMirror.revogarSessoesSeMudou(
      espelho!,
      target.id,
    );

    await this.auditService.logWithDiff(assignment, null, {
      // AuditLog fica no contexto de quem EXECUTOU (#1107, decisão do Rafael):
      // é o registro da ação do administrador. A tela de auditoria é escopada
      // pelo companyId do JWT — mover para o alvo sumiria com a própria ação.
      companyId: actor.companyId,
      userId: actor.id,
      entity: 'UserRoleAssignment',
      entityId: assignment.id,
      action: AuditAction.DELETE,
      module: 'iam',
    });

    return { removed: true, legacyRole: { ...espelho!, sessoesRevogadas } };
  }

  // ─── Exceções individuais (grants/denies) ──────────────────────────────────

  async listUserPermissions(actor: Actor, userId: string) {
    // #1107: mesma razão do listUserRoles — escopo do ALVO.
    const target = await this.findTargetUser(actor, userId);
    const companyId = target.companyId;
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
    const target = await this.findTargetUser(actor, userId);
    // #1107: empresa REAL do usuário administrado — pode ser uma filial.
    const alvoCompanyId = target.companyId;
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
      // Sanidade 1: deny individual não pode trancar um administrador global
      // fora da gestão. #752: além do enum legado SUPER_ADMIN, cobre quem é
      // ADMIN_GLOBAL efetivo no RBAC v2 (o deny individual vence o grant de
      // perfil — sem esta guarda, negar iam.roles.* ao último admin o
      // deixaria incapaz de administrar, com o vínculo ainda de pé).
      if (target.role === 'SUPER_ADMIN' || (await this.lastAdmin.ehAdminGlobalEfetivo(target.id))) {
        throw new BadRequestException(
          'Não é permitido negar permissões de gestão de perfis (iam.roles.*) a um ' +
            'administrador global — isso o trancaria para fora da própria gestão.',
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
          companyId: alvoCompanyId,
        },
      },
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const upserted = await tx.userPermission.upsert({
        where: {
          userId_permissionId_companyId: {
            userId: target.id,
            permissionId: permission.id,
            companyId: alvoCompanyId,
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
          companyId: alvoCompanyId,
          granted,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          reason: dto.reason ?? null,
          grantedBy: actor.id,
        },
      });
      await tx.permissionChangeLog.create({
        data: {
          companyId: alvoCompanyId,
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

    await this.permissionService.invalidateUser(target.id, alvoCompanyId);

    await this.auditService.logWithDiff(before, result, {
      // AuditLog fica no contexto de quem EXECUTOU (#1107, decisão do Rafael):
      // é o registro da ação do administrador. A tela de auditoria é escopada
      // pelo companyId do JWT — mover para o alvo sumiria com a própria ação.
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
    const target = await this.findTargetUser(actor, userId);
    // #1107: empresa REAL do usuário administrado — pode ser uma filial.
    const alvoCompanyId = target.companyId;

    const exception = await this.prisma.userPermission.findFirst({
      where: { id: userPermissionId, userId: target.id, companyId: alvoCompanyId },
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
          companyId: alvoCompanyId,
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

    await this.permissionService.invalidateUser(target.id, alvoCompanyId);

    await this.auditService.logWithDiff(exception, null, {
      // AuditLog fica no contexto de quem EXECUTOU (#1107, decisão do Rafael):
      // é o registro da ação do administrador. A tela de auditoria é escopada
      // pelo companyId do JWT — mover para o alvo sumiria com a própria ação.
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
  /**
   * O usuário-alvo, resolvido JÁ dentro do escopo empresarial do ator (#1107).
   *
   * O filtro de empresa vive DENTRO da consulta — não é "checa e depois
   * busca". `companyIds` vem do TenantScopeService e é sempre uma lista
   * fechada (fail-closed, guarda de ciclo, teto de profundidade, deny
   * individual vence). Sem a capability a lista é `[ator.companyId]`, o que
   * mantém o comportamento anterior intacto para quem não amplia.
   *
   * 404 com a MESMA mensagem de usuário inexistente (anti-enumeração).
   *
   * ⚠️ Devolve `companyId` — e ele NÃO é o do ator. Todo vínculo, chave,
   * log de mudança e invalidação de cache abaixo tem de usar ESTE valor:
   * gravar com `actor.companyId` criaria o registro na empresa errada, e no
   * caso do cache deixaria a permissão antiga viva por até 5 minutos.
   */
  private async findTargetUser(actor: Actor, userId: string) {
    const { companyIds } = await this.tenantScope.resolverEscopo(actor.id, actor.companyId);
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId: { in: companyIds } },
      select: { id: true, name: true, email: true, role: true, companyId: true },
    });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado nesta empresa.');
    }
    return user;
  }
}

/**
 * #946: recorte do espelho legado gravado no PermissionChangeLog. Guarda o
 * ANTES e o DEPOIS, o motivo quando não houve derivação e os perfis
 * resultantes — para a auditoria mostrar que o RBAC v2 é o acesso real mesmo
 * quando o enum ficou congelado. Campos JSON já existentes: sem migration.
 */
function espelhoParaAuditoria(espelho: ResultadoEspelho) {
  return {
    status: espelho.status,
    before: espelho.enumAnterior,
    after: espelho.enumResultante,
    ...(espelho.motivo ? { frozenReason: espelho.motivo } : {}),
    roles: espelho.perfis,
    source: 'RBAC_V2',
  };
}
