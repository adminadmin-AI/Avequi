import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    // passReqToCallback (#342): IP e user-agent alimentam LoginAttempt/lockout.
    super({ usernameField: 'email', passReqToCallback: true });
  }

  async validate(req: any, email: string, password: string) {
    const user = await this.authService.validateUser(email, password, {
      ipAddress: req?.ip,
      userAgent: req?.headers?.['user-agent'],
    });
    // Mensagem ÚNICA para e-mail inexistente, senha errada e conta inativa
    // (anti-enumeração — #342). Conta trancada lança 423 lá dentro.
    if (!user) throw new UnauthorizedException('Credenciais inválidas');
    return user;
  }
}
