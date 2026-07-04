import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { MFA_PENDING_SCOPE, PASSWORD_CHANGE_SCOPE } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
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
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      companyId: payload.companyId,
      // #342 (IAM v2, Decisão 4): claim OPCIONAL — tokens antigos não têm.
      // A denylist de sessões será consultada pelo JwtAuthGuard na #341.
      sessionId: payload.sessionId,
    };
  }
}
