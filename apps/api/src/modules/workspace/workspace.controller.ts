import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AgendaQueryDto } from './dto/agenda-query.dto';
import { MyDayQueryDto } from './dto/my-day-query.dto';
import {
  CreateQuickNoteDto,
  ReorderQuickNotesDto,
  UpdateQuickNoteDto,
} from './dto/quick-note.dto';
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
  @ApiOperation({
    summary: 'Agenda prospectiva (default 7 dias; ?days até 42 para o grid de mês)',
  })
  getAgenda(
    @CurrentUser() user: { id: string; companyId: string; role: string },
    @Query() query: AgendaQueryDto,
  ) {
    return this.workspaceService.getAgenda(user, query.days);
  }

  @Get('my-day')
  // Mesmo gate do Resumo do dia: é a mesma leitura agregada do workspace, com
  // o conteúdo curado por permissão de domínio no service (regra de ouro).
  @RequirePermission('workspace.insights.view')
  @ApiOperation({
    summary: 'Meu Dia: faturado/recebido/produzido hoje + variação vs período anterior',
  })
  getMyDay(
    @CurrentUser() user: { id: string; companyId: string; role: string },
    @Query() query: MyDayQueryDto,
  ) {
    return this.workspaceService.getMyDay(user, query.days);
  }

  @Get('revenue')
  // Gate do DADO (venda), não do workspace: este endpoint serve exclusivamente
  // faturamento — quem não enxerga vendas não passa daqui.
  @RequirePermission('sales.orders.view')
  @ApiOperation({
    summary: 'Faturamento por dia no período (venda com NF emitida) + total',
  })
  getRevenue(
    @CurrentUser() user: { id: string; companyId: string; role: string },
    @Query() query: MyDayQueryDto,
  ) {
    return this.workspaceService.getRevenueSeries(user, query.days);
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

  // ─── Notas rápidas (post-its) — sempre do PRÓPRIO usuário ──────────────────

  @Get('notes')
  @RequirePermission('workspace.notes.view')
  @ApiOperation({
    summary: 'Meu mural de notas (fixadas primeiro); ?archived=true abre a gaveta',
  })
  @ApiQuery({ name: 'archived', required: false, type: Boolean })
  listNotes(
    @CurrentUser() user: { id: string; companyId: string; role: string },
    @Query('archived') archived?: string,
  ) {
    return this.workspaceService.listNotes(user, archived === 'true');
  }

  @Post('notes')
  @RequirePermission('workspace.notes.manage')
  @ApiOperation({ summary: 'Criar uma nota rápida' })
  createNote(
    @CurrentUser() user: { id: string; companyId: string; role: string },
    @Body() dto: CreateQuickNoteDto,
  ) {
    return this.workspaceService.createNote(user, dto);
  }

  // Rota ESTÁTICA antes da paramétrica: 'reorder' seria capturado por
  // 'notes/:id' se viesse depois (sentinela #699).
  @Patch('notes/reorder')
  @RequirePermission('workspace.notes.manage')
  @ApiOperation({ summary: 'Reordenar o mural (ids na ordem desejada)' })
  reorderNotes(
    @CurrentUser() user: { id: string; companyId: string; role: string },
    @Body() dto: ReorderQuickNotesDto,
  ) {
    return this.workspaceService.reorderNotes(user, dto.ids);
  }

  @Patch('notes/:id')
  @RequirePermission('workspace.notes.manage')
  @ApiOperation({ summary: 'Editar texto/cor, fixar no topo ou arquivar/desarquivar' })
  updateNote(
    @CurrentUser() user: { id: string; companyId: string; role: string },
    @Param('id') id: string,
    @Body() dto: UpdateQuickNoteDto,
  ) {
    return this.workspaceService.updateNote(user, id, dto);
  }

  @Delete('notes/:id')
  @RequirePermission('workspace.notes.manage')
  @ApiOperation({ summary: 'Excluir de vez uma nota (a partir da gaveta de arquivadas)' })
  deleteNote(
    @CurrentUser() user: { id: string; companyId: string; role: string },
    @Param('id') id: string,
  ) {
    return this.workspaceService.deleteNote(user, id);
  }
}
