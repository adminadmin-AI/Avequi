import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * OpsSessionGuard — OPS WP7 (#914): sessão CURTA no control plane.
 *
 * O app tolera sessões longas (refresh de 7d + idle timeout #341); quem
 * enxerga cross-tenant não. Aqui a sessão vale por IDADE ABSOLUTA — passou
 * de OPS_SESSION_MAX_AGE_MINUTES (default 8h) desde o login, as rotas /ops
 * fecham e o operador refaz o login (re-autenticando com MFA). O restante do
 * app segue funcionando com a mesma sessão: a fronteira é do portal, não do
 * usuário.
 *
 * Fail-closed nas três saídas (mesmo racional do OpsMfaGuard):
 *  - token sem claim `sessionId` (legado pré-#342) não prova idade → 403;
 *  - sessão inexistente/revogada → 403;
 *  - erro de infra na consulta → 403.
 */
@Injectable()
export class OpsSessionGuard implements CanActivate {
  private readonly logger = new Logger(OpsSessionGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest();
    if (!user?.sessionId) {
      throw new ForbiddenException(
        'O portal da operadora exige uma sessão rastreada. Faça login novamente.',
      );
    }

    let session: { createdAt: Date; revokedAt: Date | null } | null = null;
    try {
      session = await this.prisma.userSession.findUnique({
        where: { id: user.sessionId },
        select: { createdAt: true, revokedAt: true },
      });
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'ops_session_guard_error',
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      throw new ForbiddenException(
        'Não foi possível validar sua sessão no momento. Tente novamente em instantes.',
      );
    }

    if (!session || session.revokedAt) {
      throw new ForbiddenException('Sessão inválida. Faça login novamente.');
    }

    const idadeMs = Date.now() - session.createdAt.getTime();
    if (idadeMs > OPS_SESSION_MAX_AGE_MS) {
      throw new ForbiddenException(
        'Sessão muito antiga para o portal da operadora. Faça login novamente ' +
          'para continuar (a sessão do app não é afetada).',
      );
    }
    return true;
  }
}

/** Idade máxima da sessão nas rotas /ops. Faixa 15min..24h; default 8h. */
function resolveMaxAgeMs(): number {
  const bruto = Number(process.env.OPS_SESSION_MAX_AGE_MINUTES);
  if (!Number.isFinite(bruto) || bruto < 15 || bruto > 1440) return 480 * 60_000;
  return Math.floor(bruto) * 60_000;
}

export const OPS_SESSION_MAX_AGE_MS = resolveMaxAgeMs();
