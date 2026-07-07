import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditController } from './audit.controller';
import { AuditProcessor } from './audit.processor';
import { AuditService } from './audit.service';
import { AUDIT_QUEUE } from './audit.types';
import { MfaService } from './mfa.service';
import { PasswordPolicyService } from './password-policy.service';
import { PermissionCacheService } from './permission-cache.service';
import { PermissionService } from './permission.service';
import { SessionDenylistService } from './session-denylist.service';
import { SessionService } from './session.service';
import { ShadowModeService } from './shadow-mode.service';

/**
 * Módulo IAM v2 — motor de autorização RBAC (issue #340, Fase F3.1/M2)
 * + sessões/dispositivos/lockout (issue #342, Fase F3.3/M4)
 * + auditoria persistida com fila Bull (issue #343, Fase F3.4/M5)
 * + MFA/2FA TOTP com backup codes e EncryptionService (issue #344, Fase F4.1)
 * + password policy: complexidade, histórico e rotação (issue #345, F4.2).
 *
 * O PermissionService agora TAMBÉM alimenta o PermissionGuard global (#341,
 * F5.1 — common/guards/permission.guard.ts): enforcement real nas rotas com
 * @RequirePermission (por ora, só o módulo IAM — dogfooding; os demais
 * controllers migram na parte 2, após o merge do PR #453). O shadow mode
 * segue disponível para os endpoints que só têm @Roles. O SessionService já
 * é CONSUMIDO pelo AuthModule (login cria sessão, refresh mantém, logout
 * revoga); a consulta de denylist
 * (SessionDenylistService.isSessionDenylisted) fica exposta para o
 * JwtAuthGuard (pendência da #341).
 *
 * O AuditService é exportado para o AuditInterceptor global (app.module) e
 * para services que adotarem logWithDiff() gradualmente (Decisão 5).
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    BullModule.registerQueue({ name: AUDIT_QUEUE }),
  ],
  controllers: [AuditController],
  providers: [
    AuditProcessor,
    AuditService,
    EncryptionService,
    MfaService,
    PasswordPolicyService,
    PermissionCacheService,
    PermissionService,
    SessionDenylistService,
    SessionService,
    ShadowModeService,
  ],
  exports: [
    AuditService,
    EncryptionService,
    MfaService,
    PasswordPolicyService,
    PermissionCacheService,
    PermissionService,
    SessionDenylistService,
    SessionService,
    ShadowModeService,
  ],
})
export class IamModule {}
