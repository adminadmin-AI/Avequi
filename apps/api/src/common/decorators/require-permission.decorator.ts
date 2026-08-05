import { SetMetadata } from '@nestjs/common';
import { PERMISSIONS_CATALOG } from '../../modules/iam/permissions.catalog';

/**
 * @RequirePermission — decorator de autorização granular do IAM v2.
 * Issue #341 (Fase F5.1/M3 — enforcement, parte 1).
 *
 * Marca um handler (ou controller inteiro) com os codes de permissão do
 * catálogo (`permissions.catalog.ts`) exigidos para acessar a rota. Quem lê
 * a metadata e decide é o PermissionGuard (common/guards/permission.guard.ts),
 * registrado como APP_GUARD global.
 *
 * ── Semântica: AND (exige TODAS) ────────────────────────────────────────────
 * `@RequirePermission('a.b.c', 'x.y.z')` = o usuário precisa ter TODAS as
 * permissões listadas. Para semântica OR ("qualquer uma"), crie no catálogo
 * uma permissão que represente a ação de fato — endpoints com OR genuíno são
 * quase sempre sinal de que a ação merece um code próprio.
 *
 * ── @Roles não existe mais como gate (#948-C1) ──────────────────────────────
 * O RolesGuard foi removido: o decorator @Roles ficou inerte e uma rota que
 * dependesse só dele estaria ABERTA. Este é o único jeito de gatear uma rota.
 *
 * ── Fail-fast contra typo ───────────────────────────────────────────────────
 * O decorator valida os codes contra o catálogo NO MOMENTO DA DECORAÇÃO
 * (import do controller = bootstrap da aplicação e carga dos testes). Um code
 * que não existe no catálogo derruba o boot com erro explícito — um typo
 * jamais chega em produção como rota silenciosamente inacessível.
 *
 * Wildcards (`sales.*`) são REJEITADOS aqui de propósito: enforcement de rota
 * deve ser explícito e auditável. Wildcard é conveniência de consulta do
 * PermissionService, não de declaração de requisito.
 */

export const REQUIRE_PERMISSION_KEY = 'requirePermissions';

/** Codes válidos do catálogo (fonte da verdade: permissions.catalog.ts). */
const CATALOG_CODES: ReadonlySet<string> = new Set(
  PERMISSIONS_CATALOG.map((p) => p.code),
);

/**
 * Valida uma lista de codes contra o catálogo. Lança Error (derruba o boot)
 * se algum code não existir, contiver wildcard ou a lista estiver vazia.
 * Exportada para os testes de fail-fast.
 */
export function assertCatalogPermissionCodes(codes: string[]): void {
  if (codes.length === 0) {
    throw new Error(
      '@RequirePermission exige pelo menos um code de permissão do catálogo',
    );
  }
  for (const code of codes) {
    if (typeof code !== 'string' || code.trim() === '') {
      throw new Error('@RequirePermission: code vazio ou inválido');
    }
    if (code.includes('*')) {
      throw new Error(
        `@RequirePermission: wildcard não é permitido em enforcement de rota ('${code}'). ` +
          'Use codes exatos do catálogo (permissions.catalog.ts).',
      );
    }
    if (!CATALOG_CODES.has(code)) {
      throw new Error(
        `@RequirePermission: code '${code}' não existe no catálogo de permissões ` +
          '(apps/api/src/modules/iam/permissions.catalog.ts). ' +
          'Confira o formato modulo.recurso.acao ou adicione o code ao catálogo no mesmo PR.',
      );
    }
  }
}

/**
 * Exige que o usuário tenha TODAS as permissões listadas (semântica AND).
 * Codes são validados contra o catálogo em tempo de decoração (fail-fast).
 */
export const RequirePermission = (...codes: string[]) => {
  assertCatalogPermissionCodes(codes);
  return SetMetadata(REQUIRE_PERMISSION_KEY, codes);
};
