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
import { OrgStructureController } from './org-structure.controller';
import { OrgStructureService } from './org-structure.service';
import { PasswordPolicyService } from './password-policy.service';
import { PermissionCacheService } from './permission-cache.service';
import { LastAdminInvariantService } from './last-admin-invariant.service';
import { LegacyRoleMirrorService } from './legacy-role-mirror.service';
import { PermissionService } from './permission.service';
import { RolesAdminController } from './roles-admin.controller';
import { RolesAdminService } from './roles-admin.service';
import { SessionDenylistService } from './session-denylist.service';
import { SessionService } from './session.service';
import { ShadowModeService } from './shadow-mode.service';
import { TenantStatusService } from './tenant-status.service';
import { UserAccessController } from './user-access.controller';
import { UserAccessService } from './user-access.service';

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
 * (SessionDenylistService.isSessionDenylisted) é CONSUMIDA pela JwtStrategy
 * em toda request autenticada com sessionId (#823).
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
  controllers: [
    AuditController,
    OrgStructureController,
    RolesAdminController,
    UserAccessController,
  ],
  providers: [
    AuditProcessor,
    AuditService,
    EncryptionService,
    MfaService,
    LastAdminInvariantService,
    LegacyRoleMirrorService,
    OrgStructureService,
    PasswordPolicyService,
    PermissionCacheService,
    PermissionService,
    RolesAdminService,
    SessionDenylistService,
    SessionService,
    ShadowModeService,
    TenantStatusService,
    UserAccessService,
  ],
  exports: [
    AuditService,
    EncryptionService,
    LastAdminInvariantService,
    LegacyRoleMirrorService,
    MfaService,
    PasswordPolicyService,
    PermissionCacheService,
    PermissionService,
    SessionDenylistService,
    SessionService,
    ShadowModeService,
    TenantStatusService,
  ],
})
export class IamModule {}
