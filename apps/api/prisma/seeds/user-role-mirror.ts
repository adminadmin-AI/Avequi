/**
 * Perfis SYSTEM + espelhamento User.role (enum legado) → UserRoleAssignment (RBAC v2).
 *
 * Fonte única de duas regras usadas por dois seeds:
 *
 * 1. O que é "perfil system": SOMENTE `companyId = null` + `isSystem = true` +
 *    `code` no catálogo. O schema permite que uma empresa tenha um Role CUSTOM
 *    com o MESMO code de um perfil system (@@unique([companyId, code])); esse
 *    custom nunca pode ser confundido com o system. A resolução é validada:
 *    code duplicado entre systems (ambíguo) ou code esperado ausente → erro.
 *
 * 2. Espelhamento enum → atribuição v2:
 *    - `iam.seed.ts` (estrutural): TODOS os usuários, pulando quem não tem
 *      mapeamento (comportamento original da Fase M1);
 *    - `demo.seed.ts`: SOMENTE os usuários demo recém-criados, usando os perfis
 *      system que o seed estrutural já criou — e falha se eles não existirem.
 *
 * Idempotente: só cria a atribuição que falta; nunca remove nada.
 */
import type { PrismaClient } from '@prisma/client';
import { ENUM_ROLE_TO_SYSTEM_ROLE, SYSTEM_ROLES } from '../../src/modules/iam/roles.catalog';

/** Marcador gravado em UserRoleAssignment.grantedBy para atribuições do seed */
export const SEED_GRANTED_BY = 'SEED_IAM_F2';

export interface SystemRoleRow {
  id: string;
  code: string;
  parentId: string | null;
}

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
 * Lê os perfis SYSTEM globais existentes. Só leitura: nunca cria nem reconcilia
 * catálogo — isso é do seed estrutural. Filtro completo (companyId null +
 * isSystem) para nunca trazer Role custom de empresa com o mesmo code.
 */
export async function loadSystemRoles(
  prisma: PrismaClient,
  codes: ReadonlyArray<string> = SYSTEM_ROLES.map((r) => r.code),
): Promise<SystemRoleRow[]> {
  const rows = await prisma.role.findMany({
    where: { code: { in: [...codes] }, companyId: null, isSystem: true },
    select: { id: true, code: true, parentId: true },
  });
  return rows.map((r) => ({ id: r.id, code: r.code, parentId: r.parentId ?? null }));
}

/**
 * Indexa perfis system por code SEM depender da ordem do banco: code repetido
 * entre systems globais é ambíguo e falha.
 */
export function indexSystemRolesByCode(rows: ReadonlyArray<SystemRoleRow>): Map<string, SystemRoleRow> {
  const byCode = new Map<string, SystemRoleRow>();
  const duplicated = new Set<string>();
  for (const row of rows) {
    if (byCode.has(row.code)) duplicated.add(row.code);
    else byCode.set(row.code, row);
  }
  if (duplicated.size > 0) {
    throw new Error(
      `IAM seed: perfil system ambíguo — mais de um Role global (companyId=null, isSystem=true) com o code: ${[...duplicated].join(', ')}. ` +
        'Corrija o catálogo no banco antes de reconciliar.',
    );
  }
  return byCode;
}

/** Garante que todo code esperado resolveu para exatamente um perfil system. */
export function assertSystemRolesComplete(byCode: ReadonlyMap<string, SystemRoleRow>, expectedCodes: ReadonlyArray<string>): void {
  const missing = expectedCodes.filter((code) => !byCode.has(code));
  if (missing.length > 0) {
    throw new Error(`IAM seed: perfis system ausentes após criação: ${missing.join(', ')}.`);
  }
}

/** Mapa code → id dos perfis system (validado contra ambiguidade; pode vir incompleto). */
export async function loadSystemRoleIdsByCode(
  prisma: PrismaClient,
  codes: ReadonlyArray<string> = SYSTEM_ROLES.map((r) => r.code),
): Promise<Map<string, string>> {
  const byCode = indexSystemRolesByCode(await loadSystemRoles(prisma, codes));
  return new Map([...byCode].map(([code, row]) => [code, row.id]));
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
