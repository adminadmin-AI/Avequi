import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { MfaService } from './mfa.service';
import { UserAccessService } from './user-access.service';
import { AdminMfaResetDto, AssignRoleDto, GrantUserPermissionDto } from './dto/roles-admin.dto';

/**
 * Atribuições de perfil e exceções individuais por usuário — issue #352
 * (IAM F7.2). Autorização por RBAC v2 (@RequirePermission), gate ÚNICO — SEM
 * @Roles(enum) (decisão Rafael #352): o enum legado bloquearia ADMIN_EMPRESA e
 * AUDITOR (perfis só-v2). Acesso efetivo pela matriz aprovada:
 *   - iam.roles.view   → ADMIN_GLOBAL, ADMIN_EMPRESA, DIRETOR, AUDITOR
 *   - iam.roles.assign → ADMIN_GLOBAL, ADMIN_EMPRESA (atribui perfis e exceções
 *     individuais; DIRETOR NÃO atribui). Alvo sempre da MESMA empresa do JWT.
 */
@ApiTags('iam')
@ApiBearerAuth()
@Controller('iam/users/:userId')
export class UserAccessController {
  constructor(
    private readonly userAccessService: UserAccessService,
    private readonly mfaService: MfaService,
  ) {}

  // ─── MFA (#545) ────────────────────────────────────────────────────────────

  @Post('mfa/reset')
  @RequirePermission('iam.roles.assign')
  @ApiOperation({
    summary:
      'Reset de MFA por administrador (#545) — usuário perdeu celular E backup codes. ' +
      'Exige senha do próprio admin; nunca a própria conta; gera SecurityEvent auditável.',
  })
  async resetMfa(
    @CurrentUser() user: any,
    @Param('userId') userId: string,
    @Body() dto: AdminMfaResetDto,
  ) {
    await this.mfaService.adminReset(
      { id: user.id, companyId: user.companyId },
      userId,
      dto.password,
    );
    return { message: 'MFA resetado — o usuário volta a logar só com senha e pode reconfigurar.' };
  }

  // ─── Perfis do usuário ─────────────────────────────────────────────────────

  @Get('roles')
  @RequirePermission('iam.roles.view')
  @ApiOperation({ summary: 'Perfis atribuídos ao usuário' })
  async listUserRoles(@CurrentUser() user: any, @Param('userId') userId: string) {
    return this.userAccessService.listUserRoles(user, userId);
  }

  @Post('roles')
  @RequirePermission('iam.roles.assign')
  @ApiOperation({
    summary:
      'Atribuir perfil ao usuário (escopo filial e expiração opcionais)',
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
  @RequirePermission('iam.roles.assign')
  @ApiOperation({
    summary:
      'Remover perfil do usuário (anti-auto-lockout: 400 se remover o próprio acesso à gestão)',
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
  @RequirePermission('iam.roles.view')
  @ApiOperation({
    summary: 'Exceções individuais (grants/denies) do usuário',
  })
  async listUserPermissions(@CurrentUser() user: any, @Param('userId') userId: string) {
    return this.userAccessService.listUserPermissions(user, userId);
  }

  @Post('permissions')
  @RequirePermission('iam.roles.assign')
  @ApiOperation({
    summary:
      'Conceder grant/deny individual com expiração e justificativa (denies não trancam SUPER_ADMIN fora da gestão)',
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
  @RequirePermission('iam.roles.assign')
  @ApiOperation({
    summary: 'Remover exceção individual do usuário',
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
