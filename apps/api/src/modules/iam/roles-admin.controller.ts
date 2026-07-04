import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesAdminService } from './roles-admin.service';
import { CreateRoleDto, SetRolePermissionsDto, UpdateRoleDto } from './dto/roles-admin.dto';

/**
 * Gestão de perfis (roles) e catálogo de permissões — issue #352 (IAM F7.2).
 *
 * Dupla proteção (padrão do #470/#341): @Roles corta pelo enum legado
 * (SUPER_ADMIN/DIRECTOR) e @RequirePermission refina pelo RBAC v2
 * (iam.roles.view / iam.roles.manage). Escopo multi-tenant: companyId
 * SEMPRE do JWT — nunca de query/body.
 */
@ApiTags('iam')
@ApiBearerAuth()
@Controller('iam')
export class RolesAdminController {
  constructor(private readonly rolesAdminService: RolesAdminService) {}

  // ─── Perfis ────────────────────────────────────────────────────────────────

  @Get('roles')
  @Roles('SUPER_ADMIN', 'DIRECTOR')
  @RequirePermission('iam.roles.view')
  @ApiOperation({
    summary: 'Listar perfis (system + personalizados da empresa) — SUPER_ADMIN/DIRECTOR',
  })
  async listRoles(@CurrentUser() user: any) {
    return this.rolesAdminService.listRoles(user.companyId);
  }

  @Post('roles')
  @Roles('SUPER_ADMIN', 'DIRECTOR')
  @RequirePermission('iam.roles.manage')
  @ApiOperation({
    summary:
      'Criar perfil personalizado da empresa (opcionalmente duplicando um existente) — SUPER_ADMIN/DIRECTOR',
  })
  async createRole(@CurrentUser() user: any, @Body() dto: CreateRoleDto) {
    return this.rolesAdminService.createRole(
      { id: user.id, companyId: user.companyId },
      dto,
    );
  }

  @Patch('roles/:id')
  @Roles('SUPER_ADMIN', 'DIRECTOR')
  @RequirePermission('iam.roles.manage')
  @ApiOperation({
    summary: 'Editar perfil personalizado (perfis system → 403) — SUPER_ADMIN/DIRECTOR',
  })
  async updateRole(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.rolesAdminService.updateRole(
      { id: user.id, companyId: user.companyId },
      id,
      dto,
    );
  }

  @Delete('roles/:id')
  @Roles('SUPER_ADMIN', 'DIRECTOR')
  @RequirePermission('iam.roles.manage')
  @ApiOperation({
    summary:
      'Excluir perfil personalizado (system → 403; com usuários vinculados → 409) — SUPER_ADMIN/DIRECTOR',
  })
  async deleteRole(@CurrentUser() user: any, @Param('id') id: string) {
    return this.rolesAdminService.deleteRole(
      { id: user.id, companyId: user.companyId },
      id,
    );
  }

  // ─── Permissões do perfil ──────────────────────────────────────────────────

  @Get('roles/:id/permissions')
  @Roles('SUPER_ADMIN', 'DIRECTOR')
  @RequirePermission('iam.roles.view')
  @ApiOperation({
    summary: 'Permissões de um perfil (diretas + herdadas do pai) — SUPER_ADMIN/DIRECTOR',
  })
  async getRolePermissions(@CurrentUser() user: any, @Param('id') id: string) {
    return this.rolesAdminService.getRolePermissions(user.companyId, id);
  }

  @Put('roles/:id/permissions')
  @Roles('SUPER_ADMIN', 'DIRECTOR')
  @RequirePermission('iam.roles.manage')
  @ApiOperation({
    summary:
      'Substituir o conjunto COMPLETO de permissões do perfil (transacional; system → 403; anti-auto-lockout) — SUPER_ADMIN/DIRECTOR',
  })
  async setRolePermissions(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: SetRolePermissionsDto,
  ) {
    return this.rolesAdminService.setRolePermissions(
      { id: user.id, companyId: user.companyId },
      id,
      dto,
    );
  }

  // ─── Catálogo ──────────────────────────────────────────────────────────────

  @Get('permissions')
  @Roles('SUPER_ADMIN', 'DIRECTOR')
  @RequirePermission('iam.roles.view')
  @ApiOperation({
    summary:
      'Catálogo de permissões agrupado por módulo → recurso (árvore da UI) — SUPER_ADMIN/DIRECTOR',
  })
  async getPermissionsCatalog() {
    return this.rolesAdminService.getPermissionsCatalog();
  }
}
