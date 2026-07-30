import { Body, Controller, Delete, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SaveLayoutDto } from './dto/save-layout.dto';
import { WorkspaceService } from './workspace.service';

/**
 * Workspace — BFF da Home por papel (F1). Gate único RBAC v2 via
 * @RequirePermission; além do gate, o service cura o CONTEÚDO pela
 * permissão efetiva do usuário (um insight financeiro nunca chega a quem
 * não enxerga financeiro).
 */
@ApiTags('workspace')
@ApiBearerAuth()
@Controller('workspace')
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get('insights')
  @RequirePermission('workspace.insights.view')
  @ApiOperation({ summary: 'Resumo do dia (Antonella V1): insights priorizados com CTA' })
  getInsights(@CurrentUser() user: { id: string; companyId: string; role: string }) {
    return this.workspaceService.getInsights(user);
  }

  @Get('tasks')
  @RequirePermission('workspace.tasks.view')
  @ApiOperation({ summary: 'Minhas pendências: aprovações, follow-ups e inspeções' })
  getTasks(@CurrentUser() user: { id: string; companyId: string; role: string }) {
    return this.workspaceService.getTasks(user);
  }

  @Get('agenda')
  @RequirePermission('workspace.agenda.view')
  @ApiOperation({ summary: 'Agenda dos próximos 7 dias: vencimentos, términos de OP e lembretes' })
  getAgenda(@CurrentUser() user: { id: string; companyId: string; role: string }) {
    return this.workspaceService.getAgenda(user);
  }

  // ─── Layout persistido (F2) — sempre dado do PRÓPRIO usuário ───────────────

  @Get('layout')
  @RequirePermission('workspace.layout.view')
  @ApiOperation({ summary: 'Layout salvo da Home do usuário (null = template do perfil)' })
  getLayout(@CurrentUser() user: { id: string; companyId: string; role: string }) {
    return this.workspaceService.getLayout(user);
  }

  @Put('layout')
  @RequirePermission('workspace.layout.update')
  @ApiOperation({ summary: 'Salva os desvios do template (ordem, tamanho, ocultos, perfil)' })
  saveLayout(
    @CurrentUser() user: { id: string; companyId: string; role: string },
    @Body() dto: SaveLayoutDto,
  ) {
    return this.workspaceService.saveLayout(user, dto);
  }

  @Delete('layout')
  @RequirePermission('workspace.layout.update')
  @ApiOperation({ summary: 'Restaura o padrão do perfil (apaga a personalização)' })
  resetLayout(@CurrentUser() user: { id: string; companyId: string; role: string }) {
    return this.workspaceService.resetLayout(user);
  }
}
