import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { SessionDenylistService } from '../../iam/session-denylist.service';
import { MFA_PENDING_SCOPE, PASSWORD_CHANGE_SCOPE } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly denylist: SessionDenylistService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET'),
    });
  }

  async validate(payload: any) {
    // #344/#345: tokens restritos (mfaPendingToken e passwordChangeToken)
    // são assinados com o mesmo secret mas têm escopo restrito — NUNCA
    // valem como access token.
    if (payload?.scope === MFA_PENDING_SCOPE || payload?.scope === PASSWORD_CHANGE_SCOPE) {
      throw new UnauthorizedException('Token restrito não é um access token');
    }

    // #823: sessão revogada criticamente (SECURITY/ADMIN_REVOKE — inativação,
    // troca de senha, reset por admin) está na denylist Redis → o access
    // token morre AQUI, antes de Company/Roles/PermissionGuard e do
    // controller. Este é o ponto comum de TODO access token normal (o
    // JwtAuthGuard global delega ao passport; @Public nem chega). Token
    // legado sem sessionId (transição M4, #342) não tem sessão para
    // consultar — segue valendo até expirar (15 min), como documentado.
    // Redis indisponível → fail-open dentro do serviço (janela = expiração
    // natural do token; o refresh continua barrado pelos mecanismos
    // persistentes). Mensagem genérica: não revela o motivo da revogação.
    if (payload?.sessionId) {
      const denied = await this.denylist.isSessionDenylisted(payload.sessionId);
      if (denied) {
        throw new UnauthorizedException('Sessão inválida ou expirada. Faça login novamente.');
      }
    }

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      companyId: payload.companyId,
      // #342 (IAM v2, Decisão 4): claim OPCIONAL — tokens antigos não têm.
      sessionId: payload.sessionId,
    };
  }
}
