import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRE_ENTITLEMENT_KEY } from '../decorators/require-entitlement.decorator';
import { EntitlementService } from '../../modules/entitlement/entitlement.service';
import { entitlementDef } from '../../modules/entitlement/entitlements.catalog';

/**
 * EntitlementGuard — OPS WP4 (#911): enforcement do que a CONTA contratou.
 *
 * Posição na cadeia global (app.module.ts):
 *   JwtAuthGuard → CompanyGuard → PermissionGuard →
 *   EntitlementGuard → AdaptiveThrottlerGuard
 *
 * DEPOIS do PermissionGuard de propósito: primeiro "este usuário pode?",
 * depois "esta conta contratou?" — a mensagem de 403 diferencia os dois
 * (permissão → fale com o admin; entitlement → fale com a Avecchi/upgrade).
 *
 * Semântica: sem metadata → libera (igual aos demais); @Public → libera
 * (webhooks de conector chegam sem usuário). Fail-closed em erro de infra,
 * mesmo racional do PermissionGuard.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  private readonly logger = new Logger(EntitlementGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly entitlementService: EntitlementService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_ENTITLEMENT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user?.companyId) {
      throw new ForbiddenException(
        'Não foi possível identificar a conta para a verificação de contratação.',
      );
    }

    for (const key of required) {
      let enabled: boolean;
      try {
        enabled = await this.entitlementService.can(user.companyId, key);
      } catch (error) {
        this.logger.error(
          JSON.stringify({
            event: 'entitlement_guard_error',
            companyId: user.companyId,
            key,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        throw new ForbiddenException(
          'Não foi possível verificar os módulos contratados no momento. Tente novamente em instantes.',
        );
      }
      if (!enabled) {
        const name = entitlementDef(key)?.name ?? key;
        throw new ForbiddenException(
          `O módulo "${name}" não faz parte do plano contratado pela sua empresa. ` +
            'Fale com a Avecchi para incluir.',
        );
      }
    }
    return true;
  }
}
