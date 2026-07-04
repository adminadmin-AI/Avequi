import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import {
  PermissionService,
  permissionMatches,
} from '../../modules/iam/permission.service';

/**
 * PermissionGuard — enforcement do RBAC granular do IAM v2.
 * Issue #341 (Fase F5.1/M3 — parte 1: guard completo, aplicado só no módulo IAM).
 *
 * ── Posição na cadeia de guards globais (app.module.ts) ─────────────────────
 *   JwtAuthGuard → CompanyGuard → RolesGuard → PermissionGuard → ThrottlerGuard
 *
 * O RolesGuard (enum legado) decide ANTES e não foi tocado: um endpoint pode
 * ter @Roles e @RequirePermission ao mesmo tempo — @Roles corta primeiro,
 * @RequirePermission refina com o RBAC v2. Endpoint só com @Roles (sem
 * @RequirePermission) → este guard LIBERA sem consultar nada (o shadow mode
 * do PermissionService continua sendo o mecanismo de comparação da migração).
 *
 * ── Semântica de decisão ────────────────────────────────────────────────────
 *  1. @Public (handler ou classe)             → libera (login, refresh, etc.)
 *  2. Sem metadata @RequirePermission         → libera (igual ao RolesGuard:
 *     ausência de exigência não é exigência)
 *  3. Com metadata → resolve o conjunto efetivo via PermissionService
 *     (cache Redis TTL 5 min; miss/Redis fora → fallback no banco) e exige
 *     TODAS as permissões listadas (AND). Faltou qualquer uma → 403 com
 *     mensagem em pt-BR dizendo QUAIS faltaram.
 *
 * ── Fail-closed (segurança acima de disponibilidade) ────────────────────────
 * Se a resolução de permissões FALHAR (Redis fora é transparente — o service
 * cai para o banco; mas banco fora / erro inesperado chega aqui), o guard NÃO
 * libera: loga JSON estruturado (`event: "iam_permission_guard_error"`) e
 * responde 403 genérico. Racional: uma rota decorada com @RequirePermission é
 * declaradamente sensível — indisponibilidade momentânea é preferível a uma
 * janela de bypass durante um incidente de infraestrutura.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    // Fail-closed: sem identidade resolvida não há como autorizar. Na prática
    // o JwtAuthGuard e o CompanyGuard já barraram antes; isto é defesa em
    // profundidade contra reordenação acidental da cadeia de guards.
    if (!user?.id || !user?.companyId) {
      throw new ForbiddenException(
        'Não foi possível identificar o usuário para a verificação de permissões.',
      );
    }

    let effective: Set<string>;
    try {
      const { permissions } = await this.permissionService.getUserPermissions(
        user.id,
        user.companyId,
      );
      effective = new Set(permissions);
    } catch (error) {
      // Fail-closed: erro de infraestrutura NUNCA vira liberação.
      this.logger.error(
        JSON.stringify({
          event: 'iam_permission_guard_error',
          userId: user.id,
          companyId: user.companyId,
          required,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      throw new ForbiddenException(
        'Não foi possível verificar suas permissões no momento. ' +
          'Tente novamente em instantes; se persistir, contate o administrador.',
      );
    }

    const missing = required.filter((code) => !permissionMatches(effective, code));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Você não tem permissão para executar esta ação. ` +
          `Permissão(ões) necessária(s): ${missing.join(', ')}. ` +
          'Solicite o acesso ao administrador do sistema.',
      );
    }

    return true;
  }
}
