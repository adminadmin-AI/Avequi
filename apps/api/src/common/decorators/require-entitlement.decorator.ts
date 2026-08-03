import { SetMetadata } from '@nestjs/common';
import { ENTITLEMENT_KEYS } from '../../modules/entitlement/entitlements.catalog';

/**
 * @RequireEntitlement — OPS WP4 (#911): gate por CONTA (o que o tenant
 * contratou), avaliado pelo EntitlementGuard global DEPOIS do PermissionGuard.
 * Semântica AND, mesmo desenho do @RequirePermission — e mesmo fail-fast:
 * key fora do catálogo derruba o boot (typo nunca chega em produção).
 *
 * Uso típico em CLASSE de controller de módulo comercial:
 *   @RequireEntitlement('crm')
 *   export class CrmController { ... }
 */

export const REQUIRE_ENTITLEMENT_KEY = 'requireEntitlements';

export function assertCatalogEntitlementKeys(keys: string[]): void {
  if (keys.length === 0) {
    throw new Error('@RequireEntitlement exige pelo menos uma key do catálogo');
  }
  for (const key of keys) {
    if (!ENTITLEMENT_KEYS.has(key)) {
      throw new Error(
        `@RequireEntitlement: key '${key}' não existe no catálogo ` +
          '(apps/api/src/modules/entitlement/entitlements.catalog.ts).',
      );
    }
  }
}

export const RequireEntitlement = (...keys: string[]) => {
  assertCatalogEntitlementKeys(keys);
  return SetMetadata(REQUIRE_ENTITLEMENT_KEY, keys);
};
