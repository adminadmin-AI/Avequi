/**
 * Seed do IAM v2 — issues #338 (permissões) + #339 (perfis) — Fase M1.
 *
 * IDEMPOTENTE: pode rodar quantas vezes for preciso, sem duplicar nada.
 * - Permissões: upsert por `code` (fonte: catálogo versionado em código).
 *   Permissões que existem no banco mas saíram do catálogo NÃO são apagadas
 *   (apenas avisadas) — migrations/limpeza são decisões separadas.
 * - Perfis system (isSystem=true): upsert por `code` e RECONCILIADOS com o
 *   catálogo (vínculos faltantes são criados, vínculos que não estão mais no
 *   catálogo são removidos DO PERFIL SYSTEM).
 * - Perfis customizados de empresa (companyId != null): NUNCA tocados.
 * - Espelhamento (migração gradual): cada usuário ganha um UserRoleAssignment
 *   para o perfil equivalente ao seu `User.role` (enum), que segue intocado
 *   como fallback. Atribuições extras feitas manualmente não são removidas.
 *
 * Execução: `npm run db:seed` (seed completo) ou `npm run db:seed:iam`.
 */

import type { PrismaClient } from '@prisma/client';
import { PERMISSIONS_CATALOG } from '../../src/modules/iam/permissions.catalog';
import {
  SYSTEM_ROLES,
  ENUM_ROLE_TO_SYSTEM_ROLE,
} from '../../src/modules/iam/roles.catalog';

/** Marcador gravado em UserRoleAssignment.grantedBy para atribuições do seed */
export const SEED_GRANTED_BY = 'SEED_IAM_F2';

export interface IamSeedSummary {
  permissionsUpserted: number;
  orphanPermissionCodes: string[];
  rolesUpserted: number;
  rolePermissionsCreated: number;
  rolePermissionsRemoved: number;
  userAssignmentsCreated: number;
  usersSkipped: number;
}

export async function seedIam(prisma: PrismaClient): Promise<IamSeedSummary> {
  const summary: IamSeedSummary = {
    permissionsUpserted: 0,
    orphanPermissionCodes: [],
    rolesUpserted: 0,
    rolePermissionsCreated: 0,
    rolePermissionsRemoved: 0,
    userAssignmentsCreated: 0,
    usersSkipped: 0,
  };

  // ── 1. Permissões: upsert por code ─────────────────────────────────────────
  for (const p of PERMISSIONS_CATALOG) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: {
        name: p.name,
        description: p.description ?? null,
        module: p.module,
        resource: p.resource,
        action: p.action,
      },
      create: {
        code: p.code,
        name: p.name,
        description: p.description ?? null,
        module: p.module,
        resource: p.resource,
        action: p.action,
      },
    });
    summary.permissionsUpserted++;
  }

  // Permissões órfãs (no banco, fora do catálogo): avisar, nunca apagar
  const catalogCodes = new Set(PERMISSIONS_CATALOG.map((p) => p.code));
  const dbPermissions = await prisma.permission.findMany({
    select: { id: true, code: true },
  });
  const permissionIdByCode = new Map(dbPermissions.map((p) => [p.code, p.id]));
  summary.orphanPermissionCodes = dbPermissions
    .filter((p) => !catalogCodes.has(p.code))
    .map((p) => p.code);
  if (summary.orphanPermissionCodes.length > 0) {
    console.warn(
      `⚠️  IAM seed: ${summary.orphanPermissionCodes.length} permissão(ões) no banco fora do catálogo (não removidas): ${summary.orphanPermissionCodes.join(', ')}`,
    );
  }

  // ── 2. Perfis system: upsert por code (passo 1 sem parent) ─────────────────
  for (const role of SYSTEM_ROLES) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: {
        name: role.name,
        description: role.description,
        isSystem: true,
        isActive: true,
        companyId: null,
      },
      create: {
        code: role.code,
        name: role.name,
        description: role.description,
        isSystem: true,
        isActive: true,
      },
    });
    summary.rolesUpserted++;
  }

  const dbRoles = await prisma.role.findMany({
    where: { code: { in: SYSTEM_ROLES.map((r) => r.code) } },
    select: { id: true, code: true, parentId: true },
  });
  const roleIdByCode = new Map(dbRoles.map((r) => [r.code, r.id]));

  // Passo 2: herança (parentId) — depois que todos os perfis existem
  for (const role of SYSTEM_ROLES) {
    const desiredParentId = role.parentCode
      ? roleIdByCode.get(role.parentCode) ?? null
      : null;
    const dbRole = dbRoles.find((r) => r.code === role.code)!;
    if (dbRole.parentId !== desiredParentId) {
      await prisma.role.update({
        where: { id: dbRole.id },
        data: { parentId: desiredParentId },
      });
    }
  }

  // ── 3. RolePermission: reconciliar SOMENTE os perfis system ────────────────
  for (const role of SYSTEM_ROLES) {
    const roleId = roleIdByCode.get(role.code)!;
    const desiredPermissionIds = new Set(
      role.permissions.map((code) => {
        const id = permissionIdByCode.get(code);
        if (!id) {
          throw new Error(
            `IAM seed: perfil '${role.code}' referencia permissão inexistente '${code}'`,
          );
        }
        return id;
      }),
    );

    const existing = await prisma.rolePermission.findMany({
      where: { roleId },
      select: { id: true, permissionId: true },
    });
    const existingIds = new Set(existing.map((rp) => rp.permissionId));

    const toCreate = [...desiredPermissionIds].filter((id) => !existingIds.has(id));
    if (toCreate.length > 0) {
      await prisma.rolePermission.createMany({
        data: toCreate.map((permissionId) => ({
          roleId,
          permissionId,
          granted: true,
        })),
        skipDuplicates: true,
      });
      summary.rolePermissionsCreated += toCreate.length;
    }

    // Reconciliação: vínculo que saiu do catálogo é removido do perfil SYSTEM.
    // (Perfis de empresa — companyId != null — nunca passam por aqui.)
    const staleIds = existing
      .filter((rp) => !desiredPermissionIds.has(rp.permissionId))
      .map((rp) => rp.id);
    if (staleIds.length > 0) {
      await prisma.rolePermission.deleteMany({ where: { id: { in: staleIds } } });
      summary.rolePermissionsRemoved += staleIds.length;
    }
  }

  // ── 4. Espelhamento: User.role (enum) → UserRoleAssignment ────────────────
  const users = await prisma.user.findMany({
    select: { id: true, role: true, companyId: true },
  });
  for (const user of users) {
    const roleCode = ENUM_ROLE_TO_SYSTEM_ROLE[user.role as string];
    const roleId = roleCode ? roleIdByCode.get(roleCode) : undefined;
    if (!roleId || !user.companyId) {
      summary.usersSkipped++;
      console.warn(
        `⚠️  IAM seed: usuário ${user.id} sem mapeamento (role=${user.role}) — pulado`,
      );
      continue;
    }
    const existing = await prisma.userRoleAssignment.findUnique({
      where: {
        userId_roleId_companyId: {
          userId: user.id,
          roleId,
          companyId: user.companyId,
        },
      },
    });
    if (!existing) {
      await prisma.userRoleAssignment.create({
        data: {
          userId: user.id,
          roleId,
          companyId: user.companyId,
          grantedBy: SEED_GRANTED_BY,
        },
      });
      summary.userAssignmentsCreated++;
    }
  }

  console.log(
    `✅ IAM seed: ${summary.permissionsUpserted} permissões · ${summary.rolesUpserted} perfis system · ` +
      `+${summary.rolePermissionsCreated}/-${summary.rolePermissionsRemoved} vínculos · ` +
      `${summary.userAssignmentsCreated} atribuições de usuário criadas`,
  );
  return summary;
}
