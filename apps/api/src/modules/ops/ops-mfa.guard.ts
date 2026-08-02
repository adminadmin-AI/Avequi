import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { MfaService } from '../iam/mfa.service';

/**
 * OpsMfaGuard — OPS WP1 (#908): enforcement DURO de MFA nas rotas /ops.
 *
 * O enforcement por perfil (Role.requireMfa) segue SUAVE no app (decisão
 * pendente do Rafael, #344). O control plane não espera essa decisão: quem
 * enxerga cross-tenant opera com MFA ativo, sem grace period. Sem MFA
 * habilitado → 403 com instrução de habilitar no próprio perfil.
 *
 * Aplicado por @UseGuards no OpsController (roda DEPOIS da cadeia global —
 * o usuário aqui já está autenticado e com a permissão ops.* verificada).
 * Fail-closed: erro na consulta de MFA nega o acesso (mesmo racional do
 * PermissionGuard — rota sensível não abre em incidente de infra).
 */
@Injectable()
export class OpsMfaGuard implements CanActivate {
  private readonly logger = new Logger(OpsMfaGuard.name);

  constructor(private readonly mfaService: MfaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest();
    if (!user?.id) {
      throw new ForbiddenException(
        'Não foi possível identificar o usuário para a verificação de MFA.',
      );
    }

    let enabled = false;
    try {
      enabled = await this.mfaService.isEnabled(user.id);
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'ops_mfa_guard_error',
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      throw new ForbiddenException(
        'Não foi possível verificar seu MFA no momento. Tente novamente em instantes.',
      );
    }

    if (!enabled) {
      throw new ForbiddenException(
        'O portal da operadora exige MFA (verificação em duas etapas) ativo. ' +
          'Habilite o MFA no seu perfil e tente novamente.',
      );
    }
    return true;
  }
}
