import { Injectable, Logger } from '@nestjs/common';
import { PermissionService } from './permission.service';

/**
 * ShadowModeService — Fase M2 da migração IAM v2 (issue #340).
 *
 * "O motor entra em produção em shadow mode: em cada request, o RolesGuard
 * decide (comportamento atual), e o PermissionService calcula em paralelo e
 * loga divergências sem bloquear ninguém." (ARQUITETURA-IAM-V2.md, Fase M2)
 *
 * GARANTIAS:
 *  - NUNCA lança: qualquer erro vira outcome ERROR + log. Um bug aqui não
 *    pode derrubar um request de produção.
 *  - NUNCA bloqueia: este serviço não devolve 403 nem altera a decisão do
 *    fluxo legado. O enforcement é o PermissionGuard da issue #341 (Onda B).
 *
 * REGISTRO: divergências saem como LOG ESTRUTURADO (JSON em uma linha,
 * `event: "iam_shadow_divergence"`), fácil de filtrar/agregar nos logs do
 * Railway durante a semana de sombra. Não gravamos em SecurityEvent porque
 * o enum SecurityEventType (#462) não tem um tipo para isso — divergência de
 * shadow mode é telemetria de migração, não evento de segurança do usuário
 * (os tipos existentes, ex. SUSPICIOUS_ACTIVITY, significariam outra coisa).
 *
 * Quem chama: o futuro PermissionGuard (#341) em modo sombra — ele extrai a
 * metadata @Roles do handler e o code de permissão v2 equivalente e delega
 * a comparação para cá. Até lá, o serviço é acionável em testes/manual.
 */

export interface ShadowComparisonInput {
  userId: string;
  companyId: string;
  /** Valor do enum legado no token (req.user.role), ex.: 'MANAGER'. */
  enumRole: string | null | undefined;
  /**
   * Metadata @Roles do handler (comportamento atual do RolesGuard).
   * `null`/`undefined`/[] = handler sem restrição de role → legado PERMITE.
   */
  requiredRoles?: string[] | null;
  /**
   * Permissão(ões) v2 equivalente(s) ao endpoint (basta UMA — semântica
   * hasAnyPermission, igual ao futuro @RequirePermission). Sem codes
   * mapeados ainda → comparação é pulada (SKIPPED).
   */
  permissionCodes?: string[] | null;
  /** Contexto para o log (ex.: 'POST /sales'). */
  endpoint?: string;
  method?: string;
}

export type ShadowOutcome = 'MATCH' | 'DIVERGENCE' | 'SKIPPED' | 'ERROR';

export interface ShadowComparisonResult {
  outcome: ShadowOutcome;
  /** O que o comportamento @Roles atual decide. */
  legacyAllowed?: boolean;
  /** O que o RBAC v2 decidiria. */
  v2Allowed?: boolean;
}

@Injectable()
export class ShadowModeService {
  private readonly logger = new Logger(ShadowModeService.name);

  constructor(private readonly permissionService: PermissionService) {}

  /**
   * Compara a decisão do fluxo legado (@Roles + enum) com a decisão RBAC v2
   * e loga divergências. Nunca lança; nunca bloqueia.
   */
  async compare(input: ShadowComparisonInput): Promise<ShadowComparisonResult> {
    try {
      // Réplica exata do RolesGuard atual: sem @Roles = liberado;
      // com @Roles = o enum do user precisa estar na lista.
      const legacyAllowed =
        !input.requiredRoles ||
        input.requiredRoles.length === 0 ||
        (!!input.enumRole && input.requiredRoles.includes(input.enumRole));

      if (!input.permissionCodes || input.permissionCodes.length === 0) {
        // Endpoint ainda sem permissão v2 mapeada — nada a comparar.
        return { outcome: 'SKIPPED', legacyAllowed };
      }

      const v2Allowed = await this.permissionService.hasAnyPermission(
        input.userId,
        input.companyId,
        input.permissionCodes,
      );

      if (legacyAllowed === v2Allowed) {
        return { outcome: 'MATCH', legacyAllowed, v2Allowed };
      }

      this.logger.warn(
        JSON.stringify({
          event: 'iam_shadow_divergence',
          userId: input.userId,
          companyId: input.companyId,
          enumRole: input.enumRole ?? null,
          requiredRoles: input.requiredRoles ?? null,
          permissionCodes: input.permissionCodes,
          endpoint: input.endpoint ?? null,
          method: input.method ?? null,
          legacyAllowed,
          v2Allowed,
        }),
      );
      return { outcome: 'DIVERGENCE', legacyAllowed, v2Allowed };
    } catch (err) {
      // Shadow mode jamais pode quebrar o request que está observando.
      this.logger.error(
        `Erro no shadow mode (ignorado, request segue normal): ${(err as Error).message}`,
      );
      return { outcome: 'ERROR' };
    }
  }
}
