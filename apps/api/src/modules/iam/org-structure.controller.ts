import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrgStructureService } from './org-structure.service';
import {
  AddUserDepartmentDto,
  AddUserTeamDto,
  CreateBranchDto,
  CreateDepartmentDto,
  CreateTeamDto,
  UpdateBranchDto,
  UpdateDepartmentDto,
  UpdateTeamDto,
} from './dto/org-structure.dto';

/**
 * Estrutura organizacional (Filiais, Departamentos, Equipes) + vínculos de
 * usuários — issue #347 (IAM F5.2, FASE 1: CRUD e vínculos; o enforcement de
 * escopo por filial no sistema todo é a fase 2).
 *
 * Dupla proteção (padrão do #470/#341): @Roles corta pelo enum legado
 * (SUPER_ADMIN/DIRECTOR/MANAGER) e @RequirePermission refina pelo RBAC v2
 * (iam.org.view / iam.org.manage / iam.org.assign). Escopo multi-tenant:
 * companyId SEMPRE do JWT — nunca de query/body (anti-IDOR).
 */
@ApiTags('iam')
@ApiBearerAuth()
@Controller('iam')
export class OrgStructureController {
  constructor(private readonly orgStructureService: OrgStructureService) {}

  // ─── Filiais ───────────────────────────────────────────────────────────────

  @Get('branches')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @RequirePermission('iam.org.view')
  @ApiOperation({ summary: 'Listar filiais da empresa — SUPER_ADMIN/DIRECTOR/MANAGER' })
  async listBranches(@CurrentUser() user: any) {
    return this.orgStructureService.listBranches(user.companyId);
  }

  @Post('branches')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @RequirePermission('iam.org.manage')
  @ApiOperation({ summary: 'Criar filial (código único por empresa → 409)' })
  async createBranch(@CurrentUser() user: any, @Body() dto: CreateBranchDto) {
    return this.orgStructureService.createBranch(
      { id: user.id, companyId: user.companyId },
      dto,
    );
  }

  @Patch('branches/:id')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @RequirePermission('iam.org.manage')
  @ApiOperation({ summary: 'Editar filial (nome, CNPJ, ativa/inativa)' })
  async updateBranch(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.orgStructureService.updateBranch(
      { id: user.id, companyId: user.companyId },
      id,
      dto,
    );
  }

  @Delete('branches/:id')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @RequirePermission('iam.org.manage')
  @ApiOperation({
    summary: 'Excluir filial (referenciada em atribuições com escopo → 409)',
  })
  async deleteBranch(@CurrentUser() user: any, @Param('id') id: string) {
    return this.orgStructureService.deleteBranch(
      { id: user.id, companyId: user.companyId },
      id,
    );
  }

  // ─── Departamentos ─────────────────────────────────────────────────────────

  @Get('departments')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @RequirePermission('iam.org.view')
  @ApiOperation({
    summary: 'Listar departamentos da empresa (com hierarquia e gerente)',
  })
  async listDepartments(@CurrentUser() user: any) {
    return this.orgStructureService.listDepartments(user.companyId);
  }

  @Post('departments')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @RequirePermission('iam.org.manage')
  @ApiOperation({
    summary: 'Criar departamento (pai e gerente opcionais; código único → 409)',
  })
  async createDepartment(@CurrentUser() user: any, @Body() dto: CreateDepartmentDto) {
    return this.orgStructureService.createDepartment(
      { id: user.id, companyId: user.companyId },
      dto,
    );
  }

  @Patch('departments/:id')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @RequirePermission('iam.org.manage')
  @ApiOperation({
    summary: 'Editar departamento (hierarquia com defesa a ciclo → 400)',
  })
  async updateDepartment(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.orgStructureService.updateDepartment(
      { id: user.id, companyId: user.companyId },
      id,
      dto,
    );
  }

  @Delete('departments/:id')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @RequirePermission('iam.org.manage')
  @ApiOperation({
    summary:
      'Excluir departamento (com subdepartamentos, equipes ou usuários → 409)',
  })
  async deleteDepartment(@CurrentUser() user: any, @Param('id') id: string) {
    return this.orgStructureService.deleteDepartment(
      { id: user.id, companyId: user.companyId },
      id,
    );
  }

  // ─── Equipes ───────────────────────────────────────────────────────────────

  @Get('teams')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @RequirePermission('iam.org.view')
  @ApiOperation({ summary: 'Listar equipes da empresa (via departamento)' })
  async listTeams(@CurrentUser() user: any) {
    return this.orgStructureService.listTeams(user.companyId);
  }

  @Post('teams')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @RequirePermission('iam.org.manage')
  @ApiOperation({ summary: 'Criar equipe dentro de um departamento (líder opcional)' })
  async createTeam(@CurrentUser() user: any, @Body() dto: CreateTeamDto) {
    return this.orgStructureService.createTeam(
      { id: user.id, companyId: user.companyId },
      dto,
    );
  }

  @Patch('teams/:id')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @RequirePermission('iam.org.manage')
  @ApiOperation({ summary: 'Editar equipe (nome, departamento, líder, ativa/inativa)' })
  async updateTeam(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.orgStructureService.updateTeam(
      { id: user.id, companyId: user.companyId },
      id,
      dto,
    );
  }

  @Delete('teams/:id')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @RequirePermission('iam.org.manage')
  @ApiOperation({ summary: 'Excluir equipe (com membros → 409)' })
  async deleteTeam(@CurrentUser() user: any, @Param('id') id: string) {
    return this.orgStructureService.deleteTeam(
      { id: user.id, companyId: user.companyId },
      id,
    );
  }

  // ─── Vínculos usuário ↔ departamento ──────────────────────────────────────
  // Obs.: o escopo de FILIAL por usuário já existe via branchId no
  // UserRoleAssignment (POST /iam/users/:userId/roles, #352) — não duplicado.

  @Get('users/:userId/departments')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @RequirePermission('iam.org.view')
  @ApiOperation({ summary: 'Departamentos do usuário (com flag de principal)' })
  async listUserDepartments(@CurrentUser() user: any, @Param('userId') userId: string) {
    return this.orgStructureService.listUserDepartments(user.companyId, userId);
  }

  @Post('users/:userId/departments')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @RequirePermission('iam.org.assign')
  @ApiOperation({
    summary:
      'Vincular usuário a departamento (duplicado → 409; isPrimary desmarca o principal anterior)',
  })
  async addUserDepartment(
    @CurrentUser() user: any,
    @Param('userId') userId: string,
    @Body() dto: AddUserDepartmentDto,
  ) {
    return this.orgStructureService.addUserDepartment(
      { id: user.id, companyId: user.companyId },
      userId,
      dto,
    );
  }

  @Delete('users/:userId/departments/:departmentId')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @RequirePermission('iam.org.assign')
  @ApiOperation({ summary: 'Remover vínculo do usuário com o departamento' })
  async removeUserDepartment(
    @CurrentUser() user: any,
    @Param('userId') userId: string,
    @Param('departmentId') departmentId: string,
  ) {
    return this.orgStructureService.removeUserDepartment(
      { id: user.id, companyId: user.companyId },
      userId,
      departmentId,
    );
  }

  // ─── Vínculos usuário ↔ equipe ────────────────────────────────────────────

  @Get('users/:userId/teams')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @RequirePermission('iam.org.view')
  @ApiOperation({ summary: 'Equipes do usuário' })
  async listUserTeams(@CurrentUser() user: any, @Param('userId') userId: string) {
    return this.orgStructureService.listUserTeams(user.companyId, userId);
  }

  @Post('users/:userId/teams')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @RequirePermission('iam.org.assign')
  @ApiOperation({ summary: 'Vincular usuário a equipe (duplicado → 409)' })
  async addUserTeam(
    @CurrentUser() user: any,
    @Param('userId') userId: string,
    @Body() dto: AddUserTeamDto,
  ) {
    return this.orgStructureService.addUserTeam(
      { id: user.id, companyId: user.companyId },
      userId,
      dto,
    );
  }

  @Delete('users/:userId/teams/:teamId')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @RequirePermission('iam.org.assign')
  @ApiOperation({ summary: 'Remover vínculo do usuário com a equipe' })
  async removeUserTeam(
    @CurrentUser() user: any,
    @Param('userId') userId: string,
    @Param('teamId') teamId: string,
  ) {
    return this.orgStructureService.removeUserTeam(
      { id: user.id, companyId: user.companyId },
      userId,
      teamId,
    );
  }
}
