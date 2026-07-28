import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { LostReasonCategory } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
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
import { LeadLgpdService } from './lead-lgpd.service';
import { SdrAgentService } from './sdr/sdr-agent.service';
import { SdrDashboardService } from './sdr/sdr-dashboard.service';
import { LeadSummaryService } from './sdr/lead-summary.service';
import { LeadProposalService } from './lead-proposal.service';
import { PermissionService } from '../iam/permission.service';
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

  @ApiPropertyOptional({ description: 'Complemento em texto livre da perda (opcional, #570)' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  lostReason?: string;

  @ApiPropertyOptional({
    description: 'Categoria da perda — OBRIGATÓRIA quando o destino é Perdido (#570)',
    enum: LostReasonCategory,
  })
  @IsOptional()
  @IsEnum(LostReasonCategory)
  lostReasonCategory?: LostReasonCategory;
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

  @ApiPropertyOptional({ description: 'Complemento em texto livre da perda (opcional, #570)' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  lostReason?: string;

  @ApiPropertyOptional({
    description: 'Categoria da perda — OBRIGATÓRIA quando o destino é Perdido (#570)',
    enum: LostReasonCategory,
  })
  @IsOptional()
  @IsEnum(LostReasonCategory)
  lostReasonCategory?: LostReasonCategory;
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

export class UpdateSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @IsPositive() slaFirstResponseMin?: number;
  @ApiPropertyOptional({ description: 'Escalação de SLA: realoca o lead pelo rodízio ao estourar N× o SLA (#569)' })
  @IsOptional()
  @IsBoolean()
  slaEscalationEnabled?: boolean;
  @ApiPropertyOptional({ description: 'Fator N da escalação (mínimo 2× o SLA de 1ª resposta)' })
  @IsOptional()
  @IsInt()
  @Min(2)
  slaEscalationFactor?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @IsPositive() coolingHours?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @IsPositive() reopenLostDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoFollowupEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() autoFollowupStageId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @IsPositive() autoFollowupHours?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() autoFollowupTemplate?: string;
  @ApiPropertyOptional({ description: 'LGPD: anonimizar perdidos após N dias (0 = desligado)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  leadRetentionDays?: number;
  @ApiPropertyOptional({ description: 'SDR IA: kill switch da loja (#523)' })
  @IsOptional()
  @IsBoolean()
  sdrEnabled?: boolean;
  @ApiPropertyOptional({ description: 'SDR IA: model id (A/B opus/sonnet/haiku)' })
  @IsOptional()
  @IsString()
  sdrModel?: string;
  @ApiPropertyOptional({ description: 'SDR IA: handoff garantido após N trocas' })
  @IsOptional()
  @IsInt()
  @Min(2)
  sdrMaxTurns?: number;
  @ApiPropertyOptional({ enum: ['24_7', 'OFF_HOURS'] })
  @IsOptional()
  @IsIn(['24_7', 'OFF_HOURS'])
  sdrSchedule?: '24_7' | 'OFF_HOURS';
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

class SendProposalDto {
  @ApiProperty({ description: 'Cotação do cliente vinculado ao lead — vira PDF no WhatsApp (#572)' })
  @IsString()
  quotationId: string;
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

  @ApiPropertyOptional({ description: 'Complemento em texto livre da perda (opcional, #570)' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  lostReason?: string;

  @ApiPropertyOptional({
    description: 'Categoria da perda — OBRIGATÓRIA quando o destino é Perdido (#570)',
    enum: LostReasonCategory,
  })
  @IsOptional()
  @IsEnum(LostReasonCategory)
  lostReasonCategory?: LostReasonCategory;
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
    private readonly leadLgpd: LeadLgpdService,
    private readonly sdr: SdrAgentService,
    private readonly sdrDashboard: SdrDashboardService,
    private readonly leadSummary: LeadSummaryService,
    private readonly proposals: LeadProposalService,
    private readonly permissions: PermissionService,
  ) {}

  // ── SDR IA (F4 #521/#524) ───────────────────────────────────────────────────

  @Post('leads/:id/sdr/takeover')
  @RequirePermission('crm.sdr.takeover')
  @ApiOperation({ summary: 'Assumir conversa da IA (takeover explícito — IA silencia)' })
  async sdrTakeover(@Param('id') id: string, @CurrentUser() user: any) {
    const taken = await this.sdr.takeover(id, user.id);
    return { taken };
  }

  @Post('leads/:id/summarize')
  @RequirePermission('crm.leads.annotate')
  @ApiOperation({
    summary:
      'Resumir a conversa por IA (modelo barato) — gera nota na timeline pro takeover humano (#573)',
  })
  summarizeLead(@Param('id') id: string, @CurrentUser() user: any) {
    return this.leadSummary.summarize(user.companyId, id, user.id);
  }

  @Get('sdr/overview')
  @RequirePermission('crm.sdr.monitor')
  @ApiOperation({ summary: 'Métricas do SDR IA: atendidos, handoff, descarte, score, custo' })
  @ApiQuery({ name: 'days', required: false })
  sdrOverview(@CurrentUser() user: any, @Query('days') days?: string) {
    const range = resolveRange(user.companyId, days);
    return this.sdrDashboard.overview(user.companyId, range.from, range.to);
  }

  @Get('sdr/discards')
  @RequirePermission('crm.sdr.monitor')
  @ApiOperation({ summary: 'Fila de revisão: descartes da IA dos últimos 7 dias' })
  sdrDiscards(@CurrentUser() user: any) {
    return this.sdrDashboard.discards(user.companyId);
  }

  @Post('sdr/discards/:leadId/revert')
  @RequirePermission('crm.sdr.operate')
  @ApiOperation({ summary: 'Reverter descarte da IA (feedback p/ ajuste de prompt)' })
  sdrRevertDiscard(@Param('leadId') leadId: string, @CurrentUser() user: any) {
    return this.sdrDashboard.revertDiscard(user.companyId, leadId, user.id);
  }

  @Get('sdr/incidents')
  @RequirePermission('crm.sdr.monitor')
  @ApiOperation({ summary: 'Incidentes de guardrail do SDR (bloqueios do F4.3)' })
  @ApiQuery({ name: 'days', required: false })
  sdrIncidents(@CurrentUser() user: any, @Query('days') days?: string) {
    const range = resolveRange(user.companyId, days);
    return this.sdrDashboard.incidents(user.companyId, range.from, range.to);
  }

  // ── LGPD (F3.5-C8 #558) ─────────────────────────────────────────────────────

  @Post('leads/:id/anonymize')
  @RequirePermission('crm.lgpd.anonymize')
  @ApiOperation({
    summary: 'Anonimizar lead (LGPD, direito do titular) — IRREVERSÍVEL, preserva métricas',
  })
  anonymize(@Param('id') id: string, @CurrentUser() user: any) {
    return this.leadLgpd.anonymizeLead(user.companyId, id, user.id);
  }

  // ── Lista de leads (F3.5-C7 #557) ───────────────────────────────────────────

  @Get('leads')
  @RequirePermission('crm.leads.list')
  @ApiOperation({ summary: 'Lista de leads em tabela: filtros, ordenação e paginação' })
  leadsList(@CurrentUser() user: any, @Query() q: Record<string, string>) {
    return this.leadList.list(user.companyId, this.listFilters(q));
  }

  @Get('leads.csv')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // #349: exports 10/min por usuário
  @RequirePermission('crm.leads.export')
  @ApiOperation({ summary: 'Export CSV da lista de leads (mesmos filtros)' })
  async leadsCsv(@CurrentUser() user: any, @Res() res: Response, @Query() q: Record<string, string>) {
    const csv = await this.leadList.csv(user.companyId, this.listFilters(q));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="crm-leads.csv"');
    res.send(csv);
  }

  @Post('leads/bulk/reassign')
  @RequirePermission('crm.leads.bulk-reassign')
  @ApiOperation({ summary: 'Reatribuir leads em lote (gerente)' })
  bulkReassign(@Body() dto: BulkReassignDto, @CurrentUser() user: any) {
    return this.leadList.bulkReassign(user.companyId, dto.leadIds, dto.toUserId, user.id);
  }

  @Post('leads/bulk/stage')
  @RequirePermission('crm.leads.bulk-stage')
  @ApiOperation({ summary: 'Mudar estágio em lote (Perdido exige motivo)' })
  bulkStage(@Body() dto: BulkStageDto, @CurrentUser() user: any) {
    return this.leadList.bulkChangeStage(
      user.companyId,
      dto.leadIds,
      dto.stageId,
      user.id,
      dto.lostReason,
      dto.lostReasonCategory,
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

  // ── Proposta em PDF no inbox (V2.5 #572) ────────────────────────────────────

  @Get('leads/:id/proposal-options')
  @RequirePermission('crm.proposals.send')
  @ApiOperation({ summary: 'Cotações do cliente do lead — opções do "Enviar proposta" (#572)' })
  proposalOptions(@Param('id') id: string, @CurrentUser() user: any) {
    return this.proposals.listQuotationsForLead(user.companyId, id);
  }

  @Post('leads/:id/send-proposal')
  @RequirePermission('crm.proposals.send')
  @ApiOperation({ summary: 'Gerar PDF da cotação e enviar como documento no WhatsApp do lead (#572)' })
  sendProposal(@Param('id') id: string, @Body() dto: SendProposalDto, @CurrentUser() user: any) {
    return this.proposals.sendProposal(user.companyId, id, dto.quotationId, user.id);
  }

  // ── Notas e lembretes (F3.5-C5 #555) ────────────────────────────────────────

  @Post('leads/:id/notes')
  @RequirePermission('crm.leads.annotate')
  @ApiOperation({ summary: 'Adicionar nota manual à timeline do lead' })
  addNote(@Param('id') id: string, @Body() dto: AddNoteDto, @CurrentUser() user: any) {
    return this.reminders.addNote(this.actor(user), id, dto.text);
  }

  @Get('leads/:id/reminders')
  @RequirePermission('crm.leads.view')
  @ApiOperation({ summary: 'Lembretes pendentes do lead' })
  leadReminders(@Param('id') id: string, @CurrentUser() user: any) {
    return this.reminders.listByLead(this.actor(user), id);
  }

  @Post('leads/:id/reminders')
  @RequirePermission('crm.leads.annotate')
  @ApiOperation({ summary: 'Agendar lembrete de follow-up ("ligar amanhã 14h")' })
  createReminder(@Param('id') id: string, @Body() dto: CreateReminderDto, @CurrentUser() user: any) {
    return this.reminders.createReminder(this.actor(user), id, dto);
  }

  @Get('reminders')
  @RequirePermission('crm.leads.view')
  @ApiOperation({ summary: 'Meus lembretes pendentes (vencidos primeiro)' })
  myReminders(@CurrentUser() user: any) {
    return this.reminders.listMine(this.actor(user));
  }

  @Patch('reminders/:id/done')
  @RequirePermission('crm.leads.annotate')
  @ApiOperation({ summary: 'Concluir lembrete' })
  reminderDone(@Param('id') id: string, @CurrentUser() user: any) {
    return this.reminders.markDone(this.actor(user), id);
  }

  @Delete('reminders/:id')
  @RequirePermission('crm.leads.annotate')
  @ApiOperation({ summary: 'Excluir lembrete' })
  reminderRemove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.reminders.remove(this.actor(user), id);
  }

  private actor(user: any) {
    return { id: user.id, companyId: user.companyId };
  }

  // ── Respostas rápidas (F3.5-C3 #553) ────────────────────────────────────────

  @Get('quick-replies')
  @RequirePermission('crm.conversations.view')
  @ApiOperation({ summary: 'Respostas rápidas visíveis (loja + pessoais do vendedor)' })
  quickRepliesList(@CurrentUser() user: any) {
    return this.quickReplies.list({ id: user.id, companyId: user.companyId });
  }

  @Post('quick-replies')
  @RequirePermission('crm.quick-replies.manage')
  @ApiOperation({ summary: 'Criar resposta rápida (escopo loja exige gerente)' })
  quickReplyCreate(@Body() dto: CreateQuickReplyDto, @CurrentUser() user: any) {
    return this.quickReplies.create({ id: user.id, companyId: user.companyId }, dto);
  }

  @Patch('quick-replies/:id')
  @RequirePermission('crm.quick-replies.manage')
  @ApiOperation({ summary: 'Editar resposta rápida (pessoal só pelo dono)' })
  quickReplyUpdate(@Param('id') id: string, @Body() dto: UpdateQuickReplyDto, @CurrentUser() user: any) {
    return this.quickReplies.update({ id: user.id, companyId: user.companyId }, id, dto);
  }

  @Delete('quick-replies/:id')
  @RequirePermission('crm.quick-replies.manage')
  @ApiOperation({ summary: 'Excluir resposta rápida' })
  quickReplyRemove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.quickReplies.remove({ id: user.id, companyId: user.companyId }, id);
  }

  // ── Configuração (F3.5-C1 #551) ─────────────────────────────────────────────

  @Get('settings')
  @RequirePermission('crm.settings.view')
  @ApiOperation({ summary: 'Configuração do CRM da loja' })
  getSettings(@CurrentUser() user: any) {
    return this.settings.get(user.companyId);
  }

  @Patch('settings')
  @RequirePermission('crm.settings.update')
  @ApiOperation({
    summary: 'Atualizar configuração do CRM (leadRetentionDays exige crm.lgpd.retention-update)',
  })
  async updateSettings(@Body() dto: UpdateSettingsDto, @CurrentUser() user: any) {
    // Bloco F (#624, D5): a política de retenção comanda o expurgo diário
    // (anonimização em massa IRREVERSÍVEL de leads perdidos antigos). Payload
    // com leadRetentionDays exige a permissão complementar — sem ela, 403 na
    // requisição INTEIRA: o campo não é ignorado e nada é persistido.
    if (
      dto.leadRetentionDays !== undefined &&
      !(await this.permissions.hasPermission(
        user.id,
        user.companyId,
        'crm.lgpd.retention-update',
      ))
    ) {
      throw new ForbiddenException(
        'Alterar a retenção LGPD (leadRetentionDays) exige a permissão crm.lgpd.retention-update.',
      );
    }
    return this.settings.update(user.companyId, dto);
  }

  @Get('settings/sellers')
  @RequirePermission('crm.settings.view')
  @ApiOperation({ summary: 'Vendedores da loja e disponibilidade no rodízio' })
  getSellers(@CurrentUser() user: any) {
    return this.settings.sellers(user.companyId);
  }

  @Patch('settings/sellers/:userId/availability')
  @RequirePermission('crm.settings.update')
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
  @RequirePermission('crm.dashboard.view')
  @ApiOperation({ summary: 'Dashboard: funil, conversão por origem/vendedor, motivos' })
  @ApiQuery({ name: 'days', required: false, description: 'Janela em dias (default 30)' })
  dashboardOverview(@CurrentUser() user: any, @Query('days') days?: string) {
    return this.dashboard.overview(resolveRange(user.companyId, days));
  }

  @Get('dashboard/source.csv')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // #349: exports 10/min por usuário
  @RequirePermission('crm.dashboard.export')
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
  @RequirePermission('crm.conversations.view')
  @ApiOperation({ summary: 'Templates aprovados da loja (reengajamento fora da janela)' })
  templatesList(@CurrentUser() user: any) {
    return this.templates.listApproved(user.companyId);
  }

  @Post('templates/sync')
  @RequirePermission('crm.templates.sync')
  @ApiOperation({ summary: 'Sincronizar templates do Meta Business' })
  templatesSync(@CurrentUser() user: any) {
    return this.templates.sync(user.companyId);
  }

  @Post('leads/:id/template')
  @RequirePermission('crm.templates.send')
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
  @RequirePermission('crm.leads.view')
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
  @RequirePermission('crm.leads.move')
  @ApiOperation({ summary: 'Mover lead no kanban (estágio + posição drag&drop)' })
  move(@Param('id') id: string, @Body() dto: MoveLeadDto, @CurrentUser() user: any) {
    return this.funnel.moveLead(user.companyId, id, dto, user.id);
  }

  @Get('lost-reasons')
  @RequirePermission('crm.dashboard.view')
  @ApiOperation({ summary: 'Motivos de perda agregados' })
  lostReasons(@CurrentUser() user: any) {
    return this.funnel.lostReasons(user.companyId);
  }

  // ── SLA (F2.3 #516) ─────────────────────────────────────────────────────────

  @Get('sla')
  @RequirePermission('crm.leads.view')
  @ApiOperation({ summary: 'Painel de SLA: leads estourando e esfriando' })
  @ApiQuery({ name: 'scope', required: false, enum: ['mine', 'all'] })
  sla(@CurrentUser() user: any, @Query('scope') scope?: 'mine' | 'all') {
    return this.funnel.slaPanel(user.companyId, scope === 'mine' ? user.id : undefined);
  }

  // ── Conversão (F2.2 #515) ───────────────────────────────────────────────────

  @Post('leads/:id/convert')
  @RequirePermission('crm.leads.convert')
  @ApiOperation({ summary: 'Converter lead em cliente (pré-preenche a OV)' })
  convert(@Param('id') id: string, @CurrentUser() user: any) {
    return this.conversion.convertToCustomer(user.companyId, id, user.id);
  }

  @Post('leads/:id/link-order')
  @RequirePermission('crm.leads.convert')
  @ApiOperation({ summary: 'Vincular OV criada ao lead (fecha via SALE_INVOICED)' })
  linkOrder(@Param('id') id: string, @Body() dto: LinkOrderDto, @CurrentUser() user: any) {
    return this.conversion.linkSalesOrder(user.companyId, id, dto.salesOrderId);
  }

  // ── Inbox (F1.3 #509) ──────────────────────────────────────────────────────

  @Get('conversations')
  @RequirePermission('crm.conversations.view')
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
  @RequirePermission('crm.leads.view')
  @ApiOperation({ summary: 'Estágios do funil da loja' })
  stages(@CurrentUser() user: any) {
    return this.crm.listStages(user.companyId);
  }

  // ── Leads ──────────────────────────────────────────────────────────────────

  @Post('leads')
  @RequirePermission('crm.leads.create')
  @ApiOperation({ summary: 'Registrar lead manualmente (telefone/balcão) — F1.6' })
  create(@Body() dto: IntakeLeadDto, @CurrentUser() user: any) {
    return this.leadIntake.intake(user.companyId, dto);
  }

  @Get('leads/distribution')
  @RequirePermission('crm.distribution.view')
  @ApiOperation({ summary: 'Distribuição de leads por vendedor no dia (rodízio)' })
  @ApiQuery({ name: 'day', required: false, description: 'YYYY-MM-DD (default: hoje)' })
  distribution(@CurrentUser() user: any, @Query('day') day?: string) {
    return this.leadIntake.distributionReport(user.companyId, day);
  }

  @Get('leads/:id')
  @RequirePermission('crm.leads.view')
  @ApiOperation({ summary: 'Detalhe do lead com timeline (painel do inbox)' })
  lead(@Param('id') id: string, @CurrentUser() user: any) {
    return this.crm.getLead(user.companyId, id);
  }

  @Patch('leads/:id/stage')
  @RequirePermission('crm.leads.move')
  @ApiOperation({ summary: 'Troca rápida de estágio (Perdido exige motivo)' })
  changeStage(
    @Param('id') id: string,
    @Body() dto: ChangeStageDto,
    @CurrentUser() user: any,
  ) {
    return this.crm.changeStage(
      user.companyId,
      id,
      dto.stageId,
      user.id,
      dto.lostReason,
      dto.lostReasonCategory,
    );
  }

  @Patch('leads/:id/assignee')
  @RequirePermission('crm.leads.reassign')
  @ApiOperation({ summary: 'Reatribuir lead a outro vendedor (gerente)' })
  reassign(
    @Param('id') id: string,
    @Body() dto: ReassignLeadDto,
    @CurrentUser() user: any,
  ) {
    return this.leadIntake.reassign(user.companyId, id, dto.toUserId, user.id);
  }
}
