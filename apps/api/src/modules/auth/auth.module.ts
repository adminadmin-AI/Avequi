import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { IdentityProviderRegistry } from './providers/identity-provider.registry';
import { LocalIdentityProvider } from './providers/local.identity-provider';
import { SsoJitProvisioningService } from './providers/sso-jit-provisioning.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { IamModule } from '../iam/iam.module';

@Module({
  imports: [
    PrismaModule,
    // #342: SessionService (sessões/lockout) e SessionDenylistService
    IamModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRY', '15m') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    LocalStrategy,
    // #346 (SSO prep): ponto de extensão para providers de identidade.
    // O LOCAL delega ao AuthService (zero mudança no fluxo atual); Google/
    // Microsoft/SAML futuros entram aqui como novos providers registrados.
    LocalIdentityProvider,
    IdentityProviderRegistry,
    SsoJitProvisioningService,
  ],
  exports: [AuthService, IdentityProviderRegistry, SsoJitProvisioningService],
})
export class AuthModule {}
