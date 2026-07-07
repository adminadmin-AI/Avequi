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
import { RolesAdminService } from './roles-admin.service';
import { CreateRoleDto, SetRolePermissionsDto, UpdateRoleDto } from './dto/roles-admin.dto';

/**
 * Gestão de perfis (roles) e catálogo de permissões — issue #352 (IAM F7.2).
 *
 * Autorização por RBAC v2 (@RequirePermission), gate ÚNICO destes endpoints —
 * NÃO usamos @Roles(enum) aqui (decisão de produto Rafael #352): o enum legado
 * só reconhece SUPER_ADMIN/DIRECTOR e bloquearia ADMIN_EMPRESA e AUDITOR, que
 * são perfis só-RBAC-v2. O acesso efetivo segue a matriz aprovada:
 *   - iam.roles.view   → ADMIN_GLOBAL, ADMIN_EMPRESA, DIRETOR, AUDITOR
 *   - iam.roles.manage → ADMIN_GLOBAL, ADMIN_EMPRESA (cria/edita/exclui perfis)
 * O PermissionService resolve o efetivo de cada usuário (o seed espelha o enum
 * legado → UserRoleAssignment, então admins legados continuam resolvendo). O
 * PermissionGuard é fail-closed. Escopo multi-tenant: companyId SEMPRE do JWT.
 */
@ApiTags('iam')
@ApiBearerAuth()
@Controller('iam')
export class RolesAdminController {
  constructor(private readonly rolesAdminService: RolesAdminService) {}

  // ─── Perfis ────────────────────────────────────────────────────────────────

  @Get('roles')
  @RequirePermission('iam.roles.view')
  @ApiOperation({
    summary: 'Listar perfis (system + personalizados da empresa)',
  })
  async listRoles(@CurrentUser() user: any) {
    return this.rolesAdminService.listRoles(user.companyId);
  }

  @Post('roles')
  @RequirePermission('iam.roles.manage')
  @ApiOperation({
    summary:
      'Criar perfil personalizado da empresa (opcionalmente duplicando um existente)',
  })
  async createRole(@CurrentUser() user: any, @Body() dto: CreateRoleDto) {
    return this.rolesAdminService.createRole(
      { id: user.id, companyId: user.companyId },
      dto,
    );
  }

  @Patch('roles/:id')
  @RequirePermission('iam.roles.manage')
  @ApiOperation({
    summary: 'Editar perfil personalizado (perfis system → 403)',
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
  @RequirePermission('iam.roles.manage')
  @ApiOperation({
    summary:
      'Excluir perfil personalizado (system → 403; com usuários vinculados → 409)',
  })
  async deleteRole(@CurrentUser() user: any, @Param('id') id: string) {
    return this.rolesAdminService.deleteRole(
      { id: user.id, companyId: user.companyId },
      id,
    );
  }

  // ─── Permissões do perfil ──────────────────────────────────────────────────

  @Get('roles/:id/permissions')
  @RequirePermission('iam.roles.view')
  @ApiOperation({
    summary: 'Permissões de um perfil (diretas + herdadas do pai)',
  })
  async getRolePermissions(@CurrentUser() user: any, @Param('id') id: string) {
    return this.rolesAdminService.getRolePermissions(user.companyId, id);
  }

  @Put('roles/:id/permissions')
  @RequirePermission('iam.roles.manage')
  @ApiOperation({
    summary:
      'Substituir o conjunto COMPLETO de permissões do perfil (transacional; system → 403; anti-auto-lockout)',
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
  @RequirePermission('iam.roles.view')
  @ApiOperation({
    summary:
      'Catálogo de permissões agrupado por módulo → recurso (árvore da UI)',
  })
  async getPermissionsCatalog() {
    return this.rolesAdminService.getPermissionsCatalog();
  }
}
