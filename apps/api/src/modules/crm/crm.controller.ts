import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CrmService } from './crm.service';
import { IntakeLeadDto } from './dto/intake-lead.dto';
import { LeadIntakeService } from './lead-intake.service';
import { FunnelService } from './funnel.service';
import { LeadConversionService } from './lead-conversion.service';
import { CrmDashboardService } from './crm-dashboard.service';
import { WhatsappTemplateService } from './whatsapp/template.service';
import { CrmSettingsService } from './crm-settings.service';
import { QuickReplyService } from './quick-reply.service';
import { ReminderService } from './reminder.service';
import { LeadListService, LeadListFilters } from './lead-list.service';
import { Res } from '@nestjs/common';
import { Response } from 'express';
import { IsArray, IsBoolean, IsIn, IsInt, IsPositive, Min } from 'class-validator';

class ReassignLeadDto {
  @ApiProperty({ description: 'Vendedor destino' })
  @IsString()
  toUserId: string;
}

class ChangeStageDto {
  @ApiProperty({ description: 'Estágio destino' })
  @IsString()
  stageId: string;

  @ApiPropertyOptional({ description: 'Obrigatório quando o estágio destino é Perdido' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  lostReason?: string;
}

class MoveLeadDto {
  @ApiProperty({ description: 'Estágio destino' })
  @IsString()
  stageId: string;

  @ApiPropertyOptional({ description: 'Lead que fica acima (posição menor)' })
  @IsOptional()
  @IsString()
  beforeLeadId?: string;

  @ApiPropertyOptional({ description: 'Lead que fica abaixo (posição maior)' })
  @IsOptional()
  @IsString()
  afterLeadId?: string;

  @ApiPropertyOptional({ description: 'Obrigatório quando o destino é Perdido' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  lostReason?: string;
}

class LinkOrderDto {
  @ApiProperty({ description: 'Ordem de venda a vincular ao lead' })
  @IsString()
  salesOrderId: string;
}

class SendTemplateDto {
  @ApiProperty({ description: 'Nome do template aprovado' })
  @IsString()
  templateName: string;

  @ApiPropertyOptional({ description: 'Variáveis na ordem dos placeholders {{1}}, {{2}}...', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  variables?: string[];
}

class UpdateSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @IsPositive() slaFirstResponseMin?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @IsPositive() coolingHours?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @IsPositive() reopenLostDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoFollowupEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() autoFollowupStageId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @IsPositive() autoFollowupHours?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() autoFollowupTemplate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() waPhoneNumberId?: string;
}

class SellerAvailabilityDto {
  @ApiProperty() @IsBoolean() available: boolean;
}

class CreateQuickReplyDto {
  @ApiProperty({ description: 'Atalho sem a barra (ex: "pix")' })
  @IsString()
  @MaxLength(30)
  shortcut: string;

  @ApiProperty({ description: 'Texto da resposta; suporta a variável {nome}' })
  @IsString()
  @MaxLength(4000)
  text: string;

  @ApiProperty({ enum: ['STORE', 'PERSONAL'], description: 'Compartilhada da loja ou pessoal' })
  @IsIn(['STORE', 'PERSONAL'])
  scope: 'STORE' | 'PERSONAL';
}

class UpdateQuickReplyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) shortcut?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) text?: string;
}

class AddNoteDto {
  @ApiProperty({ description: 'Texto da nota manual (vai pra timeline)' })
  @IsString()
  @MaxLength(4000)
  text: string;
}

class BulkReassignDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  leadIds: string[];

  @ApiProperty({ description: 'Vendedor destino' })
  @IsString()
  toUserId: string;
}

class BulkStageDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  leadIds: string[];

  @ApiProperty({ description: 'Estágio destino' })
  @IsString()
  stageId: string;

  @ApiPropertyOptional({ description: 'Obrigatório quando o destino é Perdido' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  lostReason?: string;
}

class CreateReminderDto {
  @ApiProperty({ description: 'O que fazer (ex: "ligar amanhã 14h")' })
  @IsString()
  @MaxLength(300)
  text: string;

  @ApiProperty({ description: 'Vencimento ISO-8601 (futuro)' })
  @IsString()
  dueAt: string;
}

/** Resolve o intervalo do dashboard a partir de ?days= (default 30) */
function resolveRange(companyId: string, daysRaw?: string) {
  const days = Math.min(Math.max(parseInt(daysRaw ?? '30', 10) || 30, 1), 365);
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { companyId, from, to };
}

@ApiTags('crm')
@ApiBearerAuth()
@Controller('crm')
export class CrmController {
  constructor(
    private readonly leadIntake: LeadIntakeService,
    private readonly crm: CrmService,
    private readonly funnel: FunnelService,
    private readonly conversion: LeadConversionService,
    private readonly dashboard: CrmDashboardService,
    private readonly templates: WhatsappTemplateService,
    private readonly settings: CrmSettingsService,
    private readonly quickReplies: QuickReplyService,
    private readonly reminders: ReminderService,
    private readonly leadList: LeadListService,
  ) {}

  // ── Lista de leads (F3.5-C7 #557) ───────────────────────────────────────────

  @Get('leads')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Lista de leads em tabela: filtros, ordenação e paginação' })
  leadsList(@CurrentUser() user: any, @Query() q: Record<string, string>) {
    return this.leadList.list(user.companyId, this.listFilters(q));
  }

  @Get('leads.csv')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Export CSV da lista de leads (mesmos filtros)' })
  async leadsCsv(@CurrentUser() user: any, @Res() res: Response, @Query() q: Record<string, string>) {
    const csv = await this.leadList.csv(user.companyId, this.listFilters(q));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="crm-leads.csv"');
    res.send(csv);
  }

  @Post('leads/bulk/reassign')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Reatribuir leads em lote (gerente)' })
  bulkReassign(@Body() dto: BulkReassignDto, @CurrentUser() user: any) {
    return this.leadList.bulkReassign(user.companyId, dto.leadIds, dto.toUserId, user.id);
  }

  @Post('leads/bulk/stage')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Mudar estágio em lote (Perdido exige motivo)' })
  bulkStage(@Body() dto: BulkStageDto, @CurrentUser() user: any) {
    return this.leadList.bulkChangeStage(
      user.companyId,
      dto.leadIds,
      dto.stageId,
      user.id,
      dto.lostReason,
    );
  }

  private listFilters(q: Record<string, string>): LeadListFilters {
    return {
      source: q.source || undefined,
      stageId: q.stageId || undefined,
      assignedToId: q.assignedToId || undefined,
      from: q.from || undefined,
      to: q.to || undefined,
      search: q.search || undefined,
      page: q.page ? parseInt(q.page, 10) : undefined,
      pageSize: q.pageSize ? parseInt(q.pageSize, 10) : undefined,
      sortBy: q.sortBy as LeadListFilters['sortBy'],
      sortDir: q.sortDir as LeadListFilters['sortDir'],
    };
  }

  // ── Notas e lembretes (F3.5-C5 #555) ────────────────────────────────────────

  @Post('leads/:id/notes')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @ApiOperation({ summary: 'Adicionar nota manual à timeline do lead' })
  addNote(@Param('id') id: string, @Body() dto: AddNoteDto, @CurrentUser() user: any) {
    return this.reminders.addNote(this.actor(user), id, dto.text);
  }

  @Get('leads/:id/reminders')
  @ApiOperation({ summary: 'Lembretes pendentes do lead' })
  leadReminders(@Param('id') id: string, @CurrentUser() user: any) {
    return this.reminders.listByLead(this.actor(user), id);
  }

  @Post('leads/:id/reminders')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @ApiOperation({ summary: 'Agendar lembrete de follow-up ("ligar amanhã 14h")' })
  createReminder(@Param('id') id: string, @Body() dto: CreateReminderDto, @CurrentUser() user: any) {
    return this.reminders.createReminder(this.actor(user), id, dto);
  }

  @Get('reminders')
  @ApiOperation({ summary: 'Meus lembretes pendentes (vencidos primeiro)' })
  myReminders(@CurrentUser() user: any) {
    return this.reminders.listMine(this.actor(user));
  }

  @Patch('reminders/:id/done')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @ApiOperation({ summary: 'Concluir lembrete' })
  reminderDone(@Param('id') id: string, @CurrentUser() user: any) {
    return this.reminders.markDone(this.actor(user), id);
  }

  @Delete('reminders/:id')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @ApiOperation({ summary: 'Excluir lembrete' })
  reminderRemove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.reminders.remove(this.actor(user), id);
  }

  private actor(user: any) {
    return { id: user.id, companyId: user.companyId, role: user.role };
  }

  // ── Respostas rápidas (F3.5-C3 #553) ────────────────────────────────────────

  @Get('quick-replies')
  @ApiOperation({ summary: 'Respostas rápidas visíveis (loja + pessoais do vendedor)' })
  quickRepliesList(@CurrentUser() user: any) {
    return this.quickReplies.list({ id: user.id, companyId: user.companyId, role: user.role });
  }

  @Post('quick-replies')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @ApiOperation({ summary: 'Criar resposta rápida (escopo loja exige gerente)' })
  quickReplyCreate(@Body() dto: CreateQuickReplyDto, @CurrentUser() user: any) {
    return this.quickReplies.create({ id: user.id, companyId: user.companyId, role: user.role }, dto);
  }

  @Patch('quick-replies/:id')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @ApiOperation({ summary: 'Editar resposta rápida (pessoal só pelo dono)' })
  quickReplyUpdate(@Param('id') id: string, @Body() dto: UpdateQuickReplyDto, @CurrentUser() user: any) {
    return this.quickReplies.update({ id: user.id, companyId: user.companyId, role: user.role }, id, dto);
  }

  @Delete('quick-replies/:id')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @ApiOperation({ summary: 'Excluir resposta rápida' })
  quickReplyRemove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.quickReplies.remove({ id: user.id, companyId: user.companyId, role: user.role }, id);
  }

  // ── Configuração (F3.5-C1 #551) ─────────────────────────────────────────────

  @Get('settings')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Configuração do CRM da loja' })
  getSettings(@CurrentUser() user: any) {
    return this.settings.get(user.companyId);
  }

  @Patch('settings')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Atualizar configuração do CRM' })
  updateSettings(@Body() dto: UpdateSettingsDto, @CurrentUser() user: any) {
    return this.settings.update(user.companyId, dto);
  }

  @Get('settings/sellers')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Vendedores da loja e disponibilidade no rodízio' })
  getSellers(@CurrentUser() user: any) {
    return this.settings.sellers(user.companyId);
  }

  @Patch('settings/sellers/:userId/availability')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Ligar/desligar vendedor no rodízio (férias/folga)' })
  setSellerAvailability(
    @Param('userId') userId: string,
    @Body() dto: SellerAvailabilityDto,
    @CurrentUser() user: any,
  ) {
    return this.settings.setSellerAvailability(user.companyId, userId, dto.available);
  }

  // ── Dashboard (F3.1 #517) ───────────────────────────────────────────────────

  @Get('dashboard')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Dashboard: funil, conversão por origem/vendedor, motivos' })
  @ApiQuery({ name: 'days', required: false, description: 'Janela em dias (default 30)' })
  dashboardOverview(@CurrentUser() user: any, @Query('days') days?: string) {
    return this.dashboard.overview(resolveRange(user.companyId, days));
  }

  @Get('dashboard/source.csv')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Export CSV da conversão por origem' })
  @ApiQuery({ name: 'days', required: false })
  async dashboardCsv(@CurrentUser() user: any, @Res() res: Response, @Query('days') days?: string) {
    const csv = await this.dashboard.sourceCsv(resolveRange(user.companyId, days));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="crm-origem.csv"');
    res.send(csv);
  }

  // ── Templates / follow-up (F3.2 #518) ───────────────────────────────────────

  @Get('templates')
  @ApiOperation({ summary: 'Templates aprovados da loja (reengajamento fora da janela)' })
  templatesList(@CurrentUser() user: any) {
    return this.templates.listApproved(user.companyId);
  }

  @Post('templates/sync')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Sincronizar templates do Meta Business' })
  templatesSync(@CurrentUser() user: any) {
    return this.templates.sync(user.companyId);
  }

  @Post('leads/:id/template')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @ApiOperation({ summary: 'Enviar template (janela 24h expirada) — custo Meta' })
  sendTemplate(@Param('id') id: string, @Body() dto: SendTemplateDto, @CurrentUser() user: any) {
    return this.templates.sendTemplate(
      user.companyId,
      id,
      dto.templateName,
      dto.variables ?? [],
      user.id,
    );
  }

  // ── Funil / kanban (F2.1 #514) ──────────────────────────────────────────────

  @Get('board')
  @ApiOperation({ summary: 'Board kanban do funil (estágios + leads por coluna)' })
  @ApiQuery({ name: 'scope', required: false, enum: ['mine', 'all'] })
  @ApiQuery({ name: 'source', required: false })
  board(
    @CurrentUser() user: any,
    @Query('scope') scope?: 'mine' | 'all',
    @Query('source') source?: string,
  ) {
    return this.funnel.board({
      companyId: user.companyId,
      assignedToId: scope === 'mine' ? user.id : undefined,
      source,
    });
  }

  @Patch('leads/:id/move')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @ApiOperation({ summary: 'Mover lead no kanban (estágio + posição drag&drop)' })
  move(@Param('id') id: string, @Body() dto: MoveLeadDto, @CurrentUser() user: any) {
    return this.funnel.moveLead(user.companyId, id, dto, user.id);
  }

  @Get('lost-reasons')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Motivos de perda agregados' })
  lostReasons(@CurrentUser() user: any) {
    return this.funnel.lostReasons(user.companyId);
  }

  // ── SLA (F2.3 #516) ─────────────────────────────────────────────────────────

  @Get('sla')
  @ApiOperation({ summary: 'Painel de SLA: leads estourando e esfriando' })
  @ApiQuery({ name: 'scope', required: false, enum: ['mine', 'all'] })
  sla(@CurrentUser() user: any, @Query('scope') scope?: 'mine' | 'all') {
    return this.funnel.slaPanel(user.companyId, scope === 'mine' ? user.id : undefined);
  }

  // ── Conversão (F2.2 #515) ───────────────────────────────────────────────────

  @Post('leads/:id/convert')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @ApiOperation({ summary: 'Converter lead em cliente (pré-preenche a OV)' })
  convert(@Param('id') id: string, @CurrentUser() user: any) {
    return this.conversion.convertToCustomer(user.companyId, id, user.id);
  }

  @Post('leads/:id/link-order')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @ApiOperation({ summary: 'Vincular OV criada ao lead (fecha via SALE_INVOICED)' })
  linkOrder(@Param('id') id: string, @Body() dto: LinkOrderDto, @CurrentUser() user: any) {
    return this.conversion.linkSalesOrder(user.companyId, id, dto.salesOrderId);
  }

  // ── Inbox (F1.3 #509) ──────────────────────────────────────────────────────

  @Get('conversations')
  @ApiOperation({ summary: 'Conversas WhatsApp da loja (inbox)' })
  @ApiQuery({ name: 'scope', required: false, enum: ['mine', 'all'] })
  @ApiQuery({ name: 'search', required: false })
  conversations(
    @CurrentUser() user: any,
    @Query('scope') scope?: 'mine' | 'all',
    @Query('search') search?: string,
  ) {
    return this.crm.listConversations(user.companyId, {
      scope: scope === 'mine' ? 'mine' : 'all',
      search,
      userId: user.id,
    });
  }

  @Get('stages')
  @ApiOperation({ summary: 'Estágios do funil da loja' })
  stages(@CurrentUser() user: any) {
    return this.crm.listStages(user.companyId);
  }

  // ── Leads ──────────────────────────────────────────────────────────────────

  @Post('leads')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @ApiOperation({ summary: 'Registrar lead manualmente (telefone/balcão) — F1.6' })
  create(@Body() dto: IntakeLeadDto, @CurrentUser() user: any) {
    return this.leadIntake.intake(user.companyId, dto);
  }

  @Get('leads/distribution')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Distribuição de leads por vendedor no dia (rodízio)' })
  @ApiQuery({ name: 'day', required: false, description: 'YYYY-MM-DD (default: hoje)' })
  distribution(@CurrentUser() user: any, @Query('day') day?: string) {
    return this.leadIntake.distributionReport(user.companyId, day);
  }

  @Get('leads/:id')
  @ApiOperation({ summary: 'Detalhe do lead com timeline (painel do inbox)' })
  lead(@Param('id') id: string, @CurrentUser() user: any) {
    return this.crm.getLead(user.companyId, id);
  }

  @Patch('leads/:id/stage')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @ApiOperation({ summary: 'Troca rápida de estágio (Perdido exige motivo)' })
  changeStage(
    @Param('id') id: string,
    @Body() dto: ChangeStageDto,
    @CurrentUser() user: any,
  ) {
    return this.crm.changeStage(user.companyId, id, dto.stageId, user.id, dto.lostReason);
  }

  @Patch('leads/:id/assignee')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Reatribuir lead a outro vendedor (gerente)' })
  reassign(
    @Param('id') id: string,
    @Body() dto: ReassignLeadDto,
    @CurrentUser() user: any,
  ) {
    return this.leadIntake.reassign(user.companyId, id, dto.toUserId, user.id);
  }
}
