import { Injectable } from '@nestjs/common';
import { IdentityProviderType } from '@prisma/client';
import { AuthService } from '../auth.service';
import {
  AuthenticatedUser,
  IdentityProfile,
  IdentityProvider,
} from './identity-provider.interface';

/**
 * Provider LOCAL (#346) — o fluxo de e-mail+senha de sempre, agora expresso
 * como um IdentityProvider registrado no IdentityProviderRegistry.
 *
 * REFATORAÇÃO MÍNIMA de propósito: este provider DELEGA para o
 * AuthService.validateUser existente (lockout, anti-enumeração, LoginAttempt
 * — tudo preservado). O LocalStrategy do Passport continua chamando o
 * AuthService diretamente: ZERO mudança de comportamento no login atual.
 * O provider existe para que o fluxo local e os futuros fluxos SSO sejam
 * resolvidos pelo MESMO ponto de extensão.
 */
@Injectable()
export class LocalIdentityProvider implements IdentityProvider {
  readonly type = IdentityProviderType.LOCAL;
  readonly displayName = 'E-mail e senha';

  constructor(private readonly authService: AuthService) {}

  /** LOCAL está sempre habilitado — é o método de autenticação base. */
  isEnabled(): boolean {
    return true;
  }

  async validateOrProvision(profile: IdentityProfile): Promise<AuthenticatedUser | null> {
    if (!profile.email || !profile.credentials?.password) return null;
    return this.authService.validateUser(
      profile.email,
      profile.credentials.password,
      profile.context ?? {},
    );
  }
}
