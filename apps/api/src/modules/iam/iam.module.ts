import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { PermissionCacheService } from './permission-cache.service';
import { PermissionService } from './permission.service';
import { ShadowModeService } from './shadow-mode.service';

/**
 * Módulo IAM v2 — motor de autorização RBAC (issue #340, Fase F3.1/M2).
 *
 * Nesta fase o módulo só CALCULA e OBSERVA (shadow mode): nenhum guard novo,
 * nenhum request bloqueado. O PermissionGuard + @RequirePermission chegam na
 * issue #341 (Onda B) e vão consumir os serviços exportados daqui.
 */
@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [PermissionCacheService, PermissionService, ShadowModeService],
  exports: [PermissionCacheService, PermissionService, ShadowModeService],
})
export class IamModule {}
