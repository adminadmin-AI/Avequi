import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { MFA_PENDING_SCOPE } from '../auth.service';

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
    // #344: o mfaPendingToken (2º passo do login MFA) é assinado com o mesmo
    // secret mas tem escopo restrito — NUNCA vale como access token.
    if (payload?.scope === MFA_PENDING_SCOPE) {
      throw new UnauthorizedException('Token pendente de MFA não é um access token');
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
