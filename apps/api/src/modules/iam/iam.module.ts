import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { PermissionCacheService } from './permission-cache.service';
import { PermissionService } from './permission.service';
import { SessionDenylistService } from './session-denylist.service';
import { SessionService } from './session.service';
import { ShadowModeService } from './shadow-mode.service';

/**
 * Módulo IAM v2 — motor de autorização RBAC (issue #340, Fase F3.1/M2)
 * + sessões/dispositivos/lockout (issue #342, Fase F3.3/M4).
 *
 * O PermissionService segue em shadow mode (nenhum guard novo). O
 * SessionService já é CONSUMIDO pelo AuthModule (login cria sessão, refresh
 * mantém, logout revoga); a consulta de denylist
 * (SessionDenylistService.isSessionDenylisted) fica exposta para o
 * JwtAuthGuard da issue #341 (Onda B).
 */
@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [
    PermissionCacheService,
    PermissionService,
    SessionDenylistService,
    SessionService,
    ShadowModeService,
  ],
  exports: [
    PermissionCacheService,
    PermissionService,
    SessionDenylistService,
    SessionService,
    ShadowModeService,
  ],
})
export class IamModule {}
