import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Simulação de conjunto efetivo de permissões — issue #352 (IAM F7.2).
 *
 * Guarda de sanidade ANTI-AUTO-LOCKOUT: antes de aplicar uma mutação de
 * acesso, simulamos o conjunto efetivo do usuário COMO SE a mudança já
 * tivesse sido aplicada e verificamos se ele continua com acesso à gestão
 * de perfis (iam.roles.manage / iam.roles.assign). A resolução replica a
 * semântica do PermissionService.resolveFromDatabase (herança N níveis,
 * deny de perfil vence grant de perfil, exceções individuais por cima),
 * mas com "modificações hipotéticas" aplicadas em memória.
 *
 * NÃO usa cache: a pergunta é sobre um estado que ainda não existe.
 */

/** Permissão que define o acesso à gestão de perfis (tela #352). */
export const ROLES_ADMIN_PERMISSION = 'iam.roles.manage';
/** Permissão que define o acesso à atribuição de perfis/exceções. */
export const ROLES_ASSIGN_PERMISSION = 'iam.roles.assign';

/** Limite defensivo (mesmo racional do PermissionService). */
const MAX_INHERITANCE_DEPTH = 20;

export interface SimulationMods {
  /** Simula a REMOÇÃO da atribuição do perfil (DELETE /iam/users/:id/roles/:roleId). */
  excludeAssignmentRoleId?: string;
  /** Simula a REMOÇÃO de uma exceção individual (DELETE /iam/users/:id/permissions/:id). */
  excludeUserPermissionId?: string;
  /** Simula a CRIAÇÃO de denies individuais (POST granted=false). */
  addUserDenyCodes?: string[];
  /** Simula a SUBSTITUIÇÃO do conjunto de permissões de um perfil (PUT /iam/roles/:id/permissions). */
  replaceRolePermissions?: { roleId: string; codes: string[] };
}

/**
 * Resolve o conjunto efetivo de permissões de (userId, companyId) com as
 * modificações hipotéticas aplicadas. Retorna o Set de codes efetivos.
 */
export async function simulateEffectivePermissions(
  prisma: PrismaService,
  userId: string,
  companyId: string,
  mods: SimulationMods = {},
): Promise<Set<string>> {
  const now = new Date();
  const notExpired = { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };

  // 1. Atribuições vigentes (menos a que está sendo removida na simulação)
  const assignments = await prisma.userRoleAssignment.findMany({
    where: { userId, companyId, ...notExpired, role: { isActive: true } },
    select: { roleId: true },
  });
  const initialRoleIds = [
    ...new Set(
      assignments
        .map((a) => a.roleId)
        .filter((id) => id !== mods.excludeAssignmentRoleId),
    ),
  ];

  // 2. Cadeia de herança (BFS com defesa a ciclo)
  const visited = new Set<string>();
  const roleGrants = new Set<string>();
  const roleDenies = new Set<string>();
  let frontier = initialRoleIds;
  let depth = 0;

  while (frontier.length > 0 && depth < MAX_INHERITANCE_DEPTH) {
    depth += 1;
    frontier.forEach((id) => visited.add(id));

    const roles = await prisma.role.findMany({
      where: { id: { in: frontier }, isActive: true },
      select: {
        id: true,
        parentId: true,
        rolePermissions: {
          select: { granted: true, permission: { select: { code: true } } },
        },
      },
    });

    for (const role of roles) {
      if (mods.replaceRolePermissions && role.id === mods.replaceRolePermissions.roleId) {
        // Estado hipotético: o perfil passa a ter EXATAMENTE estes codes (grants)
        for (const code of mods.replaceRolePermissions.codes) roleGrants.add(code);
      } else {
        for (const rp of role.rolePermissions) {
          if (rp.granted) roleGrants.add(rp.permission.code);
          else roleDenies.add(rp.permission.code);
        }
      }
    }

    frontier = [
      ...new Set(
        roles
          .map((r) => r.parentId)
          .filter((id): id is string => id !== null && !visited.has(id)),
      ),
    ];
  }

  // 3. Exceções individuais vigentes (menos a removida; mais os denies hipotéticos)
  const userPerms = await prisma.userPermission.findMany({
    where: { userId, companyId, ...notExpired },
    select: { id: true, granted: true, permission: { select: { code: true } } },
  });
  const effectiveUserPerms = userPerms.filter(
    (up) => up.id !== mods.excludeUserPermissionId,
  );

  // efetivo = ((grantsPerfis − denysPerfis) ∪ grantsUsuario) − denysUsuario
  const effective = new Set<string>();
  for (const code of roleGrants) {
    if (!roleDenies.has(code)) effective.add(code);
  }
  for (const up of effectiveUserPerms) {
    if (up.granted) effective.add(up.permission.code);
  }
  for (const up of effectiveUserPerms) {
    if (!up.granted) effective.delete(up.permission.code);
  }
  for (const code of mods.addUserDenyCodes ?? []) {
    effective.delete(code);
  }

  return effective;
}

/**
 * A mudança simulada deixaria o usuário SEM acesso à gestão de perfis?
 * (Perde iam.roles.manage E iam.roles.assign = trancado para fora da tela.)
 */
export async function wouldLockOutOfRolesAdmin(
  prisma: PrismaService,
  userId: string,
  companyId: string,
  mods: SimulationMods,
): Promise<boolean> {
  const effective = await simulateEffectivePermissions(prisma, userId, companyId, mods);
  return (
    !effective.has(ROLES_ADMIN_PERMISSION) && !effective.has(ROLES_ASSIGN_PERMISSION)
  );
}
