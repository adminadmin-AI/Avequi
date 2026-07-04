import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdentityProviderType, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthenticatedUser, IdentityProfile } from './identity-provider.interface';

/**
 * Just-In-Time (JIT) provisioning de usuários vindos de SSO (#346).
 *
 * DESLIGADO por default (SSO_JIT_PROVISIONING=false): SSO só autenticará
 * quem JÁ existe no banco. Quando o Rafael ligar:
 * - usuário novo vindo de SSO é criado com o perfil default configurável
 *   (SSO_JIT_DEFAULT_ROLE, default READER — SUPER_ADMIN é PROIBIDO como
 *   default de JIT) na empresa SSO_JIT_DEFAULT_COMPANY_ID (obrigatória
 *   para o JIT funcionar — sem ela, nada é criado);
 * - a conta nasce com senha aleatória INUTILIZÁVEL (padrão comum para
 *   contas SSO-only): User.passwordHash continua NOT NULL no schema e o
 *   login por senha dessas contas simplesmente nunca valida.
 *
 * Fluxo de resolução (para providers EXTERNOS — LOCAL nunca passa aqui):
 * 1. identidade (provider, providerUserId) já vinculada → devolve o usuário;
 * 2. usuário existente com o MESMO e-mail → cria o vínculo e devolve
 *    (auto-link: seguro apenas com e-mail VERIFICADO pelo provider — os
 *    callbacks futuros DEVEM checar email_verified antes de chegar aqui);
 * 3. JIT desligado → null (401 genérico no chamador);
 * 4. JIT ligado → cria usuário + vínculo.
 */
@Injectable()
export class SsoJitProvisioningService {
  private readonly logger = new Logger(SsoJitProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  isJitEnabled(): boolean {
    const value = this.config.get('SSO_JIT_PROVISIONING');
    return value === true || value === 'true';
  }

  /** Perfil default de contas JIT. SUPER_ADMIN nunca — cai para READER. */
  getDefaultRole(): UserRole {
    const configured = this.config.get<string>('SSO_JIT_DEFAULT_ROLE') ?? UserRole.READER;
    const valid = (Object.values(UserRole) as string[]).includes(configured);
    if (!valid || configured === UserRole.SUPER_ADMIN) return UserRole.READER;
    return configured as UserRole;
  }

  async resolveOrProvision(profile: IdentityProfile): Promise<AuthenticatedUser | null> {
    if (profile.provider === IdentityProviderType.LOCAL) {
      // LOCAL autentica por senha no LocalIdentityProvider — nunca por aqui.
      throw new Error('JIT provisioning não se aplica ao provider LOCAL');
    }
    if (!profile.providerUserId || !profile.email) return null;

    // 1. Identidade já vinculada.
    const identity = await this.prisma.userIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: profile.provider,
          providerUserId: profile.providerUserId,
        },
      },
      include: { user: true },
    });
    if (identity) {
      if (!identity.user.isActive) return null;
      return this.strip(identity.user);
    }

    // 2. Usuário existente com o mesmo e-mail → auto-vínculo.
    const existing = await this.prisma.user.findUnique({ where: { email: profile.email } });
    if (existing) {
      if (!existing.isActive) return null;
      await this.prisma.userIdentity.create({
        data: {
          userId: existing.id,
          provider: profile.provider,
          providerUserId: profile.providerUserId,
          email: profile.email,
          metadata: (profile.metadata as object) ?? undefined,
        },
      });
      this.logger.log(
        `Identidade ${profile.provider} vinculada ao usuário existente ${existing.id}`,
      );
      return this.strip(existing);
    }

    // 3. Usuário novo + JIT desligado → não cria nada.
    if (!this.isJitEnabled()) {
      this.logger.warn(
        `SSO ${profile.provider}: usuário ${profile.email} não existe e o JIT provisioning está DESLIGADO — acesso negado`,
      );
      return null;
    }

    // 4. JIT ligado → cria usuário com perfil default + senha inutilizável.
    const companyId = this.config.get<string>('SSO_JIT_DEFAULT_COMPANY_ID');
    if (!companyId) {
      this.logger.error(
        'SSO_JIT_PROVISIONING=true mas SSO_JIT_DEFAULT_COMPANY_ID não configurado — JIT abortado',
      );
      return null;
    }

    const unusablePassword = await bcrypt.hash(randomBytes(48).toString('hex'), 10);
    const user = await this.prisma.user.create({
      data: {
        name: profile.name ?? profile.email,
        email: profile.email,
        passwordHash: unusablePassword,
        role: this.getDefaultRole(),
        companyId,
        identities: {
          create: {
            provider: profile.provider,
            providerUserId: profile.providerUserId,
            email: profile.email,
            metadata: (profile.metadata as object) ?? undefined,
          },
        },
      },
    });
    this.logger.log(
      `JIT provisioning: usuário ${user.id} criado via ${profile.provider} com perfil ${user.role}`,
    );
    return this.strip(user);
  }

  private strip(user: Record<string, unknown>): AuthenticatedUser {
    const { passwordHash: _ph, ...safe } = user;
    return safe as AuthenticatedUser;
  }
}
