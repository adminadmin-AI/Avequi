/**
 * Espelhamento User.role (enum legado) → UserRoleAssignment (RBAC v2).
 *
 * Fonte única da regra usada por dois seeds:
 * - `iam.seed.ts` (estrutural): espelha TODOS os usuários existentes, pulando
 *   quem não tem mapeamento (comportamento original da Fase M1).
 * - `demo.seed.ts`: espelha SOMENTE os usuários demo recém-criados, usando os
 *   perfis system que o seed estrutural já criou — e falha se eles não existirem.
 *
 * Idempotente: só cria a atribuição que falta; nunca remove nada.
 */
import type { PrismaClient } from '@prisma/client';
import { ENUM_ROLE_TO_SYSTEM_ROLE, SYSTEM_ROLES } from '../../src/modules/iam/roles.catalog';

/** Marcador gravado em UserRoleAssignment.grantedBy para atribuições do seed */
export const SEED_GRANTED_BY = 'SEED_IAM_F2';

export interface MirrorableUser {
  id: string;
  role: string;
  companyId: string | null;
}

export interface MirrorSummary {
  created: number;
  skipped: number;
}

export interface MirrorOptions {
  /** 'skip' (padrão): avisa e pula usuário sem mapeamento; 'throw': falha. */
  onUnmapped?: 'skip' | 'throw';
}

/** Código do perfil system equivalente a um valor do enum legado. */
export function systemRoleCodeFor(enumRole: string): string | undefined {
  return ENUM_ROLE_TO_SYSTEM_ROLE[enumRole];
}

/**
 * Lê os perfis SYSTEM globais (companyId = null) já existentes no banco.
 * Só leitura: nunca cria nem reconcilia catálogo — isso é do seed estrutural.
 */
export async function loadSystemRoleIdsByCode(
  prisma: PrismaClient,
  codes: ReadonlyArray<string> = SYSTEM_ROLES.map((r) => r.code),
): Promise<Map<string, string>> {
  const rows = await prisma.role.findMany({
    where: { code: { in: [...codes] }, companyId: null, isSystem: true },
    select: { id: true, code: true },
  });
  return new Map(rows.map((r) => [r.code, r.id]));
}

export async function mirrorEnumRolesToAssignments(
  prisma: PrismaClient,
  users: ReadonlyArray<MirrorableUser>,
  roleIdByCode: ReadonlyMap<string, string>,
  opts: MirrorOptions = {},
): Promise<MirrorSummary> {
  const onUnmapped = opts.onUnmapped ?? 'skip';
  const summary: MirrorSummary = { created: 0, skipped: 0 };

  for (const user of users) {
    const roleCode = systemRoleCodeFor(String(user.role));
    const roleId = roleCode ? roleIdByCode.get(roleCode) : undefined;
    if (!roleId || !user.companyId) {
      const msg = `IAM seed: usuário ${user.id} sem mapeamento (role=${user.role}) — pulado`;
      if (onUnmapped === 'throw') {
        throw new Error(msg.replace(' — pulado', ''));
      }
      summary.skipped++;
      console.warn(`⚠️  ${msg}`);
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
      summary.created++;
    }
  }

  return summary;
}
