import { BadRequestException, Injectable } from '@nestjs/common';
import { IdentityProviderType } from '@prisma/client';
import { IdentityProvider } from './identity-provider.interface';
import { LocalIdentityProvider } from './local.identity-provider';

/**
 * Registro central de provedores de identidade (#346).
 *
 * Hoje registra apenas o LOCAL. Quando Google/Microsoft/SAML forem
 * implementados, cada um vira um provider injetado aqui — o resto do
 * sistema (controllers, futuro callback OAuth) resolve pelo registry e
 * não conhece implementações concretas.
 */
@Injectable()
export class IdentityProviderRegistry {
  private readonly providers = new Map<IdentityProviderType, IdentityProvider>();

  constructor(local: LocalIdentityProvider) {
    this.register(local);
  }

  register(provider: IdentityProvider): void {
    if (this.providers.has(provider.type)) {
      throw new Error(`Provedor de identidade já registrado: ${provider.type}`);
    }
    this.providers.set(provider.type, provider);
  }

  /**
   * Resolve um provider HABILITADO. Provider desconhecido ou desligado →
   * 400 (o tipo vem de input externo no futuro callback SSO).
   */
  resolve(type: IdentityProviderType): IdentityProvider {
    const provider = this.providers.get(type);
    if (!provider || !provider.isEnabled()) {
      throw new BadRequestException(`Provedor de identidade não habilitado: ${type}`);
    }
    return provider;
  }

  /** Lista pública dos providers habilitados (tela de login do frontend). */
  listEnabled(): Array<{ type: IdentityProviderType; name: string }> {
    return [...this.providers.values()]
      .filter((p) => p.isEnabled())
      .map((p) => ({ type: p.type, name: p.displayName }));
  }
}
