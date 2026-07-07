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
 * usuários — issue #347 (IAM F5.2).
 *
 * ⚠️ FASE 1 (este PR): apenas CADASTRO da estrutura e vínculos de pessoas.
 * NÃO há enforcement de escopo por filial/departamento/equipe — nenhum módulo
 * do ERP (vendas/estoque/produção/financeiro) passa a filtrar dados por filial,
 * e o PermissionService.can() NÃO ganha escopo organizacional. "Gerente da
 * filial X só vê dados da filial X" é a FASE 2 (issue separada), porque muda o
 * comportamento do ERP inteiro. Aqui primeiro cadastramos e vinculamos.
 *
 * Autorização por RBAC v2 (@RequirePermission), gate ÚNICO — SEM @Roles(enum)
 * (mesma decisão do #352): o enum legado só reconhece SUPER_ADMIN/DIRECTOR/
 * MANAGER e bloquearia ADMIN_EMPRESA, RH, ADMIN_FILIAL e AUDITOR (perfis
 * só-RBAC-v2). Acesso efetivo pela matriz aprovada:
 *   - iam.org.view   → ADMIN_GLOBAL, ADMIN_EMPRESA, DIRETOR, RH, ADMIN_FILIAL, AUDITOR
 *   - iam.org.manage → ADMIN_GLOBAL, ADMIN_EMPRESA, DIRETOR (redesenha a estrutura)
 *   - iam.org.assign → ADMIN_GLOBAL, ADMIN_EMPRESA, DIRETOR, RH (aloca pessoas)
 * RH aloca pessoas (assign) mas NÃO redesenha a estrutura (sem manage);
 * ADMIN_FILIAL e AUDITOR só visualizam nesta fase. O backend é a autoridade;
 * o frontend (<Can>/usePermission) é só UX. companyId SEMPRE do JWT (anti-IDOR).
 */
@ApiTags('iam')
@ApiBearerAuth()
@Controller('iam')
export class OrgStructureController {
  constructor(private readonly orgStructureService: OrgStructureService) {}

  // ─── Filiais ───────────────────────────────────────────────────────────────

  @Get('branches')
  @RequirePermission('iam.org.view')
  @ApiOperation({ summary: 'Listar filiais da empresa' })
  async listBranches(@CurrentUser() user: any) {
    return this.orgStructureService.listBranches(user.companyId);
  }

  @Post('branches')
  @RequirePermission('iam.org.manage')
  @ApiOperation({ summary: 'Criar filial (código único por empresa → 409)' })
  async createBranch(@CurrentUser() user: any, @Body() dto: CreateBranchDto) {
    return this.orgStructureService.createBranch(
      { id: user.id, companyId: user.companyId },
      dto,
    );
  }

  @Patch('branches/:id')
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
  @RequirePermission('iam.org.view')
  @ApiOperation({
    summary: 'Listar departamentos da empresa (com hierarquia e gerente)',
  })
  async listDepartments(@CurrentUser() user: any) {
    return this.orgStructureService.listDepartments(user.companyId);
  }

  @Post('departments')
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
  @RequirePermission('iam.org.view')
  @ApiOperation({ summary: 'Listar equipes da empresa (via departamento)' })
  async listTeams(@CurrentUser() user: any) {
    return this.orgStructureService.listTeams(user.companyId);
  }

  @Post('teams')
  @RequirePermission('iam.org.manage')
  @ApiOperation({ summary: 'Criar equipe dentro de um departamento (líder opcional)' })
  async createTeam(@CurrentUser() user: any, @Body() dto: CreateTeamDto) {
    return this.orgStructureService.createTeam(
      { id: user.id, companyId: user.companyId },
      dto,
    );
  }

  @Patch('teams/:id')
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
  @RequirePermission('iam.org.view')
  @ApiOperation({ summary: 'Departamentos do usuário (com flag de principal)' })
  async listUserDepartments(@CurrentUser() user: any, @Param('userId') userId: string) {
    return this.orgStructureService.listUserDepartments(user.companyId, userId);
  }

  @Post('users/:userId/departments')
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
  @RequirePermission('iam.org.view')
  @ApiOperation({ summary: 'Equipes do usuário' })
  async listUserTeams(@CurrentUser() user: any, @Param('userId') userId: string) {
    return this.orgStructureService.listUserTeams(user.companyId, userId);
  }

  @Post('users/:userId/teams')
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
