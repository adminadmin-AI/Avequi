import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserAccessService } from './user-access.service';
import { AssignRoleDto, GrantUserPermissionDto } from './dto/roles-admin.dto';

/**
 * Atribuições de perfil e exceções individuais por usuário — issue #352
 * (IAM F7.2). Mesmo padrão de dupla proteção do RolesAdminController:
 * @Roles (enum legado) + @RequirePermission (RBAC v2, iam.roles.view /
 * iam.roles.assign). Alvo sempre da MESMA empresa do JWT (anti-IDOR).
 */
@ApiTags('iam')
@ApiBearerAuth()
@Controller('iam/users/:userId')
export class UserAccessController {
  constructor(private readonly userAccessService: UserAccessService) {}

  // ─── Perfis do usuário ─────────────────────────────────────────────────────

  @Get('roles')
  @Roles('SUPER_ADMIN', 'DIRECTOR')
  @RequirePermission('iam.roles.view')
  @ApiOperation({ summary: 'Perfis atribuídos ao usuário — SUPER_ADMIN/DIRECTOR' })
  async listUserRoles(@CurrentUser() user: any, @Param('userId') userId: string) {
    return this.userAccessService.listUserRoles(user.companyId, userId);
  }

  @Post('roles')
  @Roles('SUPER_ADMIN', 'DIRECTOR')
  @RequirePermission('iam.roles.assign')
  @ApiOperation({
    summary:
      'Atribuir perfil ao usuário (escopo filial e expiração opcionais) — SUPER_ADMIN/DIRECTOR',
  })
  async assignRole(
    @CurrentUser() user: any,
    @Param('userId') userId: string,
    @Body() dto: AssignRoleDto,
  ) {
    return this.userAccessService.assignRole(
      { id: user.id, companyId: user.companyId },
      userId,
      dto,
    );
  }

  @Delete('roles/:roleId')
  @Roles('SUPER_ADMIN', 'DIRECTOR')
  @RequirePermission('iam.roles.assign')
  @ApiOperation({
    summary:
      'Remover perfil do usuário (anti-auto-lockout: 400 se remover o próprio acesso à gestão) — SUPER_ADMIN/DIRECTOR',
  })
  async removeRole(
    @CurrentUser() user: any,
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
  ) {
    return this.userAccessService.removeRole(
      { id: user.id, companyId: user.companyId },
      userId,
      roleId,
    );
  }

  // ─── Exceções individuais ──────────────────────────────────────────────────

  @Get('permissions')
  @Roles('SUPER_ADMIN', 'DIRECTOR')
  @RequirePermission('iam.roles.view')
  @ApiOperation({
    summary: 'Exceções individuais (grants/denies) do usuário — SUPER_ADMIN/DIRECTOR',
  })
  async listUserPermissions(@CurrentUser() user: any, @Param('userId') userId: string) {
    return this.userAccessService.listUserPermissions(user.companyId, userId);
  }

  @Post('permissions')
  @Roles('SUPER_ADMIN', 'DIRECTOR')
  @RequirePermission('iam.roles.assign')
  @ApiOperation({
    summary:
      'Conceder grant/deny individual com expiração e justificativa (denies não trancam SUPER_ADMIN fora da gestão) — SUPER_ADMIN/DIRECTOR',
  })
  async grantPermission(
    @CurrentUser() user: any,
    @Param('userId') userId: string,
    @Body() dto: GrantUserPermissionDto,
  ) {
    return this.userAccessService.grantPermission(
      { id: user.id, companyId: user.companyId },
      userId,
      dto,
    );
  }

  @Delete('permissions/:userPermissionId')
  @Roles('SUPER_ADMIN', 'DIRECTOR')
  @RequirePermission('iam.roles.assign')
  @ApiOperation({
    summary: 'Remover exceção individual do usuário — SUPER_ADMIN/DIRECTOR',
  })
  async removePermission(
    @CurrentUser() user: any,
    @Param('userId') userId: string,
    @Param('userPermissionId') userPermissionId: string,
  ) {
    return this.userAccessService.removePermission(
      { id: user.id, companyId: user.companyId },
      userId,
      userPermissionId,
    );
  }
}
