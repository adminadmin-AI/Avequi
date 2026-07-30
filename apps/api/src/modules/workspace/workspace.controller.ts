import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
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
}
