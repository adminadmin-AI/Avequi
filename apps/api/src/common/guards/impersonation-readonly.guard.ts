import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/** Métodos que NÃO mutam estado — os únicos permitidos sob impersonation. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * ImpersonationReadonlyGuard — OPS WP6 (#913): impersonation é empréstimo de
 * VISÃO. Toda mutação (POST/PUT/PATCH/DELETE) sob um token de impersonation é
 * rejeitada AQUI, na API — esconder botão é UX, isto é o enforcement.
 *
 * Registrado como APP_GUARD global (depois do EntitlementGuard). Requests
 * sem contexto de impersonation (o caso normal) passam sem custo algum.
 * "Modo escrita com re-MFA" ficou DEFERIDO (épico #915) — quando vier, este
 * guard é o único lugar a evoluir.
 */
@Injectable()
export class ImpersonationReadonlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const impersonation = request.user?.impersonation;
    if (!impersonation) return true;

    if (impersonation.readOnly !== false && !SAFE_METHODS.has(request.method)) {
      throw new ForbiddenException(
        'Sessão de suporte é somente-leitura: nenhuma alteração pode ser feita ' +
          'em nome do cliente. Peça ao usuário para executar a ação.',
      );
    }
    return true;
  }
}
